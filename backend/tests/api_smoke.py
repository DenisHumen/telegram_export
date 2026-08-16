"""Hit every read endpoint against a running backend and fail on any 5xx.

Catches the class of bug that unit tests miss entirely: SQL that only breaks
on the real dialect (MySQL rejects ``NULLS LAST``), serialisation errors, and
routes that were never actually exercised.

    python -m tests.api_smoke [http://127.0.0.1:8077]

It creates a temporary account with dummy credentials, exercises every listing
and filter combination, then deletes it.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8077"

PASSED = 0
FAILED: list[str] = []


def request(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


def raw_get(path: str) -> tuple[int, str]:
    """GET returning the body as text — the response may legitimately be HTML."""
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


#: Markers that must never appear in any HTTP response body.
_SECRET_MARKERS = ("TGV_SECRET_KEY", "TGV_MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD")


def check_no_secret(path: str) -> None:
    """A traversal attempt may 404 or fall back to the SPA — but never leak."""
    global PASSED
    status, text = raw_get(path)
    leaked = [marker for marker in _SECRET_MARKERS if marker in text]
    if leaked:
        FAILED.append(f"GET {path} -> {status} УТЕЧКА: {leaked}")
        print(f"  ✗ GET {path} -> {status} УТЕЧКА СЕКРЕТА: {leaked}")
    else:
        PASSED += 1
        print(f"  ✓ GET {path} -> {status}, секретов в ответе нет")


def check(method: str, path: str, *, expect: tuple[int, ...] = (200,), body: dict | None = None):
    global PASSED
    status, payload = request(method, path, body)
    label = f"{method} {path}"
    if status in expect:
        PASSED += 1
        print(f"  ✓ {label} -> {status}")
    else:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        FAILED.append(f"{label} -> {status}: {str(detail)[:300]}")
        print(f"  ✗ {label} -> {status}: {str(detail)[:200]}")
    return payload


def main() -> int:
    print("=" * 64)
    print(f"TgVault — smoke-тест API ({BASE})")
    print("=" * 64)

    print("\n[1] Служебные")
    health = check("GET", "/api/health")
    if isinstance(health, dict):
        print(f"      db={health.get('db')} redis={health.get('redis')} v={health.get('version')}")
    check("GET", "/api/stats")
    check("GET", "/openapi.json")

    print("\n[2] Аккаунты и ошибки")
    check("GET", "/api/accounts")
    check("GET", "/api/accounts/999999", expect=(404,))
    check("POST", "/api/accounts", expect=(400, 422), body={"label": "no creds"})

    created = check(
        "POST", "/api/accounts", expect=(201,),
        body={"label": "api-smoke", "api_id": 12345, "api_hash": "0" * 32},
    )
    account_id = created.get("id") if isinstance(created, dict) else None
    if not account_id:
        print("  ! не удалось создать аккаунт — дальше идти нет смысла")
        return 1

    check("GET", f"/api/accounts/{account_id}")
    check("GET", f"/api/accounts/{account_id}/stats")
    check("PATCH", f"/api/accounts/{account_id}", body={"label": "api-smoke-renamed"})

    print("\n[3] Список чатов во всех сортировках")
    for sort in ("last_message", "title", "messages", "participants", "created"):
        for order in ("asc", "desc"):
            check("GET", f"/api/accounts/{account_id}/chats?sort={sort}&order={order}")
    for kind in ("all", "channel", "supergroup", "group", "user", "bot"):
        check("GET", f"/api/accounts/{account_id}/chats?kind={kind}")
    check("GET", f"/api/accounts/{account_id}/chats?search=test&page=2&page_size=10")
    check("GET", f"/api/accounts/{account_id}/chats?only_cached=true")

    print("\n[4] Авторизация")
    check("GET", f"/api/auth/{account_id}/state")
    check("GET", f"/api/auth/{account_id}/qr/status")
    check("POST", f"/api/auth/{account_id}/cancel")
    # Dummy credentials: Telegram must reject them, and we must translate it.
    check("POST", f"/api/auth/{account_id}/qr/start", expect=(400, 429))
    check("POST", f"/api/auth/{account_id}/phone/send-code", expect=(400, 429),
          body={"phone": "+10000000000"})

    print("\n[5] Чаты и задачи (несуществующие -> 404)")
    check("GET", "/api/chats/999999", expect=(404,))
    check("GET", "/api/chats/999999/stats", expect=(404,))
    check("GET", "/api/chats/999999/messages", expect=(404,))
    check("GET", "/api/export/jobs")
    check("GET", f"/api/export/jobs?account_id={account_id}&status=all")
    check("GET", "/api/export/jobs/999999", expect=(404,))
    check("GET", "/api/export/jobs/999999/files", expect=(404,))
    check("POST", "/api/export/jobs", expect=(404, 400, 422),
          body={"account_id": account_id, "chat_id": 999999, "options": {}})

    print("\n[6] Логи и файлы")
    check("GET", "/api/logs?limit=5")
    for level in ("INFO", "WARNING", "ERROR", "all"):
        check("GET", f"/api/logs?level={level}&limit=3")
    check("GET", f"/api/logs?account_id={account_id}&limit=3")
    check("GET", "/api/logs?search=TgVault&limit=3")
    check("GET", "/api/logs/files")
    check("GET", "/api/logs/files/app.log?tail=5")
    check("GET", "/api/logs/files/.env", expect=(400, 404))
    check("GET", "/api/files/download?media_id=999999", expect=(404,))
    check("GET", "/api/files/thumb?media_id=999999", expect=(404,))
    check("GET", "/api/files/photo?path=../.env", expect=(403, 404))

    print("\n[6a] open-folder ограничен каталогом данных")
    check("POST", "/api/system/open-folder", expect=(403,), body={"path": "C:\\Windows"})
    check("POST", "/api/system/open-folder", expect=(403,), body={"path": "/etc"})

    print("\n[6b] Обход каталога не выдаёт секреты")
    # %2F survives urllib's path normalisation, so these actually reach the app.
    for path in (
        "/api/logs/files/..%2F..%2F.env",
        "/api/logs/files/..%2F..%2Fsecret.key",
        "/api/files/photo?path=..%2F..%2F.env",
        "/..%2F..%2F.env",
    ):
        check_no_secret(path)

    print("\n[7] Уборка")
    check("DELETE", f"/api/accounts/{account_id}")
    check("GET", f"/api/accounts/{account_id}", expect=(404,))

    print("\n" + "=" * 64)
    if FAILED:
        print(f"ПРОВАЛЕНО: {len(FAILED)} из {PASSED + len(FAILED)}")
        for item in FAILED:
            print(f"  - {item}")
        return 1
    print(f"ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: {PASSED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
