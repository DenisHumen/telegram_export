# TgVault — Контракт системы (single source of truth)

> Этот файл — единственный источник истины для backend, frontend и документации.
> Любое расхождение кода с этим файлом = баг.

## 0. Название и стек

**Проект:** `TgVault` — экспортёр Telegram-каналов/чатов с локальным архивом.

| Слой | Технология |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn, asyncio |
| Telegram | Telethon (MTProto, user-account) |
| ORM | SQLAlchemy 2.0 (async) + aiomysql |
| БД | MySQL 8.0 (через Docker) |
| Кэш/шина | Redis 7 (через Docker), fallback — in-memory |
| Шифрование | `cryptography` Fernet (сессии Telegram в БД) |
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Запуск | `./start.sh` (Git Bash / WSL / Linux / macOS) |

Порты: backend `8077`, frontend dev `5177`, MySQL `13306`, Redis `16379`
(нестандартные — чтобы не конфликтовать с локальными сервисами).

Base URL API: `http://127.0.0.1:8077`, все REST-эндпоинты под префиксом `/api`.
Frontend в dev-режиме проксирует `/api` и `/ws` на backend.

---

## 1. Файловая структура проекта

```
telegram_export_channel/
├── start.sh                  # ЕДИНСТВЕННАЯ точка запуска
├── stop.sh                   # остановка всего
├── .env.example
├── .env                      # создаётся start.sh из .env.example
├── .gitignore
├── README.md
├── docs/
│   ├── CONTRACT.md           # этот файл
│   ├── TELETHON_REFERENCE.md
│   ├── ARCHITECTURE.md
│   ├── SETUP.md
│   ├── USAGE.md
│   ├── DATABASE.md
│   ├── API.md
│   └── TROUBLESHOOTING.md
├── docker/
│   └── docker-compose.yml    # mysql + redis
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # FastAPI app + lifespan
│   │   ├── config.py         # pydantic-settings
│   │   ├── logging_setup.py  # файловые + БД + Redis логи
│   │   ├── crypto.py         # Fernet
│   │   ├── bus.py            # Redis pub/sub + fallback
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── models.py
│   │   │   ├── session.py
│   │   │   └── bootstrap.py  # create_all + миграции
│   │   ├── tg/
│   │   │   ├── __init__.py
│   │   │   ├── manager.py    # пул TelegramClient по account_id
│   │   │   ├── auth.py       # phone / code / 2FA / QR
│   │   │   ├── dialogs.py    # синк чатов
│   │   │   ├── extract.py    # Message -> dict (типизация медиа)
│   │   │   └── exporter.py   # движок экспорта
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── options.py    # ExportOptions (отдельно — во избежание циклов)
│   │   │   ├── accounts.py
│   │   │   ├── chats.py
│   │   │   ├── jobs.py
│   │   │   ├── layout.py     # стратегии раскладки файлов
│   │   │   └── render.py     # JSON/HTML/CSV/TXT
│   │   └── api/
│   │       ├── __init__.py
│   │       ├── schemas.py    # pydantic DTO
│   │       ├── deps.py
│   │       ├── routes_accounts.py
│   │       ├── routes_auth.py
│   │       ├── routes_chats.py
│   │       ├── routes_export.py
│   │       ├── routes_logs.py
│   │       └── ws.py
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── api/client.ts     # fetch-обёртка
│       ├── api/types.ts      # ЗЕРКАЛО раздела 4 этого файла
│       ├── hooks/…
│       ├── components/…
│       └── pages/…
│   └── tests/                # smoke.py, api_smoke.py, fakes.py
└── data/                     # НЕ в git
    ├── logs/                 # app.log, error.log, telegram.log, backend.out.log
    ├── exports/              # результаты экспорта
    ├── avatars/              # аватарки чатов (для списка чатов в UI)
    ├── run/                  # PID-файлы запущенных процессов
    ├── .stamps/              # хеши установленных зависимостей (для start.sh)
    └── secret.key            # ключ Fernet (генерируется автоматически)
```

---

## 2. Схема БД (MySQL 8, utf8mb4)

