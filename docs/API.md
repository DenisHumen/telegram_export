# REST и WebSocket API

Назад: [README](../README.md) · Смежное: [USAGE](USAGE.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md)

Base URL: `http://127.0.0.1:8077`. Все REST-эндпоинты под префиксом `/api`.
Интерактивная документация (Swagger UI) — <http://127.0.0.1:8077/docs>,
машинная схема — <http://127.0.0.1:8077/openapi.json>.

## Общие правила

* `Content-Type: application/json` на запрос и ответ.
* Аутентификации нет: сервис слушает loopback и рассчитан на локальное использование.
* Даты — ISO-8601 UTC со суффиксом `Z`, например `"2026-08-16T12:34:56.789Z"`.
* Все `id` — числа.
* **Любая ошибка** возвращает тело `{"detail": "человеческий текст", "code": "MACHINE_CODE"}`.
  Ошибки валидации дополнительно содержат `errors` — сырой массив pydantic.
* CORS разрешён для `http://127.0.0.1:{5177,8077}` и `http://localhost:{5177,8077}`.

---

## 1. Служебные

### `GET /api/health`

Проверка живости. Используется `start.sh` и `status.sh`.

```bash
curl http://127.0.0.1:8077/api/health
```

```json
{
  "status": "ok",
  "db": true,
  "redis": true,
  "version": "1.0.0",
  "uptime_seconds": 4271,
  "data_dir": "C:\\Users\\me\\code\\telegram_export_channel\\data",
  "ws_clients": 2
}
```

`status` равен `"degraded"`, если пробный `SELECT 1` не прошёл; `redis: false` означает работу
только на in-process шине. Эндпоинт всегда отвечает 200 — сам факт ответа и есть liveness-сигнал.

### `GET /api/stats`

Сводка по всем аккаунтам для дашборда.

```json
{
  "accounts": 2,
  "authorized_accounts": 1,
  "chats": 214,
  "messages": 48311,
  "media_files": 12904,
  "bytes": 41203847112,
  "jobs": 17,
  "running_jobs": 1
}
```

`media_files` и `bytes` считаются только по файлам со статусом `done`.
`running_jobs` включает `queued`, `running` и `paused`.

---

## 2. Аккаунты

### `GET /api/accounts`

Список всех аккаунтов, отсортирован по `id`. Возвращает `Account[]`.

```json
[
  {
    "id": 1,
    "label": "durov",
    "phone": "+79001234567",
    "tg_user_id": 1000001,
    "username": "durov",
    "first_name": "Pavel",
    "last_name": null,
    "is_premium": true,
    "api_id": 1234567,
    "status": "authorized",
    "last_error": null,
    "proxy": null,
    "connected": true,
    "chats_count": 214,
    "created_at": "2026-08-01T09:12:00.000Z",
    "last_seen_at": "2026-08-16T10:41:03.512Z"
  }
]
```

`status`: `new` | `pending_code` | `pending_password` | `authorized` | `unauthorized` | `error`.
`connected` — есть ли прямо сейчас живой `TelegramClient` в памяти backend'а.

### `POST /api/accounts` → `201`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `label` | `string` (≤128) | нет | имя; пустое → `"Новый аккаунт"`, после входа заменяется username/именем |
| `api_id` | `number \| null` | нет* | из my.telegram.org |
| `api_hash` | `string \| null` (≤64) | нет* | из my.telegram.org |
| `proxy` | `string \| null` (≤255) | нет | `socks5://user:pass@host:port` |

\* если не заданы — берутся `TGV_DEFAULT_API_ID` / `TGV_DEFAULT_API_HASH` из `.env`.
Если и там пусто — `400 API_CREDENTIALS_REQUIRED`.

```bash
curl -X POST http://127.0.0.1:8077/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"label":"Рабочий","api_id":1234567,"api_hash":"0123456789abcdef0123456789abcdef"}'
```

Ответ — объект `Account` со `status: "new"`. Telegram на этом шаге не вызывается.
Событие `account` уходит в WebSocket.

Ошибки: `400 API_CREDENTIALS_REQUIRED`, `422 VALIDATION_ERROR`.

### `GET /api/accounts/{account_id}`

Путь: `account_id: number ≥ 1`. Ответ — `Account`.
Ошибки: `404 ACCOUNT_NOT_FOUND`.

### `PATCH /api/accounts/{account_id}`

| Поле | Тип | Значение |
|---|---|---|
| `label` | `string \| null` (≤128) | новое имя; пустая строка игнорируется |
| `proxy` | `string \| null` (≤255) | новый прокси; пустая строка сбрасывает в `null` |

