"""``/ws`` — one socket per browser tab, fed by the event bus.

Cleanup is deliberately explicit (``new_subscriber`` / ``unsubscribe`` in a
``try/finally``) rather than relying on an async context manager: when uvicorn
cancels the handler mid-``await`` on a dropped connection, that path proved
unreliable and leaked a subscriber that then received every event forever.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import __version__
from app.bus import _now_iso, bus

log = logging.getLogger("tgvault.ws")

router = APIRouter()

_PING_INTERVAL = 25.0


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    queue = bus.new_subscriber()
    log.debug("WebSocket client connected (%s total)", bus.subscriber_count)

    async def pump() -> None:
        """Bus -> browser. Ends on any send failure, which frees the socket."""
        while True:
            message = await queue.get()
            await websocket.send_text(json.dumps(message, default=str))

    async def listen() -> None:
        """Browser -> server. Raises ``WebSocketDisconnect`` when it closes."""
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if data.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    async def heartbeat() -> None:
        """Keep proxies from closing an idle socket."""
        while True:
            await asyncio.sleep(_PING_INTERVAL)
            await websocket.send_text(json.dumps({"type": "pong"}))

    tasks = [
        asyncio.create_task(pump(), name="ws-pump"),
        asyncio.create_task(listen(), name="ws-listen"),
        asyncio.create_task(heartbeat(), name="ws-heartbeat"),
    ]
    try:
        await websocket.send_text(
            json.dumps({"type": "hello", "ts": _now_iso(), "version": __version__})
        )
        # FIRST_COMPLETED, not FIRST_EXCEPTION: a task that finishes *without*
        # raising (a clean disconnect) must tear the connection down too,
        # otherwise the handler waits forever on the remaining tasks.
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.debug("WebSocket task ended: %r", exc)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        log.debug("WebSocket handler error: %r", exc)
    finally:
        bus.unsubscribe(queue)
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError, Exception):
                await task
        with suppress(Exception):
            await websocket.close()
        log.debug("WebSocket client disconnected (%s left)", bus.subscriber_count)