Все таблицы `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
Все `id` — `BIGINT AUTO_INCREMENT PRIMARY KEY`.
Всё, что приходит из Telegram, дополнительно сохраняется в колонку `raw JSON`
(компактное подмножество полей, а не полный `to_dict()` — иначе база растёт кратно).

> **Реализация:** колонки, описанные ниже как `ENUM(...)`, в коде объявлены как
> `VARCHAR` с набором допустимых значений в `app/db/base.py` (`ACCOUNT_STATUSES`,
> `CHAT_KINDS`, `MEDIA_TYPES`, `JOB_STATUSES`, `FILE_STATUSES`). Так добавление
> нового значения не требует `ALTER TABLE ... MODIFY COLUMN` на большой таблице.
> На API это никак не влияет — набор значений тот же.

### 2.1 `accounts` — Telegram-аккаунты (их может быть много)

| Колонка | Тип | Описание |
|---|---|---|
| id | BIGINT PK | |
| label | VARCHAR(128) | человекочитаемое имя, задаёт пользователь |
| phone | VARCHAR(32) NULL | |
| tg_user_id | BIGINT NULL | id пользователя в Telegram |
| username | VARCHAR(64) NULL | |
| first_name | VARCHAR(128) NULL | |
| last_name | VARCHAR(128) NULL | |
| is_premium | TINYINT(1) DEFAULT 0 | |
| api_id | INT NOT NULL | из my.telegram.org |
| api_hash | VARCHAR(64) NOT NULL | |
| session_enc | TEXT NULL | StringSession, зашифрован Fernet |
| dc_id | INT NULL | |
| status | ENUM('new','pending_code','pending_password','authorized','unauthorized','error') DEFAULT 'new' |
| last_error | TEXT NULL | |
| proxy | VARCHAR(255) NULL | `socks5://user:pass@host:port` (опц.) |
| created_at / updated_at / last_seen_at | DATETIME | |

Индексы: `UNIQUE(tg_user_id)` (nullable), `INDEX(status)`.

### 2.2 `chats` — диалоги/каналы аккаунта

| Колонка | Тип | Описание |
|---|---|---|
| id | BIGINT PK | внутренний |
| account_id | BIGINT FK accounts.id ON DELETE CASCADE | |
| tg_chat_id | BIGINT NOT NULL | «сырой» peer id из Telethon (`dialog.id`) |
| access_hash | BIGINT NULL | |
| kind | ENUM('user','bot','group','supergroup','channel') NOT NULL | |
| title | VARCHAR(512) | |
| username | VARCHAR(64) NULL | |
| about | TEXT NULL | |
| participants_count | INT NULL | |
| is_broadcast / is_megagroup / is_verified / is_scam / is_creator / is_archived / is_pinned | TINYINT(1) | |
| photo_path | VARCHAR(768) NULL | путь к аватарке относительно `data/` |
| last_message_id | BIGINT NULL | |
| last_message_date | DATETIME NULL | |
| unread_count | INT DEFAULT 0 | |
| messages_cached | INT DEFAULT 0 | сколько сообщений уже в нашей БД |
| media_cached | INT DEFAULT 0 | |
| bytes_cached | BIGINT DEFAULT 0 | |
| last_synced_at | DATETIME NULL | |
| raw | JSON NULL | |
| created_at / updated_at | DATETIME | |

Индексы: `UNIQUE(account_id, tg_chat_id)`, `INDEX(account_id, kind)`, `INDEX(account_id, last_message_date)`, `INDEX(title(191))`.

### 2.3 `messages`

| Колонка | Тип |
|---|---|
| id | BIGINT PK |
| account_id | BIGINT FK |
| chat_id | BIGINT FK chats.id ON DELETE CASCADE |
| tg_message_id | BIGINT NOT NULL |
| date | DATETIME(3) NOT NULL |
| edit_date | DATETIME(3) NULL |
| sender_id | BIGINT NULL |
| sender_name | VARCHAR(255) NULL |
| sender_username | VARCHAR(64) NULL |
| post_author | VARCHAR(128) NULL |
| text | MEDIUMTEXT NULL |
| text_html | MEDIUMTEXT NULL (текст с применёнными entities) |
| entities | JSON NULL |
| media_type | ENUM('none','photo','video','video_note','voice','audio','document','sticker','animation','contact','poll','geo','venue','webpage','game','invoice','dice','unsupported') DEFAULT 'none' |
| has_media | TINYINT(1) DEFAULT 0 |
| grouped_id | BIGINT NULL (альбом) |
| reply_to_msg_id | BIGINT NULL |
| fwd_from_name | VARCHAR(255) NULL |
| fwd_from_id | BIGINT NULL |
| fwd_from_date | DATETIME NULL |
| fwd_from_post_id | BIGINT NULL |
| views | INT NULL |
| forwards | INT NULL |
| replies_count | INT NULL |
| reactions | JSON NULL |
| is_service | TINYINT(1) DEFAULT 0 |
| service_action | VARCHAR(64) NULL |
| is_pinned | TINYINT(1) DEFAULT 0 |
| is_outgoing | TINYINT(1) DEFAULT 0 |
| raw | JSON NULL |
| created_at | DATETIME |