```bash
curl -X PATCH http://127.0.0.1:8077/api/accounts/1 \
  -H 'Content-Type: application/json' \
  -d '{"proxy":"socks5://127.0.0.1:9050"}'
```

Смена прокси **принудительно отключает** клиента — прокси задаётся при конструировании
`TelegramClient`. При следующем обращении клиент поднимется заново.
Ответ — `Account`. Ошибки: `404 ACCOUNT_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `DELETE /api/accounts/{account_id}`

Отключает клиента и каскадно удаляет чаты, сообщения, файлы и задачи этого аккаунта.
Файлы на диске **не удаляются**.

```json
{ "ok": true }
```

В WebSocket уходит `account` с телом `{"id": 1, "deleted": true}`.
Ошибки: `404 ACCOUNT_NOT_FOUND`.

### `POST /api/accounts/{account_id}/connect`

Поднять клиента из сохранённой сессии без повторного входа. Если сессия ещё жива — статус
становится `authorized`, профиль обновляется; иначе — `unauthorized` с пояснением в `last_error`.

Ответ — `Account`.
Ошибки: `400 NO_SESSION` (`session_enc` пуст), `404 ACCOUNT_NOT_FOUND`.

### `POST /api/accounts/{account_id}/logout`

Вызывает `log_out()` на стороне Telegram (сессия отзывается), отключает клиента, обнуляет
`session_enc`, ставит статус `unauthorized`. Архив в базе сохраняется.

Ответ — `Account`. Ошибки: `404 ACCOUNT_NOT_FOUND`.

### `GET /api/accounts/{account_id}/stats`

```json
{
  "account_id": 1,
  "chats": 214,
  "messages": 48311,
  "media_files": 12904,
  "bytes": 41203847112,
  "jobs": 17,
  "by_kind": { "channel": 120, "supergroup": 58, "user": 30, "bot": 4, "group": 2 }
}
```

`media_files` и `bytes` — только по `status = 'done'`.
Ошибки: `404 ACCOUNT_NOT_FOUND`.

### `POST /api/accounts/{account_id}/chats/sync`

Полный обход диалогов и upsert в таблицу `chats`.

| Поле | Тип | По умолчанию | Значение |
|---|---|---|---|
| `archived` | `boolean \| null` | `null` | `null` — и обычные, и архивные диалоги; `true` — только архив; `false` — только основной список |
| `limit` | `number \| null` (≥1) | `null` | максимум диалогов |
| `with_avatars` | `boolean` | `true` | докачивать аватарки фоновой задачей после ответа |

```bash
curl -X POST http://127.0.0.1:8077/api/accounts/1/chats/sync \
  -H 'Content-Type: application/json' -d '{}'
```

```json
{ "synced": 214, "created": 3, "updated": 211 }
```

По ходу в WebSocket идут события `chat_sync` (каждые 25 диалогов и в конце).
Ошибки: `400 NOT_AUTHORIZED`, `401 NOT_AUTHORIZED` (сессия отвалилась в процессе),
`502 SYNC_FAILED`, `404 ACCOUNT_NOT_FOUND`.

### `GET /api/accounts/{account_id}/chats`

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `search` | `string \| null` | `null` | подстрока в `title` или `username` |
| `kind` | `string` | `all` | `all`, `user`, `bot`, `group`, `supergroup`, `channel` |
| `sort` | `string` | `last_message` | `last_message`, `title`, `messages`, `participants`, `created` |
| `order` | `string` | `desc` | `asc` / `desc` |
| `page` | `number` | `1` | |
| `page_size` | `number` | `50` | максимум 500 |
| `only_cached` | `boolean` | `false` | только чаты с `messages_cached > 0` |

```bash
curl 'http://127.0.0.1:8077/api/accounts/1/chats?kind=channel&sort=messages&order=desc&page_size=20'
```

```json
{
  "items": [
    {
      "id": 5,
      "account_id": 1,
      "tg_chat_id": -1001234567890,
      "kind": "channel",
      "title": "Аналитика",
      "username": "analytics",
      "about": null,
      "participants_count": 15320,
      "is_broadcast": true,
      "is_megagroup": false,
      "is_verified": false,
      "is_scam": false,
      "is_creator": false,
      "is_archived": false,
      "is_pinned": true,
      "photo_path": "avatars/1_-1001234567890.jpg",
      "last_message_id": 4931,
      "last_message_date": "2026-08-16T08:00:00.000Z",
      "unread_count": 12,
      "messages_cached": 4820,
      "media_cached": 1503,
      "bytes_cached": 9184203114,
      "last_synced_at": "2026-08-16T10:40:00.000Z"
    }
  ],
  "total": 120,
  "page": 1,
  "page_size": 20,
  "pages": 6
}
```

`photo_path` отдавать через `GET /api/files/photo?path=…`.
Неизвестное значение `sort` молча падает на `last_message`. `NULL`-даты уходят в конец списка.

---

## 3. Авторизация

Все восемь эндпоинтов возвращают один и тот же объект `AuthState`:

```json
{
  "account_id": 1,
  "status": "qr_waiting",
  "phone": null,
  "qr_url": "tg://login?token=AQAAAB8AAAA…",
  "qr_expires_at": "2026-08-16T10:42:31.000Z",
  "code_type": null,
  "password_hint": null,
  "error": null,
  "error_code": null,
  "retry_after": null,
  "user": null
}
```

| Поле | Значение |
|---|---|
| `status` | `idle` \| `code_sent` \| `password_required` \| `qr_waiting` \| `qr_expired` \| `authorized` \| `error` |
| `qr_url` | строка для генерации QR; рисовать картинку — задача клиента |
| `code_type` | `app`, `sms`, `call`, `flash_call`, `missed_call`, `email`, `fragment`, `firebase`, `email_setup_required` |
| `password_hint` | подсказка к облачному паролю, может быть `null` |
| `error_code` | машинный код последней ошибки входа |
| `retry_after` | секунды до повтора при `FLOOD_WAIT` |
| `user` | при `authorized`: `{id, username, first_name, last_name, phone, is_premium}` |

### `GET /api/auth/{account_id}/state`

Текущее состояние. Если клиент в памяти есть и подключён — состояние сверяется реальным
`is_user_authorized()`. Если клиента нет, но аккаунт в БД `authorized` — вернётся `status: authorized`.

### `POST /api/auth/{account_id}/phone/send-code`

```bash
curl -X POST http://127.0.0.1:8077/api/auth/1/phone/send-code \
  -H 'Content-Type: application/json' -d '{"phone":"+79001234567"}'
