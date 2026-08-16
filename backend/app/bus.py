"""Event bus: fan-out of live events to WebSocket clients (+ optional Redis).

Every UI-visible state change (auth progress, job progress, sync progress, log
lines) goes through :func:`publish`. WebSocket clients each get their own
bounded queue, so one slow browser tab can never stall an export.

Redis is used for two things:
  * pub/sub, so a future second process (worker/CLI) can emit events too;
  * a small cache/KV for hot values (job progress snapshots).
It is entirely optional — with ``TGV_REDIS_ENABLED=false`` or an unreachable
server the bus degrades to in-process only and the app keeps working.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Any

from app.config import settings

log = logging.getLogger("tgvault.bus")

EVENT_CHANNEL = "tgvault:events"
_QUEUE_MAXSIZE = 512
#: Consecutive full-queue hits before a subscriber is considered dead.
_MAX_OVERFLOWS = 20

try:  # pragma: no cover - import guard only
    import redis.asyncio as aioredis
except ImportError:  # pragma: no cover
    aioredis = None  # type: ignore[assignment]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class EventBus:
    """In-process fan-out with an optional Redis pub/sub bridge."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._overflows: dict[asyncio.Queue[dict[str, Any]], int] = {}
        self._redis: Any | None = None
        self._redis_sub: Any | None = None
        self._pubsub_task: asyncio.Task | None = None
        self._origin = uuid.uuid4().hex[:12]
        self._redis_ok = False

    # -- lifecycle -------------------------------------------------------

    async def connect(self) -> None:
        if not settings.redis_enabled or aioredis is None:
            log.info("Redis disabled — using in-process event bus only")
            return
        try:
            # Command client: short timeouts so a hung Redis never blocks a
            # request. Publishing and cache reads are always quick.
            self._redis = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=5,
            )
            await self._redis.ping()
            # Subscriber client: a separate connection with NO read timeout.
            # A pub/sub listener blocks on read by design, so a socket_timeout
            # would tear the subscription down every few idle seconds.
            self._redis_sub = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=None,
                socket_keepalive=True,
                health_check_interval=30,
            )
            await self._redis_sub.ping()
            self._redis_ok = True
            self._pubsub_task = asyncio.create_task(self._listen(), name="bus-pubsub")
            log.info("Redis connected: %s", settings.redis_url)
        except Exception as exc:  # noqa: BLE001 - degrade gracefully
            log.warning("Redis unavailable (%s) — continuing without it", exc)
            await self._drop_redis()

    async def _drop_redis(self) -> None:
        for client in (self._redis, self._redis_sub):
            if client is not None:
                with suppress(Exception):
                    await client.aclose()
        self._redis = None
        self._redis_sub = None
        self._redis_ok = False

    async def close(self) -> None:
        if self._pubsub_task:
            self._pubsub_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._pubsub_task
            self._pubsub_task = None
        await self._drop_redis()

    @property
    def redis_ok(self) -> bool:
        return self._redis_ok

    @property
    def redis(self) -> Any | None:
        return self._redis

    # -- pub/sub ---------------------------------------------------------

    async def _listen(self) -> None:
        """Bridge Redis pub/sub back into local subscribers.

        Reconnects with backoff: a Redis restart must not permanently silence
        cross-process events.
        """
        backoff = 1.0
        while True:
            if self._redis_sub is None:
                return
            pubsub = self._redis_sub.pubsub()
            try:
                await pubsub.subscribe(EVENT_CHANNEL)
                backoff = 1.0
                async for raw in pubsub.listen():
                    if raw.get("type") != "message":
                        continue
                    try:
                        message = json.loads(raw["data"])
                    except (TypeError, ValueError):
                        continue
                    if message.get("_origin") == self._origin:
                        continue  # our own message, already delivered locally
                    message.pop("_origin", None)
                    self._fanout(message)
            except asyncio.CancelledError:
                with suppress(Exception):
                    await pubsub.aclose()
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("Redis pub/sub dropped (%s) — reconnecting in %.0fs", exc, backoff)
                with suppress(Exception):
                    await pubsub.aclose()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    def _fanout(self, message: dict[str, Any]) -> None:
        dead: list[asyncio.Queue] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(message)
                self._overflows.pop(queue, None)
            except asyncio.QueueFull:
                # A full queue means the consumer is not reading. Drop its
                # oldest item so a briefly-slow browser tab still catches up,
                # but count the overflows: a queue that stays full is a dead
                # consumer whose socket never signalled a disconnect, and it
                # must be evicted or it receives every event forever.
                overflows = self._overflows.get(queue, 0) + 1
                self._overflows[queue] = overflows
                if overflows >= _MAX_OVERFLOWS:
                    dead.append(queue)
                    continue
                with suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
                with suppress(asyncio.QueueFull):
                    queue.put_nowait(message)
        for queue in dead:
            self.unsubscribe(queue)
            log.info("Dropped a stalled WebSocket subscriber (queue never drained)")

    def publish_nowait(self, event_type: str, payload: Any = None) -> None:
        """Publish without awaiting — safe to call from sync code."""
        message = {"type": event_type, "ts": _now_iso(), "payload": payload}
        self._fanout(message)
        if self._redis is not None:
            with suppress(RuntimeError):
                asyncio.get_running_loop().create_task(self._publish_redis(message))

    async def publish(self, event_type: str, payload: Any = None) -> None:
        message = {"type": event_type, "ts": _now_iso(), "payload": payload}
        self._fanout(message)
        if self._redis is not None:
            await self._publish_redis(message)

    async def _publish_redis(self, message: dict[str, Any]) -> None:
        try:
            await self._redis.publish(  # type: ignore[union-attr]
                EVENT_CHANNEL, json.dumps({**message, "_origin": self._origin}, default=str)
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("Redis publish failed: %s", exc)

    def new_subscriber(self) -> asyncio.Queue[dict[str, Any]]:
        """Register a queue. The caller MUST pair this with :meth:`unsubscribe`.

        Exposed separately from :meth:`subscribe` because the WebSocket handler
        needs the unregister to run even when its coroutine is cancelled
        mid-await, where relying on an async context manager's ``finally`` has
        proved unreliable.
        """
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)
        self._overflows.pop(queue, None)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        queue = self.new_subscriber()
        try:
            yield queue
        finally:
            self.unsubscribe(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    # -- small KV cache --------------------------------------------------

    async def cache_set(self, key: str, value: Any, ttl: int = 300) -> None:
        if self._redis is None:
            return
        with suppress(Exception):
            await self._redis.set(f"tgvault:{key}", json.dumps(value, default=str), ex=ttl)

    async def cache_get(self, key: str) -> Any | None:
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(f"tgvault:{key}")
            return json.loads(raw) if raw else None
        except Exception:  # noqa: BLE001
            return None

    async def cache_delete(self, *keys: str) -> None:
        if self._redis is None or not keys:
            return
        with suppress(Exception):
            await self._redis.delete(*[f"tgvault:{k}" for k in keys])


bus = EventBus()