Индексы: `UNIQUE(chat_id, tg_message_id)`, `INDEX(chat_id, date)`, `INDEX(chat_id, media_type)`, `INDEX(chat_id, grouped_id)`, `INDEX(sender_id)`.

> Полнотекстового индекса нет намеренно: поиск по сообщениям подстрочный
> (`LIKE '%…%'`), а `FULLTEXT` работает по словам — запрос «порт» не нашёл бы
> «экспорт». `bootstrap.py` удаляет такой индекс, если он остался от ранней версии.

### 2.4 `media_files`

| Колонка | Тип |
|---|---|
| id | BIGINT PK |
| account_id / chat_id / message_id | BIGINT FK |
| tg_message_id | BIGINT |
| kind | VARCHAR(24) — `photo\|video\|video_note\|voice\|audio\|document\|sticker\|animation\|thumb\|avatar` |
| tg_file_id | BIGINT NULL (document.id / photo.id) |
| access_hash | BIGINT NULL |
| file_unique | VARCHAR(96) NULL — стабильный ключ дедупликации: `"{kind}:{tg_file_id}"` |
| file_name | VARCHAR(512) NULL |
| ext | VARCHAR(16) NULL |
| mime_type | VARCHAR(128) NULL |
| size | BIGINT NULL |
| width / height | INT NULL |
| duration | INT NULL (сек) |
| rel_path | VARCHAR(768) NULL — путь относительно каталога экспорта |
| abs_path | VARCHAR(1024) NULL |
| sha256 | CHAR(64) NULL |
| status | ENUM('pending','downloading','done','failed','skipped') DEFAULT 'pending' |
| error | TEXT NULL |
| attempts | INT DEFAULT 0 |
| downloaded_at | DATETIME NULL |
| created_at | DATETIME |

Индексы: `INDEX(message_id)`, `INDEX(chat_id, kind)`, `INDEX(status)`, `INDEX(chat_id, file_unique)`.

### 2.5 `export_jobs`

| Колонка | Тип |
|---|---|
| id | BIGINT PK |
| account_id / chat_id | BIGINT FK |
| status | ENUM('queued','running','paused','completed','failed','cancelled') DEFAULT 'queued' |
| options | JSON NOT NULL (см. §4.6 `ExportOptions`) |
| output_dir | VARCHAR(1024) NULL |
| phase | VARCHAR(32) — `init\|counting\|fetching\|downloading\|rendering\|done` |
| total_messages / processed_messages | INT DEFAULT 0 |
| total_files / downloaded_files / failed_files / skipped_files | INT DEFAULT 0 |
| bytes_total / bytes_downloaded | BIGINT DEFAULT 0 |
| min_id / max_id / last_processed_id | BIGINT NULL |
| speed_bps | BIGINT DEFAULT 0 |
| eta_seconds | INT NULL |
| error | TEXT NULL |
| created_at / started_at / finished_at | DATETIME |

Индексы: `INDEX(account_id, status)`, `INDEX(chat_id)`, `INDEX(status)`.

### 2.6 `job_events`

| id | job_id FK ON DELETE CASCADE | ts DATETIME(3) | level VARCHAR(8) | message TEXT | data JSON NULL |

Индекс: `INDEX(job_id, id)`.

### 2.7 `app_logs`

| id | ts DATETIME(3) | level VARCHAR(8) | logger VARCHAR(64) | message TEXT | account_id BIGINT NULL | job_id BIGINT NULL | data JSON NULL |

Индексы: `INDEX(ts)`, `INDEX(level)`, `INDEX(account_id)`, `INDEX(job_id)`.

### 2.8 `settings`

| `skey` VARCHAR(64) PK | `svalue` JSON | updated_at |

---

## 3. Логика авторизации (важно!)

Один `TelegramClient` на аккаунт живёт в памяти backend'а (`TelegramManager`), потому что
`send_code_request` и `sign_in` обязаны выполняться на **одном и том же** живом подключении.

Состояния (`AuthState.status`):