```

| Поле | Тип | Ограничения |
|---|---|---|
| `phone` | `string` | 5..32 символа; `+` добавляется автоматически |

Успех — `status: code_sent`, заполнен `code_type`. Аккаунт → `pending_code`.
Если аккаунт уже авторизован, вход завершается сразу и вернётся `authorized`.

Ошибки: `400` с кодами `PHONE_NUMBER_INVALID`, `PHONE_NUMBER_BANNED`,
`PHONE_NUMBER_UNOCCUPIED`, `API_ID_INVALID`, `RPC_ERROR`, `UNKNOWN`;
`429 FLOOD_WAIT` (тело содержит `retry_after`).

```json
{ "detail": "Telegram временно ограничил попытки. Повторите через 86400 с.",
  "code": "FLOOD_WAIT", "retry_after": 86400 }
```

### `POST /api/auth/{account_id}/phone/sign-in`

| Поле | Тип | Ограничения |
|---|---|---|
| `code` | `string` | 1..16 символов; пробелы и дефисы вырезаются |

```bash
curl -X POST http://127.0.0.1:8077/api/auth/1/phone/sign-in \
  -H 'Content-Type: application/json' -d '{"code":"12345"}'
```

Три исхода:

* `status: authorized` — вход завершён, сессия сохранена;
* `status: password_required` — включён 2FA (HTTP 200, это не ошибка);
* HTTP 400 с `PHONE_CODE_INVALID` / `PHONE_CODE_EXPIRED` / `NO_PHONE`, либо `429 FLOOD_WAIT`.

### `POST /api/auth/{account_id}/password`

| Поле | Тип | Ограничения |
|---|---|---|
| `password` | `string` | 1..512 символов |

Успех — `status: authorized`. При неверном пароле — `400 PASSWORD_INVALID`, состояние остаётся
`password_required`, можно повторить без нового кода.

### `POST /api/auth/{account_id}/qr/start`

Тела нет. Выдаёт `status: qr_waiting`, `qr_url`, `qr_expires_at` и запускает фоновое ожидание
сканирования. Если аккаунт уже авторизован — сразу `authorized`.
Ошибки: `400 API_ID_INVALID` / `RPC_ERROR` / `UNKNOWN`, `429 FLOOD_WAIT`.

### `POST /api/auth/{account_id}/qr/refresh`

Тела нет. `QRLogin.recreate()` — новый токен на том же клиенте. Если объекта `QRLogin` уже нет
(например, после рестарта backend'а), вызов прозрачно эквивалентен `qr/start`.

### `GET /api/auth/{account_id}/qr/status`

Тела нет, ошибок не отдаёт. Читает состояние из памяти; если `qr_expires_at` в прошлом —
сам переводит статус в `qr_expired`. Рекомендуемый интервал опроса — 2 с. В сеть Telegram
этот вызов не ходит.

### `POST /api/auth/{account_id}/cancel`

Снимает фоновую задачу ожидания QR и сбрасывает состояние в `idle`. Аккаунт из
`pending_code`/`pending_password` возвращается в `new` (если сессии не было) или `unauthorized`.

---

## 4. Чаты

### `GET /api/chats/{chat_id}`

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `enrich` | `boolean` | `false` | дополнительно запросить у Telegram описание и точное число участников (`GetFullChannel` / `GetFullChat` / `GetFullUser`) |

`enrich=true` — один сетевой round-trip; в массовых списках не используйте.
Счётчики `messages_cached` / `media_cached` / `bytes_cached` пересчитываются при каждом вызове.

Ответ — объект `Chat` (структура как в списке чатов).
Ошибки: `404 CHAT_NOT_FOUND`.

### `GET /api/chats/{chat_id}/stats`

```json
{
  "chat_id": 5,
  "messages": 4820,
  "media_files": 1503,
  "bytes": 9184203114,
  "first_message_date": "2019-03-04T11:20:00.000Z",
  "last_message_date": "2026-08-16T08:00:00.000Z",
  "by_media_type": { "none": 2900, "photo": 1100, "video_note": 210, "voice": 145, "document": 465 },
  "by_month": [ { "month": "2026-01", "count": 312 }, { "month": "2026-02", "count": 289 } ],
  "top_senders": [ { "sender_id": 1000001, "name": "Ivan Petrov", "count": 1204 } ],
  "active_job_id": 12
}
```

`top_senders` — максимум 10. `active_job_id` — id задачи в статусе `queued`/`running`/`paused`
для этого чата, либо `null`.
Ошибки: `404 CHAT_NOT_FOUND`.

### `GET /api/chats/{chat_id}/messages`

Браузер по архиву, читает **только MySQL**.

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `search` | `string \| null` | `null` | подстрока в тексте (`LIKE '%…%'`) |
| `media_type` | `string \| null` | `null` | конкретный тип; `any` — любое медиа; `all` — без фильтра |
| `sender_id` | `number \| null` | `null` | фильтр по отправителю |
| `date_from` | `datetime \| null` | `null` | ISO-8601 |
| `date_to` | `datetime \| null` | `null` | ISO-8601 |
| `sort` | `string` | `date` | `date`, `views`, `type`, `id`. **`size` не поддерживается** и падает на `date` |
| `order` | `string` | `desc` | `asc` / `desc` |
| `page` | `number` | `1` | |
| `page_size` | `number` | `50` | максимум 500 |

```bash
curl 'http://127.0.0.1:8077/api/chats/5/messages?media_type=video_note&order=asc&page_size=2'
```

```json
{
  "items": [
    {
      "id": 91834,
      "tg_message_id": 4830,
      "date": "2026-01-15T09:14:02.000Z",
      "sender_id": 1000001,
      "sender_name": "Ivan Petrov",
      "text": null,
      "media_type": "video_note",
      "has_media": true,
      "grouped_id": null,
      "views": null,
      "reply_to_msg_id": 4829,
      "is_service": false,
      "files": [
        { "id": 5501, "kind": "video_note", "file_name": "video_note_4830.mp4",
          "size": 1841203, "status": "done",
          "rel_path": "media/video_notes/2026-01/2026-01-15_4830_video_note.mp4" }
      ]
    }
  ],
  "total": 210,
  "page": 1,
  "page_size": 2,
  "pages": 105
}
```

`id` — внутренний, `tg_message_id` — из Telegram. Скачивать файл: `GET /api/files/download?media_id=5501`.
Ошибки: `404 CHAT_NOT_FOUND`, `422 VALIDATION_ERROR` (например, неразбираемая дата).

---

## 5. Экспорт

### `POST /api/export/jobs` → `201`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `account_id` | `number` | да | |
| `chat_id` | `number` | да | внутренний id чата |
| `options` | `ExportOptions` | нет | частичный объект; недостающее заполняется дефолтами. Полный справочник — [USAGE §4](USAGE.md#4-exportoptions--полный-справочник) |

```bash
curl -X POST http://127.0.0.1:8077/api/export/jobs \
  -H 'Content-Type: application/json' \
  -d '{"account_id":1,"chat_id":5,"options":{"layout":"by_type_date","formats":["json","html"],"incremental":true}}'