```
idle              — клиент не подключён / нет активной попытки
code_sent         — код отправлен, ждём код от пользователя
password_required — код принят (или QR отсканирован), нужен облачный пароль 2FA
qr_waiting        — показан QR, ждём сканирования
qr_expired        — QR протух, нужен refresh
authorized        — успех
error             — ошибка (см. поле error)
```

Сценарий QR: `POST /api/auth/{id}/qr/start` → возвращает `url` (`tg://login?token=…`)
и `expires_at`. Фронт рисует QR из `url` (библиотека `qrcode.react`) и опрашивает
`GET /api/auth/{id}/qr/status` каждые 2 сек. Backend внутри ждёт `qr_login.wait()`.
Если пришёл `SessionPasswordNeededError` → статус `password_required`,
дальше `POST /api/auth/{id}/password`.
Если истёк — статус `qr_expired`, фронт зовёт `POST /api/auth/{id}/qr/refresh`.

**Пароль 2FA запрашивается всегда, если он включён на аккаунте** — и при входе по коду,
и при входе по QR. Это нормальное поведение Telegram, а не ошибка.

---

## 4. REST API

Общие правила:
* Content-Type: `application/json`.
* Ошибка: HTTP 4xx/5xx + тело `{ "detail": "...", "code": "MACHINE_CODE" }`.
* Даты — ISO-8601 UTC строки: `"2026-08-16T12:34:56.789Z"`.
* Все `id` в JSON — **числа** (JS-safe: реальные значения < 2^53).

### 4.0 Служебное

```
GET /api/health -> { "status":"ok"|"degraded", "db":true, "redis":true, "version":"1.0.0",
                     "uptime_seconds":123, "data_dir":"…", "ws_clients":1 }

GET /api/stats  -> { "accounts":2, "authorized_accounts":1, "chats":140, "messages":12045,
                     "media_files":3120, "bytes":48239123456, "jobs":7, "running_jobs":1 }
```

### 4.1 Аккаунты

```
GET    /api/accounts                    -> Account[]
POST   /api/accounts                    { label, api_id, api_hash, proxy? } -> Account   [201]
GET    /api/accounts/{id}               -> Account
PATCH  /api/accounts/{id}               { label?, proxy? }                  -> Account
DELETE /api/accounts/{id}               -> { ok: true }   (каскадно удаляет чаты/сообщения)
POST   /api/accounts/{id}/logout        -> Account        (разлогин в Telegram, чистит сессию)
POST   /api/accounts/{id}/connect       -> Account        (поднять клиента из сохранённой сессии)
GET    /api/accounts/{id}/stats         -> AccountStats
```

```ts
type AccountStatus = 'new'|'pending_code'|'pending_password'|'authorized'|'unauthorized'|'error';

interface Account {
  id: number; label: string; phone: string | null;
  tg_user_id: number | null; username: string | null;
  first_name: string | null; last_name: string | null;
  is_premium: boolean; api_id: number;
  status: AccountStatus; last_error: string | null;
  proxy: string | null; connected: boolean;   // клиент сейчас в памяти и online
  chats_count: number; created_at: string; last_seen_at: string | null;
}

interface AccountStats {
  account_id: number; chats: number; messages: number;
  media_files: number; bytes: number; jobs: number;
  by_kind: Record<string, number>;   // 'channel' -> 12
}
```

### 4.2 Авторизация

```
GET  /api/auth/{account_id}/state              -> AuthState
POST /api/auth/{account_id}/phone/send-code    { phone }     -> AuthState
POST /api/auth/{account_id}/phone/sign-in      { code }      -> AuthState
POST /api/auth/{account_id}/password           { password }  -> AuthState
POST /api/auth/{account_id}/qr/start           -> AuthState  (status=qr_waiting, qr_url)
POST /api/auth/{account_id}/qr/refresh         -> AuthState
GET  /api/auth/{account_id}/qr/status          -> AuthState
POST /api/auth/{account_id}/cancel             -> AuthState  (status=idle)
```