```

```json
{
  "id": 12,
  "account_id": 1,
  "chat_id": 5,
  "chat_title": "Аналитика",
  "status": "queued",
  "phase": "init",
  "options": { "download_media": true, "media_types": ["photo", "video", "video_note", "voice", "audio", "document", "sticker", "animation"], "…": "…" },
  "output_dir": null,
  "total_messages": 0,
  "processed_messages": 0,
  "total_files": 0,
  "downloaded_files": 0,
  "failed_files": 0,
  "skipped_files": 0,
  "bytes_total": 0,
  "bytes_downloaded": 0,
  "speed_bps": 0,
  "eta_seconds": null,
  "error": null,
  "created_at": "2026-08-16T10:15:00.000Z",
  "started_at": null,
  "finished_at": null
}
```

Проверки перед созданием: аккаунт существует и авторизован, чат существует и принадлежит этому
аккаунту, для чата нет активной задачи.

Ошибки: `404 ACCOUNT_NOT_FOUND`, `404 CHAT_NOT_FOUND`, `400 NOT_AUTHORIZED`,
`400 CHAT_ACCOUNT_MISMATCH`, `409 JOB_ALREADY_RUNNING`, `422 VALIDATION_ERROR`.

### `GET /api/export/jobs`

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `account_id` | `number \| null` | `null` | фильтр |
| `chat_id` | `number \| null` | `null` | фильтр |
| `status` | `string \| null` | `null` | конкретный статус; `all` = без фильтра |
| `page` | `number` | `1` | |
| `page_size` | `number` | `50` | максимум 200 |

Ответ — `{items, total, page, page_size, pages}`, сортировка по `id DESC`.

### `GET /api/export/jobs/{job_id}`

Ответ — `ExportJob`. Ошибки: `404 JOB_NOT_FOUND`.

### `POST /api/export/jobs/{job_id}/pause`

Допустимо только из `running` или `queued`.
Ошибки: `400 BAD_STATE`, `404 JOB_NOT_FOUND`. Ответ — `ExportJob` со `status: paused`.

### `POST /api/export/jobs/{job_id}/resume`

Допустимо только из `paused`. Если задача жива в памяти — продолжается с той же точки
(`status: running`); если процесс перезапускался — возвращается в очередь (`status: queued`).
Ошибки: `400 BAD_STATE`, `404 JOB_NOT_FOUND`.

### `POST /api/export/jobs/{job_id}/cancel`

Недопустимо для `completed`, `cancelled`, `failed`.
Ошибки: `400 BAD_STATE`, `404 JOB_NOT_FOUND`. Скачанные файлы остаются на диске.

### `DELETE /api/export/jobs/{job_id}`

Удаляет запись задачи и каскадно её события.

```json
{ "ok": true }
```

Ошибки: `409 JOB_RUNNING` (сначала остановите), `404 JOB_NOT_FOUND`.

### `GET /api/export/jobs/{job_id}/events`

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `after_id` | `number` | `0` | вернуть события с `id > after_id` — для инкрементальной подгрузки |
| `limit` | `number` | `200` | 1..1000 |

```json
[
  { "id": 501, "job_id": 12, "ts": "2026-08-16T10:15:00.120Z", "level": "info",
    "message": "Задача создана и поставлена в очередь", "data": null },
  { "id": 507, "job_id": 12, "ts": "2026-08-16T10:31:44.900Z", "level": "warning",
    "message": "Ограничение Telegram (FloodWait): пауза 300 с", "data": { "seconds": 300 } }
]
```

Порядок — по возрастанию `id`. Ошибки: `404 JOB_NOT_FOUND`.

### `POST /api/export/jobs/{job_id}/rebuild`

Пересобрать выходные файлы **из базы**, без обращения к Telegram. Все поля необязательны;
`null` игнорируется.

| Поле | Тип | Значение |
|---|---|---|
| `formats` | `string[] \| null` | какие отчёты писать |
| `layout` | `string \| null` | записывается в `job.options` и манифест; **файлы не перемещаются** |
| `sort_field` | `string \| null` | порядок сообщений в отчётах |
| `sort_order` | `string \| null` | `asc` / `desc` |

```bash
curl -X POST http://127.0.0.1:8077/api/export/jobs/12/rebuild \
  -H 'Content-Type: application/json' \
  -d '{"formats":["json","jsonl","csv","txt","html"]}'
```

Ответ — `ExportJob` плюс поле `written`:

```json
{ "id": 12, "status": "completed", "…": "…",
  "written": ["manifest.json","messages.json","messages.jsonl","messages.csv","messages.txt","index.html","assets/data.js"] }
```

Ошибки: `400 NO_OUTPUT_DIR` (у задачи ещё нет каталога), `500 REBUILD_FAILED`, `404 JOB_NOT_FOUND`.

### `GET /api/export/jobs/{job_id}/manifest`

Отдаёт содержимое `manifest.json` из каталога задачи как JSON. Структура — [USAGE §7](USAGE.md#7-форматы-вывода).
Ошибки: `404 NO_OUTPUT_DIR`, `404 NO_MANIFEST` (файла нет — сделайте `rebuild`),
`500 MANIFEST_UNREADABLE`, `404 JOB_NOT_FOUND`.

---

## 6. Логи, файлы, система

### `GET /api/logs`

Журнал из таблицы `app_logs`.

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `level` | `string \| null` | `null` | `INFO`/`WARNING`/`ERROR`/`CRITICAL`; `all` — без фильтра. Регистр не важен |
| `account_id` | `number \| null` | `null` | фильтр |
| `job_id` | `number \| null` | `null` | фильтр |
| `search` | `string \| null` | `null` | подстрока в тексте |
| `limit` | `number` | `200` | 1..1000 |
| `after_id` | `number` | `0` | `> 0` — только новые записи в порядке возрастания `id` (хвост); `0` — последние `limit` записей, развёрнутые по возрастанию |

```json
[
  { "id": 8811, "ts": "2026-08-16T10:31:44.902Z", "level": "WARNING",
    "logger": "tgvault.export", "message": "[job 12] Ограничение Telegram (FloodWait): пауза 300 с",
    "account_id": 1, "job_id": 12, "data": null }
]
```

### `GET /api/logs/files`

Список файлов из `data/logs/` (маска `*.log*`, включая ротированные `app.log.1`).

```json
[ { "name": "app.log", "size": 4812390, "modified": 1786000263 } ]
```

`modified` — Unix-время в секундах.

### `GET /api/logs/files/{name}`

| Параметр | Тип | По умолчанию | Значение |
|---|---|---|---|
| `name` | path, `string` | — | только имя файла; слэши, обратные слэши и ведущая точка запрещены |
| `tail` | `number` | `500` | 1..5000, последние N строк |

```bash
curl 'http://127.0.0.1:8077/api/logs/files/telegram.log?tail=100'
```

```json
{ "name": "telegram.log", "lines": ["2026-08-16 10:31:44 INFO    [telethon.client…] …"] }
```

Ошибки: `400 BAD_FILENAME`, `404 LOG_NOT_FOUND`, `500 LOG_UNREADABLE`.

### `GET /api/files/download`

| Параметр | Тип | Обяз. | Значение |
|---|---|---|---|
| `media_id` | `number` | да | `media_files.id` |

Возвращает бинарный поток с `Content-Disposition` (имя из `file_name`) и MIME-типом из базы.
Путь проверяется: файл обязан находиться внутри `TGV_DATA_DIR`.

Ошибки: `404 FILE_NOT_FOUND` (нет записи, пустой `abs_path` или файла нет на диске),
`403 PATH_FORBIDDEN` (путь вне каталога данных).

### `GET /api/files/photo`

| Параметр | Тип | Обяз. | Значение |
|---|---|---|---|
| `path` | `string` | да | значение `chat.photo_path`, относительно `data/` |

```bash
curl 'http://127.0.0.1:8077/api/files/photo?path=avatars/1_-1001234567890.jpg' -o avatar.jpg
```

Отдаётся как `image/jpeg`. Ошибки: `400 BAD_PATH`, `403 PATH_FORBIDDEN`, `404 FILE_NOT_FOUND`.

### `POST /api/system/open-folder`

Открывает каталог в файловом менеджере ОС (`os.startfile` / `open` / `xdg-open`).
Работает только потому, что backend локальный.

| Поле | Тип | Обяз. |
|---|---|---|
| `path` | `string` | да |

```bash
curl -X POST http://127.0.0.1:8077/api/system/open-folder \
  -H 'Content-Type: application/json' \
  -d '{"path":"C:/Users/me/code/telegram_export_channel/data/exports/analytics_-1001234567890_20260816-101500"}'