```ts
type AuthStatus = 'idle'|'code_sent'|'password_required'|'qr_waiting'|'qr_expired'|'authorized'|'error';

interface AuthState {
  account_id: number;
  status: AuthStatus;
  phone: string | null;
  qr_url: string | null;         // tg://login?token=…  (рисуем QR из этой строки)
  qr_expires_at: string | null;
  code_type: string | null;      // 'app' | 'sms' | 'call' | 'flash_call' | ...
  password_hint: string | null;
  error: string | null;
  error_code: string | null;     // PHONE_CODE_INVALID | PASSWORD_INVALID | FLOOD_WAIT | ...
  retry_after: number | null;    // секунды, при FLOOD_WAIT
  user: { id: number; username: string|null; first_name: string|null;
          last_name: string|null; phone: string|null; is_premium: boolean } | null;
}
```

### 4.3 Чаты

```
POST /api/accounts/{id}/chats/sync   { archived?: boolean, limit?: number,
                                       with_avatars?: boolean }
     -> { synced: number, created: number, updated: number }

GET  /api/accounts/{id}/chats
     ?search=&kind=all|user|bot|group|supergroup|channel
     &sort=last_message|title|messages|participants|created
     &order=asc|desc&page=1&page_size=50&only_cached=false
     -> Paginated<Chat>

GET  /api/chats/{chat_id}?enrich=false   -> Chat
     // enrich=true дополнительно тянет из Telegram описание и число участников
GET  /api/chats/{chat_id}/stats      -> ChatStats
GET  /api/chats/{chat_id}/messages
     ?search=&media_type=&sender_id=&date_from=&date_to=
     &sort=date|size|views|type|sender|id&order=asc|desc&page=&page_size=
     -> Paginated<MessageRow>
     // media_type=any — только сообщения с вложениями
```

```ts
interface Chat {
  id: number; account_id: number; tg_chat_id: number;
  kind: 'user'|'bot'|'group'|'supergroup'|'channel';
  title: string; username: string | null; about: string | null;
  participants_count: number | null;
  is_broadcast: boolean; is_megagroup: boolean; is_verified: boolean;
  is_scam: boolean; is_creator: boolean; is_archived: boolean; is_pinned: boolean;
  photo_path: string | null;          // отдавать через GET /api/files/photo?path=…
  last_message_id: number | null; last_message_date: string | null;
  unread_count: number;
  messages_cached: number; media_cached: number; bytes_cached: number;
  last_synced_at: string | null;
}

interface ChatStats {
  chat_id: number; messages: number; media_files: number; bytes: number;
  first_message_date: string | null; last_message_date: string | null;
  by_media_type: Record<string, number>;
  by_month: { month: string; count: number }[];   // '2026-01'
  top_senders: { sender_id: number; name: string; count: number }[];
  active_job_id: number | null;
}

interface MessageRow {
  id: number; tg_message_id: number; date: string;
  sender_id: number | null; sender_name: string | null;
  text: string | null; media_type: string; has_media: boolean;
  grouped_id: number | null; views: number | null;
  reply_to_msg_id: number | null; is_service: boolean;
  files: { id:number; kind:string; file_name:string|null; size:number|null;
           status:string; rel_path:string|null }[];
}

interface Paginated<T> { items: T[]; total: number; page: number; page_size: number; pages: number; }
```

### 4.4 Экспорт

```
POST /api/export/jobs               CreateJobRequest -> ExportJob                    [201]
GET  /api/export/jobs?account_id=&chat_id=&status=&page=&page_size= -> Paginated<ExportJob>
GET  /api/export/jobs/{id}          -> ExportJob
POST /api/export/jobs/{id}/cancel   -> ExportJob
POST /api/export/jobs/{id}/pause    -> ExportJob
POST /api/export/jobs/{id}/resume   -> ExportJob
DELETE /api/export/jobs/{id}        -> { ok:true }
GET  /api/export/jobs/{id}/events?after_id=&limit= -> JobEvent[]
GET  /api/export/jobs/{id}/files
     ?status=all|pending|downloading|done|failed|skipped
     &kind=all|photo|video|video_note|voice|audio|document|sticker|animation|thumb|avatar
     &search=&page=&page_size=   -> Paginated<MediaFileRow>
POST /api/export/jobs/{id}/rebuild  { formats?, layout?, sort_field?, sort_order? }
     -> ExportJob & { written: string[] }
     // пересобрать выходные файлы ИЗ БД без повторного скачивания
GET  /api/export/jobs/{id}/manifest -> объект манифеста (см. §6)
```