```

```json
{ "ok": true }
```

Ошибки: `404 DIR_NOT_FOUND`, `500 OPEN_FAILED`.

> **Примечание:** этот эндпоинт, в отличие от `/api/files/*`, **не** ограничивает путь каталогом
> данных. Он рассчитан на локальный однопользовательский сценарий; не выставляйте backend наружу.

---

## 7. WebSocket

```
ws://127.0.0.1:8077/ws
```

В dev-режиме Vite проксирует `/ws` на backend, поэтому со страницы на `5177` адрес тот же
относительно текущего хоста.

Аутентификации, подписок и фильтров нет: сокет получает **все** события, фильтрация — на клиенте.
Каждый клиент имеет собственную очередь на 512 сообщений; при переполнении отбрасывается самое
старое, поэтому медленная вкладка не тормозит экспорт.

Сразу после подключения приходит:

```json
{ "type": "hello", "ts": null, "version": "1.0.0" }
```

(`ts` в hello действительно `null` — см. [ARCHITECTURE §5](ARCHITECTURE.md#5-отклонения-от-контракта).)

Все последующие события имеют форму `{ "type": …, "ts": "ISO-8601Z", "payload": … }`.

| `type` | Когда | `payload` |
|---|---|---|
| `auth_state` | любое изменение хода авторизации | объект `AuthState` |
| `account` | создание, изменение, подключение, разлогин, удаление аккаунта | объект `Account`; при удалении — `{"id": 1, "deleted": true}` |
| `chat_sync` | ход синхронизации диалогов | `{account_id, synced, done}` |
| `job_progress` | создание задачи, каждые ~0.7 с во время работы, смена статуса, завершение | объект `ExportJob` |
| `job_event` | новая строка в таймлайне задачи | `{id, job_id, ts, level, message, data}` |
| `log` | новая строка журнала уровня INFO+ | `{id, ts, level, logger, message, account_id, job_id, data}` |

Примеры:

```json
{ "type": "job_progress", "ts": "2026-08-16T10:32:10.441Z",
  "payload": { "id": 12, "status": "running", "phase": "downloading",
               "processed_messages": 1820, "total_messages": 4820,
               "downloaded_files": 640, "total_files": 1503,
               "bytes_downloaded": 3141592653, "speed_bps": 1048576, "eta_seconds": 5721 } }
```

```json
{ "type": "chat_sync", "ts": "2026-08-16T10:40:12.003Z",
  "payload": { "account_id": 1, "synced": 175, "done": false } }
```

```json
{ "type": "auth_state", "ts": "2026-08-16T10:41:00.115Z",
  "payload": { "account_id": 1, "status": "password_required", "password_hint": "город", "…": "…" } }
```

### ping / pong

Клиент может слать:

```json
{ "type": "ping" }
```

Сервер немедленно ответит `{"type": "pong"}`. Никакие другие входящие сообщения не обрабатываются
(нераспознанный JSON и невалидные строки просто игнорируются).

Дополнительно сервер сам шлёт **незапрошенный** `{"type": "pong"}` **каждые 25 секунд** как
heartbeat, чтобы промежуточные прокси не закрывали простаивающий сокет. Клиент должен спокойно
переносить `pong` без предшествующего `ping`.

### Переподключение

Логика переподключения целиком на клиенте. Рекомендуемая схема:

1. `onclose` / `onerror` → переподключаться с экспоненциальным backoff (например 1 с → 2 → 4 → 8,
   потолок 30 с) и небольшим случайным джиттером;
2. считать соединение мёртвым, если больше ~60 секунд не пришло ни одного кадра (heartbeat идёт
   каждые 25 с);
3. **после реконнекта перечитать состояние через REST** — события, пришедшие в момент разрыва,
   не буферизуются и не переигрываются. Достаточно: `GET /api/export/jobs?status=all`,
   `GET /api/accounts`, при активной авторизации — `GET /api/auth/{id}/state`;
4. для таймлайна задачи догружать пропущенное через
   `GET /api/export/jobs/{id}/events?after_id=<последний известный id>`;
5. то же для журнала: `GET /api/logs?after_id=<последний известный id>`.

WebSocket здесь — оптимизация отзывчивости, а не единственный источник истины. Любое состояние
доступно через REST.

---

## 8. Коды ошибок

Формат тела всегда: `{"detail": "...", "code": "..."}`; при `FLOOD_WAIT` добавляется `retry_after`,
при `VALIDATION_ERROR` — `errors`.

### Общие

| `code` | HTTP | Что случилось | Что делать клиенту |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | тело или query не прошли валидацию pydantic | показать `detail`, подсветить поле из `errors[0].loc` |
| `INTERNAL_ERROR` | 500 | необработанное исключение | показать ошибку, предложить посмотреть `data/logs/error.log` |
| `HTTP_<код>` | 4xx/5xx | `HTTPException` без явного кода (например `HTTP_404` на неизвестный путь) | обработать по HTTP-статусу |
| `ERROR` | любой | значение по умолчанию `ApiError`, в коде не используется | обработать по HTTP-статусу |

### Ресурсы

| `code` | HTTP | Что случилось | Что делать клиенту |
|---|---|---|---|
| `ACCOUNT_NOT_FOUND` | 404 | нет аккаунта с таким id | обновить список аккаунтов |
| `CHAT_NOT_FOUND` | 404 | нет чата с таким id | пересинхронизировать чаты |
| `JOB_NOT_FOUND` | 404 | нет задачи с таким id | обновить список задач |
| `API_CREDENTIALS_REQUIRED` | 400 | не заданы `api_id`/`api_hash` и нет дефолтов в `.env` | вернуть пользователя в форму, ссылка на my.telegram.org |
| `NO_SESSION` | 400 | `connect` для аккаунта без сохранённой сессии | отправить на вход по QR или коду |
| `NOT_AUTHORIZED` | 400 / 401 | аккаунт не в статусе `authorized` (или сессия отвалилась при синке) | запустить сценарий входа заново |
| `SYNC_FAILED` | 502 | синхронизация диалогов упала | показать `detail`, дать кнопку «Повторить» |

### Экспорт

| `code` | HTTP | Что случилось | Что делать клиенту |
|---|---|---|---|
| `CHAT_ACCOUNT_MISMATCH` | 400 | чат принадлежит другому аккаунту | выбрать чат из списка того же аккаунта |
| `JOB_ALREADY_RUNNING` | 409 | для чата уже есть активная задача | открыть существующую задачу (её id есть в `detail`) |
| `BAD_STATE` | 400 | pause/resume/cancel недопустимы в текущем статусе | перечитать задачу и перерисовать кнопки |
| `JOB_RUNNING` | 409 | удаление выполняющейся задачи | сначала `cancel`, потом `DELETE` |
| `NO_OUTPUT_DIR` | 400 / 404 | у задачи ещё нет каталога вывода | дождаться старта или выполнить экспорт |
| `NO_MANIFEST` | 404 | `manifest.json` отсутствует | предложить `POST .../rebuild` |
| `MANIFEST_UNREADABLE` | 500 | файл манифеста повреждён | предложить `rebuild` |
| `REBUILD_FAILED` | 500 | пересборка упала | показать `detail`, отправить в логи |

### Файлы и логи

| `code` | HTTP | Что случилось | Что делать клиенту |
|---|---|---|---|
| `FILE_NOT_FOUND` | 404 | нет записи в `media_files`, пустой `abs_path` или файла нет на диске | пометить файл как отсутствующий, предложить перекачать |
| `PATH_FORBIDDEN` | 403 | путь вне `TGV_DATA_DIR` | не повторять запрос — это ошибка клиента |
| `BAD_PATH` | 400 | пустой параметр `path` | исправить запрос |
| `BAD_FILENAME` | 400 | в имени лог-файла есть слэш или ведущая точка | брать имена из `GET /api/logs/files` |
| `LOG_NOT_FOUND` | 404 | файла лога нет | обновить список файлов |
| `LOG_UNREADABLE` | 500 | файл не читается (права, блокировка) | показать `detail` |
| `DIR_NOT_FOUND` | 404 | каталог для `open-folder` не существует | обновить данные задачи |
| `OPEN_FAILED` | 500 | ОС не смогла открыть каталог | показать путь текстом, чтобы можно было скопировать |

### Авторизация (`error_code` в `AuthState` и `code` в ошибке)

| `code` | HTTP | Что случилось | Что делать клиенту |
|---|---|---|---|
| `FLOOD_WAIT` | 429 | Telegram ограничил попытки | ждать `retry_after` секунд, показать обратный отсчёт, не ретраить автоматически |
| `PHONE_CODE_INVALID` | 400 | неверный код | дать ввести код заново |
| `PHONE_CODE_EXPIRED` | 400 | код истёк | запросить новый через `phone/send-code` |
| `PASSWORD_INVALID` | 400 | неверный облачный пароль | дать ввести пароль заново; состояние остаётся `password_required` |
| `PHONE_NUMBER_INVALID` | 400 | некорректный номер | исправить номер |
| `PHONE_NUMBER_BANNED` | 400 | номер заблокирован в Telegram | тупик — писать в поддержку Telegram |
| `PHONE_NUMBER_UNOCCUPIED` | 400 | на номере нет аккаунта | зарегистрировать аккаунт в официальном клиенте |
| `API_ID_INVALID` | 400 | неверная пара `api_id`/`api_hash` | исправить через `PATCH` или пересоздать аккаунт |
| `AUTH_KEY_UNREGISTERED` | 400 | сессия отозвана | полный повторный вход |
| `NO_PHONE` | 400 | `sign-in` без предшествующего `send-code` | сначала `phone/send-code` |
| `RPC_ERROR` | 400 | прочая ошибка MTProto | показать `detail` |
| `UNKNOWN` | 400 | неопознанное исключение | показать `detail`, отправить в логи |
| `CONNECT_FAILED` | — | не удалось подключиться к Telegram (сеть, прокси). Приходит **только** в `AuthState.error_code`, HTTP-ошибкой не становится | проверить сеть и прокси, повторить |

Все коды из этой таблицы, кроме `CONNECT_FAILED`, приходят и как `code` в теле HTTP-ошибки,
и как `AuthState.error_code` в WebSocket-событии `auth_state`.