```ts
interface CreateJobRequest { account_id: number; chat_id: number; options: ExportOptions; }

interface ExportJob {
  id: number; account_id: number; chat_id: number; chat_title: string;
  status: 'queued'|'running'|'paused'|'completed'|'failed'|'cancelled';
  phase: 'init'|'counting'|'fetching'|'downloading'|'rendering'|'done';
  options: ExportOptions; output_dir: string | null;
  total_messages: number; processed_messages: number;
  total_files: number; downloaded_files: number;
  failed_files: number; skipped_files: number;
  bytes_total: number; bytes_downloaded: number;
  speed_bps: number;        // текущая скорость (скользящее окно ~10 с)
  avg_speed_bps: number;    // средняя за весь прогон
  eta_seconds: number | null;
  active_files: ActiveFile[];   // что качается прямо сейчас (может быть пусто)
  error: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}

interface ActiveFile {
  media_id: number; file_name: string; kind: string;
  received: number; total: number | null; speed_bps: number;
}

interface MediaFileRow {
  id: number; message_id: number; tg_message_id: number;
  kind: string; file_name: string | null; ext: string | null;
  mime_type: string | null; size: number | null;
  width: number | null; height: number | null; duration: number | null;
  rel_path: string | null; status: string; error: string | null;
  attempts: number; downloaded_at: string | null;
}

interface JobEvent { id:number; job_id:number; ts:string; level:'debug'|'info'|'warning'|'error'; message:string; data:any|null; }
```

### 4.5 Логи и файлы

```
GET /api/logs?level=&account_id=&job_id=&search=&limit=200&after_id= -> LogRow[]
GET /api/logs/files                 -> { name, size, modified }[]
GET /api/logs/files/{name}?tail=500 -> { name, lines: string[] }
GET /api/files/download?media_id=   -> бинарный поток файла
GET /api/files/thumb?media_id=      -> превью (thumb-компаньон, либо сам файл
                                       для photo/sticker; иначе 404 THUMB_NOT_FOUND)
GET /api/files/photo?path=          -> аватарка чата (path из chat.photo_path)
POST /api/system/open-folder        { path } -> { ok:true }
     // открыть папку в проводнике; разрешены только каталоги внутри TGV_DATA_DIR,
     // иначе 403 PATH_FORBIDDEN
```

### 4.6 `ExportOptions` — ЦЕНТРАЛЬНЫЙ объект настроек

```ts
type MediaKind = 'photo'|'video'|'video_note'|'voice'|'audio'|'document'|'sticker'|'animation';

type LayoutStrategy =
  | 'flat'            // всё в одну папку media/
  | 'by_type'         // media/photos/, media/video_notes/, …
  | 'by_date'         // media/2026/2026-01/
  | 'by_date_type'    // media/2026/2026-01/photos/
  | 'by_type_date'    // media/photos/2026-01/
  | 'by_sender'       // media/Ivan_Petrov_123/
  | 'by_album'        // media/albums/<grouped_id>/ + media/single/
  | 'by_size';        // media/small_lt10mb/, medium_lt100mb/, large/

type SortField = 'date'|'type'|'sender'|'size'|'views'|'id';

interface ExportOptions {
  // ЧТО тянуть
  download_media: boolean;          // default true
  media_types: MediaKind[];         // default: все
  include_service_messages: boolean;// default true
  include_text_only: boolean;       // default true — сохранять текстовые сообщения
  date_from: string | null;         // ISO date, включительно
  date_to: string | null;
  min_id: number | null;            // экспортировать сообщения с id > min_id
  max_id: number | null;
  limit: number | null;             // максимум сообщений (null = все)
  max_file_size_mb: number | null;  // пропускать файлы больше
  search: string | null;            // фильтр по тексту на стороне Telegram

  // КАК тянуть
  order: 'asc'|'desc';              // порядок обхода, default 'asc' (старые→новые)
  concurrency: number;              // параллельных загрузок, 1..16, default 4
  use_takeout: boolean;             // takeout-сессия Telegram, default false
  skip_existing: boolean;           // не перекачивать уже скачанное, default true
  incremental: boolean;             // догрузить только новое с прошлого экспорта, default true
  download_thumbs: boolean;         // default false
  download_avatars: boolean;        // аватары отправителей, default false

  // Полнота архива: файлы не должны теряться из-за сетевых сбоев
  retry_forever: boolean;           // повторять, пока не скачается, default true
  max_attempts: number;             // предохранитель, 1..10000, default 200
  resume_partial: boolean;          // докачивать с места обрыва, default true
  final_sweep: boolean;             // финальный проход по недокачанному, default true

  // КАК раскладывать
  layout: LayoutStrategy;           // default 'by_type_date'
  sort_field: SortField;            // сортировка в отчётах, default 'date'
  sort_order: 'asc'|'desc';         // default 'asc'
  filename_template: string;        // default '{date}_{id}_{name}'
                                    // плейсхолдеры: {id} {date} {time} {datetime}
                                    // {name} {ext} {kind} {sender} {chat} {album}

  // ЧТО на выходе
  formats: ('json'|'jsonl'|'html'|'csv'|'txt')[];  // default ['json','html']
  output_dir: string | null;        // null = data/exports/<chat>_<id>_<ts>/
}
```

Значения по умолчанию backend подставляет сам; фронт может слать частичный объект.

---

## 5. WebSocket

`ws://127.0.0.1:8077/ws` — сервер шлёт JSON-сообщения:

```ts
type WsMessage =
  | { type:'hello';        ts:string; version:string }
  | { type:'auth_state';   ts:string; payload: AuthState }
  | { type:'job_progress'; ts:string; payload: ExportJob }
  | { type:'job_event';    ts:string; payload: JobEvent }
  | { type:'chat_sync';    ts:string; payload:{ account_id:number; synced:number; done:boolean } }
  | { type:'log';          ts:string; payload: LogRow }
  | { type:'account';      ts:string; payload: Account };
```

Клиент может слать `{"type":"ping"}` → сервер ответит `{"type":"pong"}`.
Подписка на всё сразу (фильтрация — на клиенте). Переподключение с backoff — на клиенте.

---

## 6. Структура результата экспорта

```
data/exports/{chat_slug}_{chat_id}_{YYYYMMDD-HHMMSS}/
├── manifest.json          # метаданные экспорта + статистика + опции
├── messages.json          # полный дамп (массив)
├── messages.jsonl         # построчно (для стриминга)
├── messages.csv
├── messages.txt
├── index.html             # красивый просмотрщик, работает офлайн
├── assets/
│   ├── style.css
│   └── app.js
└── media/                 # раскладка согласно layout
    ├── photos/2026-01/…
    ├── video_notes/2026-01/…
    └── …
```

`manifest.json`:
```json
{
  "tgvault_version": "1.0.0",
  "exported_at": "2026-08-16T10:00:00Z",
  "account": { "id": 1, "tg_user_id": 123, "username": "user" },
  "chat": { "id": 5, "tg_chat_id": -1001234, "title": "…", "kind": "channel", "username": "…" },
  "options": { },
  "stats": { "messages": 1200, "media_files": 800, "bytes": 123456789,
             "by_media_type": { "photo": 300, "video_note": 42 },
             "date_from": "…", "date_to": "…" },
  "files": [ { "id": 1, "message_id": 10, "kind": "video_note", "rel_path": "media/…", "size": 12345 } ]
}
```

---

## 7. Переменные окружения (`.env`)

```
# --- App ---
TGV_HOST=127.0.0.1
TGV_PORT=8077
TGV_LOG_LEVEL=INFO
TGV_DATA_DIR=./data
TGV_SECRET_KEY=            # пусто -> сгенерируется в data/secret.key

# --- MySQL ---
TGV_MYSQL_HOST=127.0.0.1
TGV_MYSQL_PORT=13306
TGV_MYSQL_USER=tgvault
TGV_MYSQL_PASSWORD=tgvault
TGV_MYSQL_DB=tgvault
TGV_DB_ECHO=false

# --- Redis ---
TGV_REDIS_URL=redis://127.0.0.1:16379/0
TGV_REDIS_ENABLED=true

# --- Telegram defaults (можно оставить пустым и вводить в UI) ---
TGV_DEFAULT_API_ID=
TGV_DEFAULT_API_HASH=

# --- Export ---
TGV_DOWNLOAD_CONCURRENCY=4
TGV_MAX_RETRIES=5
TGV_FLOOD_SLEEP_THRESHOLD=60

# --- Frontend ---
TGV_FRONTEND_PORT=5177
```

---

## 8. Правила для агентов

1. Frontend НЕ придумывает эндпоинты — только из §4/§5.
2. `frontend/src/api/types.ts` — дословное зеркало TS-интерфейсов из §4.
3. Backend отдаёт ровно эти имена полей (snake_case), фронт не переименовывает.
4. Ошибки backend → `{ detail, code }`, фронт показывает `detail`.
5. Никаких моков в проде: если API недоступен — показываем состояние ошибки.
