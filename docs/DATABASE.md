# База данных

Назад: [README](../README.md) · Смежное: [ARCHITECTURE](ARCHITECTURE.md) · [SETUP](SETUP.md)

Источник истины по схеме — `backend/app/db/models.py` и `backend/app/db/base.py`.
Ниже описано то, что реально создаёт `create_all` на MySQL 8.

Все таблицы: `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.

Соответствие переносимых типов из `db/base.py` реальным типам MySQL:

| Псевдоним | MySQL | SQLite | Назначение |
|---|---|---|---|
| `PK` | `BIGINT AUTO_INCREMENT` | `INTEGER` | первичный ключ |
| `BIG` | `BIGINT` | `INTEGER` | id Telegram, размеры, счётчики байт |
| `TS` | `DATETIME(3)` | `DATETIME` | метки времени с миллисекундами |
| `LONGTEXT` | `MEDIUMTEXT` | `TEXT` | тексты сообщений и HTML |

> **Примечание:** контракт объявляет id как `BIGINT UNSIGNED`; реализация использует
> знаковый `BIGINT`. На практике это не мешает: `tg_chat_id` каналов отрицателен по природе
> (`-100…`), а положительные id Telegram далеко не доходят до `2^63`.

Все `datetime` хранятся как **naive UTC** (`db.base.utcnow()`), сервер MySQL стартует с
`--default-time-zone=+00:00`. Наружу API отдаёт ISO-8601 со суффиксом `Z`.

---

## 1. `accounts` — подключённые Telegram-аккаунты

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `label` | `VARCHAR(128)` | нет | человекочитаемое имя; при первом успешном входе автозаполняется username/именем, если было пустым |
| `phone` | `VARCHAR(32)` | да | номер в формате `+…`, нормализуется при входе |
| `tg_user_id` | `BIGINT` | да | id пользователя в Telegram |
| `username` | `VARCHAR(64)` | да | @username |
| `first_name` | `VARCHAR(128)` | да | из `get_me()` |
| `last_name` | `VARCHAR(128)` | да | из `get_me()` |
| `is_premium` | `TINYINT(1)` | нет | признак Telegram Premium, по умолчанию `0` |
| `api_id` | `INT` | нет | из my.telegram.org |
| `api_hash` | `VARCHAR(64)` | нет | из my.telegram.org, хранится в открытом виде |
| `session_enc` | `TEXT` | да | `StringSession`, зашифрованная Fernet, с префиксом `fernet:` |
| `dc_id` | `INT` | да | номер дата-центра из сессии |
| `status` | `VARCHAR(24)` | нет | `new` \| `pending_code` \| `pending_password` \| `authorized` \| `unauthorized` \| `error`; по умолчанию `new` |
| `last_error` | `TEXT` | да | текст последней ошибки (обрезается до 1000 символов) |
| `proxy` | `VARCHAR(255)` | да | `socks5://user:pass@host:port`, также `socks4://`, `http(s)://` |
| `created_at` | `DATETIME(3)` | нет | |
| `updated_at` | `DATETIME(3)` | нет | обновляется автоматически |
| `last_seen_at` | `DATETIME(3)` | да | момент последней успешной работы с Telegram |

Индексы: `UNIQUE (tg_user_id)` — `uq_accounts_tg_user_id`; `INDEX (status)` — `ix_accounts_status`.

> `UNIQUE(tg_user_id)` при `NULL` не мешает: MySQL допускает произвольное число `NULL`
> в уникальном индексе, поэтому несколько ещё не авторизованных аккаунтов сосуществуют спокойно.
> Но **один и тот же Telegram-аккаунт нельзя добавить дважды** — вторая попытка упрётся
> в это ограничение при финализации входа.

---

## 2. `chats` — диалоги аккаунта

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK, внутренний |
| `account_id` | `BIGINT` | нет | FK → `accounts.id`, `ON DELETE CASCADE`, индексирован |
| `tg_chat_id` | `BIGINT` | нет | «сырой» peer id из Telethon (`dialog.id`); у каналов отрицателен |
| `access_hash` | `BIGINT` | да | из entity |
| `kind` | `VARCHAR(16)` | нет | `user` \| `bot` \| `group` \| `supergroup` \| `channel`; по умолчанию `channel` |
| `title` | `VARCHAR(512)` | нет | название или имя собеседника |
| `username` | `VARCHAR(64)` | да | публичный @username |
| `about` | `TEXT` | да | описание; заполняется только через `GET /api/chats/{id}?enrich=true` |
| `participants_count` | `INT` | да | число участников |
| `is_broadcast` | `TINYINT(1)` | нет | вычисляется как `kind == 'channel'` |
| `is_megagroup` | `TINYINT(1)` | нет | супергруппа |
| `is_verified` | `TINYINT(1)` | нет | |
| `is_scam` | `TINYINT(1)` | нет | |
| `is_creator` | `TINYINT(1)` | нет | аккаунт — создатель |
| `is_archived` | `TINYINT(1)` | нет | диалог в архивной папке |
| `is_pinned` | `TINYINT(1)` | нет | закреплён в списке |
| `photo_path` | `VARCHAR(768)` | да | путь аватарки относительно `data/`, вида `avatars/{account_id}_{tg_chat_id}.jpg` |
| `last_message_id` | `BIGINT` | да | id последнего сообщения на момент синка |
| `last_message_date` | `DATETIME(3)` | да | дата последнего сообщения |
| `unread_count` | `INT` | нет | непрочитанные, по умолчанию `0` |
| `messages_cached` | `INT` | нет | сколько сообщений этого чата уже в нашей БД |
| `media_cached` | `INT` | нет | сколько файлов скачано (`status='done'`) |
| `bytes_cached` | `BIGINT` | нет | суммарный размер скачанного |
| `last_synced_at` | `DATETIME(3)` | да | последний синк диалога |
| `raw` | `JSON` | да | `{folder_id, restricted, has_link, noforwards}` |
| `created_at` / `updated_at` | `DATETIME(3)` | нет | |

Индексы: `UNIQUE (account_id, tg_chat_id)` — `uq_chats_account_chat`;
`INDEX (account_id, kind)`; `INDEX (account_id, last_message_date)`;
`INDEX (title(191))` — `ix_chats_title`; отдельный индекс по `account_id`.

Счётчики `messages_cached` / `media_cached` / `bytes_cached` пересчитываются при завершении
задачи экспорта и при открытии карточки чата (`GET /api/chats/{id}`).

---

## 3. `messages` — архив сообщений

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `account_id` | `BIGINT` | нет | FK → `accounts.id` `CASCADE`, индексирован |
| `chat_id` | `BIGINT` | нет | FK → `chats.id` `CASCADE` (внутренний id, не `tg_chat_id`) |
| `tg_message_id` | `BIGINT` | нет | id сообщения в Telegram |
| `date` | `DATETIME(3)` | нет | дата отправки |
| `edit_date` | `DATETIME(3)` | да | дата последней правки |
| `sender_id` | `BIGINT` | да | id отправителя |
| `sender_name` | `VARCHAR(255)` | да | имя/название отправителя, до 255 символов |
| `sender_username` | `VARCHAR(64)` | да | @username отправителя |
| `post_author` | `VARCHAR(128)` | да | подпись автора поста в канале |
| `text` | `MEDIUMTEXT` | да | исходный текст |
| `text_html` | `MEDIUMTEXT` | да | текст с применёнными entities (`telethon.extensions.html.unparse`) |
| `entities` | `JSON` | да | массив entity с полем `_` = имя TL-типа |
| `media_type` | `VARCHAR(16)` | нет | `none`, `photo`, `video`, `video_note`, `voice`, `audio`, `document`, `sticker`, `animation`, `contact`, `poll`, `geo`, `venue`, `webpage`, `game`, `invoice`, `dice`, `unsupported` |
| `has_media` | `TINYINT(1)` | нет | `media_type != 'none'` |
| `grouped_id` | `BIGINT` | да | id альбома |
| `reply_to_msg_id` | `BIGINT` | да | на что отвечает |
| `fwd_from_name` | `VARCHAR(255)` | да | имя источника пересылки |
| `fwd_from_id` | `BIGINT` | да | id источника (`user_id`/`channel_id`/`chat_id`) |
| `fwd_from_date` | `DATETIME(3)` | да | дата оригинала |
| `fwd_from_post_id` | `BIGINT` | да | id поста в канале-источнике |
| `views` | `INT` | да | просмотры |
| `forwards` | `INT` | да | пересылки |
| `replies_count` | `INT` | да | число ответов в треде |
| `reactions` | `JSON` | да | `[{emoji, custom_emoji_id, count}]` |
| `is_service` | `TINYINT(1)` | нет | служебное сообщение |
| `service_action` | `VARCHAR(64)` | да | имя действия без префикса `MessageAction` |
| `is_pinned` | `TINYINT(1)` | нет | |
| `is_outgoing` | `TINYINT(1)` | нет | отправлено нашим аккаунтом |
| `raw` | `JSON` | да | компактный срез сырого объекта, а не полный `to_dict()` |
| `created_at` | `DATETIME(3)` | нет | когда строка попала в архив |

Индексы: `UNIQUE (chat_id, tg_message_id)` — `uq_messages_chat_msg`;
`INDEX (chat_id, date)`; `INDEX (chat_id, media_type)`; `INDEX (chat_id, grouped_id)`;
`INDEX (sender_id)`; отдельный индекс по `account_id`;
Полнотекстового индекса на `text` **нет** — см. §12 о том, почему он был удалён.

`UNIQUE (chat_id, tg_message_id)` — ключ идемпотентности: повторный экспорт обновляет строку,
а не плодит дубли.

---

## 4. `media_files` — скачанные вложения

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `account_id` | `BIGINT` | нет | FK → `accounts.id` `CASCADE` |
| `chat_id` | `BIGINT` | нет | FK → `chats.id` `CASCADE` |
| `message_id` | `BIGINT` | нет | FK → `messages.id` `CASCADE` (внутренний id) |
| `tg_message_id` | `BIGINT` | нет | id сообщения в Telegram — дубль для удобных выборок |
| `kind` | `VARCHAR(24)` | нет | `photo`, `video`, `video_note`, `voice`, `audio`, `document`, `sticker`, `animation` (в схеме также предусмотрены `thumb` и `avatar`) |
| `tg_file_id` | `BIGINT` | да | `document.id` или `photo.id` — не протухает никогда |
| `access_hash` | `BIGINT` | да | |
| `file_unique` | `VARCHAR(96)` | да | ключ дедупликации `"{kind}:{tg_file_id}"` |
| `file_name` | `VARCHAR(512)` | да | оригинальное имя (санитизированное) |
| `ext` | `VARCHAR(16)` | да | расширение с точкой, в нижнем регистре |
| `mime_type` | `VARCHAR(128)` | да | |
| `size` | `BIGINT` | да | байты; после загрузки заменяется фактическим размером на диске |
| `width` / `height` | `INT` | да | для изображений и видео |
| `duration` | `INT` | да | секунды, для аудио/видео/кружочков |
| `rel_path` | `VARCHAR(768)` | да | путь относительно каталога экспорта, POSIX-разделители |
| `abs_path` | `VARCHAR(1024)` | да | абсолютный путь на диске |
| `sha256` | `VARCHAR(64)` | да | **никогда не заполняется** — хэши не считаются |
| `status` | `VARCHAR(16)` | нет | `pending` \| `downloading` \| `done` \| `failed` \| `skipped`; по умолчанию `pending` |
| `error` | `TEXT` | да | текст последней ошибки загрузки |
| `attempts` | `INT` | нет | число попыток, по умолчанию `0` |
| `downloaded_at` | `DATETIME(3)` | да | момент успешной загрузки |
| `created_at` | `DATETIME(3)` | нет | |

Индексы: `INDEX (message_id)`; `INDEX (chat_id, kind)`; `INDEX (status)`;
`INDEX (chat_id, file_unique)`.

> На одно сообщение движок создаёт **одну** запись на `kind` (поиск существующей идёт по паре
> `message_id + kind`). Файлы альбома — это отдельные сообщения с общим `grouped_id`,
> поэтому у каждого своя строка.

---

## 5. `export_jobs` — задачи экспорта

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `account_id` | `BIGINT` | нет | FK → `accounts.id` `CASCADE` |
| `chat_id` | `BIGINT` | нет | FK → `chats.id` `CASCADE` |
| `status` | `VARCHAR(16)` | нет | `queued` \| `running` \| `paused` \| `completed` \| `failed` \| `cancelled`; по умолчанию `queued` |
| `phase` | `VARCHAR(16)` | нет | `init` \| `counting` \| `fetching` \| `downloading` \| `rendering` \| `done` |
| `options` | `JSON` | нет | полный объект `ExportOptions` в виде, пригодном для JSON |
| `output_dir` | `VARCHAR(1024)` | да | абсолютный путь каталога результата |
| `total_messages` | `INT` | нет | оценка общего числа сообщений (приблизительная) |
| `processed_messages` | `INT` | нет | обработано сообщений |
| `total_files` | `INT` | нет | файлов поставлено в план |
| `downloaded_files` | `INT` | нет | успешно скачано |
| `failed_files` | `INT` | нет | не скачалось после всех попыток |
| `skipped_files` | `INT` | нет | пропущено (уже есть на диске либо больше `max_file_size_mb`) |
| `bytes_total` | `BIGINT` | нет | сумма ожидаемых размеров |
| `bytes_downloaded` | `BIGINT` | нет | фактически скачано байт |
| `min_id` / `max_id` | `BIGINT` | да | границы из опций на момент создания |
| `last_processed_id` | `BIGINT` | да | последний обработанный `tg_message_id` |
| `speed_bps` | `BIGINT` | нет | средняя скорость с начала задачи, байт/с |
| `eta_seconds` | `INT` | да | оценка остатка; `NULL`, если посчитать нельзя |
| `error` | `TEXT` | да | причина падения |
| `created_at` | `DATETIME(3)` | нет | |
| `started_at` | `DATETIME(3)` | да | момент фактического старта |
| `finished_at` | `DATETIME(3)` | да | момент завершения любым исходом |

Индексы: `INDEX (account_id, status)`; `INDEX (chat_id)`; `INDEX (status)`.

---

## 6. `job_events` — таймлайн задачи

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `job_id` | `BIGINT` | нет | FK → `export_jobs.id` `CASCADE` |
| `ts` | `DATETIME(3)` | нет | момент события |
| `level` | `VARCHAR(8)` | нет | `debug` \| `info` \| `warning` \| `error`; по умолчанию `info` |
| `message` | `TEXT` | нет | текст для человека, на русском |
| `data` | `JSON` | да | структурированная нагрузка (`{"seconds": 300}`, `{"files": [...]}`) |

Индекс: `INDEX (job_id, id)` — используется для инкрементальной подгрузки через `after_id`.

---

## 7. `app_logs` — журнал приложения для UI

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT` | нет | PK |
| `ts` | `DATETIME(3)` | нет | момент записи |
| `level` | `VARCHAR(8)` | нет | `INFO` \| `WARNING` \| `ERROR` \| `CRITICAL`; по умолчанию `INFO` |
| `logger` | `VARCHAR(64)` | нет | имя логгера, например `tgvault.export` |
| `message` | `TEXT` | нет | текст, до 8000 символов |
| `account_id` | `BIGINT` | да | не FK — запись лога переживает удаление аккаунта |
| `job_id` | `BIGINT` | да | не FK |
| `data` | `JSON` | да | дополнительные поля из `extra` |

Индексы: `INDEX (ts)`; `INDEX (level)`; `INDEX (account_id)`; `INDEX (job_id)`.

Пишется только уровень `INFO` и выше, и только не-денайлистовыми логгерами
(исключены `sqlalchemy`, `aiomysql`, `asyncio`, `telethon.network`, `uvicorn.access`).
Таблица растёт неограниченно — автоочистки нет. Ротация есть только у файловых логов.

## 8. `settings` — key/value

| Колонка | Тип | NULL | Значение |
|---|---|---|---|
| `skey` | `VARCHAR(64)` | нет | PK |
| `svalue` | `JSON` | да | произвольное значение |
| `updated_at` | `DATETIME(3)` | нет | обновляется автоматически |

Таблица создаётся, но кодом пока не используется — зарезервирована под настройки UI и служебные
пометки схемы.

---

## 9. ER-диаграмма

```mermaid
erDiagram
    ACCOUNTS ||--o{ CHATS : "account_id (CASCADE)"
    ACCOUNTS ||--o{ MESSAGES : "account_id (CASCADE)"
    ACCOUNTS ||--o{ MEDIA_FILES : "account_id (CASCADE)"
    ACCOUNTS ||--o{ EXPORT_JOBS : "account_id (CASCADE)"
    CHATS    ||--o{ MESSAGES : "chat_id (CASCADE)"
    CHATS    ||--o{ MEDIA_FILES : "chat_id (CASCADE)"
    CHATS    ||--o{ EXPORT_JOBS : "chat_id (CASCADE)"
    MESSAGES ||--o{ MEDIA_FILES : "message_id (CASCADE)"
    EXPORT_JOBS ||--o{ JOB_EVENTS : "job_id (CASCADE)"

    ACCOUNTS {
        bigint id PK
        varchar label
        varchar phone
        bigint tg_user_id UK
        int api_id
        varchar api_hash
        text session_enc "Fernet"
        varchar status
    }
    CHATS {
        bigint id PK
        bigint account_id FK
        bigint tg_chat_id "UK с account_id"
        varchar kind
        varchar title
        int messages_cached
        bigint bytes_cached
    }
    MESSAGES {
        bigint id PK
        bigint account_id FK
        bigint chat_id FK
        bigint tg_message_id "UK с chat_id"
        datetime date
        mediumtext text "FULLTEXT"
        varchar media_type
        bigint grouped_id
    }
    MEDIA_FILES {
        bigint id PK
        bigint account_id FK
        bigint chat_id FK
        bigint message_id FK
        varchar kind
        varchar file_unique
        varchar rel_path
        varchar status
        bigint size
    }
    EXPORT_JOBS {
        bigint id PK
        bigint account_id FK
        bigint chat_id FK
        varchar status
        varchar phase
        json options
        varchar output_dir
    }
    JOB_EVENTS {
        bigint id PK
        bigint job_id FK
        datetime ts
        varchar level
        text message
    }
    APP_LOGS {
        bigint id PK
        datetime ts
        varchar level
        varchar logger
        bigint account_id "не FK"
        bigint job_id "не FK"
    }
    SETTINGS {
        varchar skey PK
        json svalue
    }
```

---

## 10. Изоляция аккаунтов и каскады

**Каждая строка, пришедшая из Telegram, несёт `account_id`** — не только `chats`, но и
`messages`, `media_files`, `export_jobs`. Это сделано намеренно:

* два аккаунта могут архивировать **один и тот же публичный канал** независимо. Уникальность
  чата — по паре `(account_id, tg_chat_id)`, а не по `tg_chat_id`;
* статистика по аккаунту (`GET /api/accounts/{id}/stats`) считается одним `WHERE account_id = ?`
  без джойнов через `chats`;
* удаление аккаунта сносит весь его архив одной операцией.

Каскады объявлены на двух уровнях сразу — в БД (`ON DELETE CASCADE` во всех FK) и в ORM
(`cascade="all, delete-orphan"` + `passive_deletes=True` для `Account.chats` и `Message.files`).
`passive_deletes=True` означает, что работу делает MySQL, а SQLAlchemy не загружает миллионы
строк в память ради удаления.

Что происходит при `DELETE /api/accounts/{id}`:

```
accounts (1 строка)
 └─ chats            → удаляются
     └─ messages     → удаляются (и по chat_id, и по account_id)
         └─ media_files → удаляются
     └─ export_jobs  → удаляются
         └─ job_events → удаляются
```

**Файлы на диске при этом не удаляются.** Содержимое `data/exports/` и `data/avatars/` остаётся —
уборка ручная. Это осознанный выбор: экспорт может быть единственной копией данных.

`app_logs` намеренно **не** связана внешними ключами: журнал должен пережить удаление аккаунта
или задачи, иначе теряется история диагностики.

---

## 11. `VARCHAR` вместо `ENUM`

Контракт объявляет `accounts.status`, `chats.kind`, `messages.media_type`, `media_files.status`,
`export_jobs.status` как `ENUM(...)`. Реализация использует `VARCHAR` плюс кортежи допустимых
значений в `backend/app/db/base.py`:

```python
ACCOUNT_STATUSES  = ("new", "pending_code", "pending_password", "authorized", "unauthorized", "error")
CHAT_KINDS        = ("user", "bot", "group", "supergroup", "channel")
MEDIA_TYPES       = ("none", "photo", "video", "video_note", "voice", "audio", "document",
                     "sticker", "animation", "contact", "poll", "geo", "venue", "webpage",
                     "game", "invoice", "dice", "unsupported")
DOWNLOADABLE_KINDS= ("photo", "video", "video_note", "voice", "audio", "document", "sticker", "animation")
JOB_STATUSES      = ("queued", "running", "paused", "completed", "failed", "cancelled")
JOB_PHASES        = ("init", "counting", "fetching", "downloading", "rendering", "done")
FILE_STATUSES     = ("pending", "downloading", "done", "failed", "skipped")
```

Почему так:

1. **Проект без миграций.** Добавление значения в `ENUM` требует `ALTER TABLE` на живой таблице;
   в `VARCHAR` это изменение одной строки Python. Telegram регулярно добавляет новые типы медиа —
   схема не должна из-за этого блокировать релиз.
2. **Валидация всё равно на слое приложения.** Допустимые значения проверяются pydantic-типами
   (`Literal[...]` в `services/options.py`) до попадания в БД, поэтому `ENUM` не даёт
   дополнительной защиты, но добавляет негибкости.
3. **Переносимость.** `ENUM` — диалектная особенность MySQL; `VARCHAR` создаётся и на SQLite,
   что позволяет прогонять smoke-тесты через `TGV_DATABASE_URL=sqlite+aiosqlite:///…`.

Цена решения: SQL-запрос может записать невалидное значение, если обойти приложение.
При выборках это ловится только глазами.

---

## 12. Мягкие миграции (и почему нет FULLTEXT)

Полная последовательность бутстрапа (`init_db()` в lifespan):

1. `wait_for_database()` — ждёт TCP-доступности MySQL до 90 с, ретраи каждые 2 с;
2. `ensure_database_exists()` — `CREATE DATABASE IF NOT EXISTS ... utf8mb4 utf8mb4_unicode_ci`;
3. `create_tables()` — `Base.metadata.create_all`;
4. `_apply_soft_migrations()` — всё, что `create_all` не покрывает;
5. `_stamp_schema_version()` — пишет версию приложения в `settings.schema_version`.

### Почему полнотекстового индекса нет

Ранняя версия создавала `FULLTEXT ft_messages_text` на `messages.text`. Индекс **удалён**, и
`_apply_soft_migrations()` теперь сносит его, если находит:

```sql
SELECT COUNT(*) FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'messages' AND index_name = 'ft_messages_text';
-- если 1:
DROP INDEX ft_messages_text ON messages;
```

Причина: поиск по сообщениям в `services/chats.py` — подстрочный (`LIKE '%…%'`), а `FULLTEXT`
работает по словам. Запрос «порт» через `MATCH ... AGAINST` **не нашёл бы** «экспорт», то есть
переход на полнотекстовый поиск был бы регрессом поведения. Неиспользуемый индекс на
`MEDIUMTEXT` при этом заметно замедлял вставку на больших экспортах.

Проверка перед удалением делает операцию идемпотентной; неудача логируется как warning и
**не** мешает приложению стартовать.

**Принцип соглашения:** любое изменение схемы, которое `create_all` умеет выразить (новая таблица,
новая колонка на новой таблице), появляется само. Всё остальное — новая колонка на существующей
таблице, новый индекс, изменение типа — добавляется как guard-защищённый оператор в
`_apply_soft_migrations()`. Каждый такой оператор должен быть безопасен при повторном запуске.

Есть также `reset_db()` — `DROP ALL` + `CREATE ALL` с временным `SET FOREIGN_KEY_CHECKS=0`;
используется тестами. Из UI и API он не доступен: полный сброс делается на уровне docker-томов
(`./stop.sh --purge`, `./start.sh --fresh`).

> **Примечание:** поиск по сообщениям (`GET /api/chats/{id}/messages?search=`) выполняется
> через `LIKE '%…%'` без индекса. На архиве в сотни тысяч сообщений это полное сканирование
> по `chat_id`; ограничение по чату и пагинация удерживают время ответа в приемлемых рамках.

---

## 13. Полезные SQL-запросы

Подключиться к контейнеру:

```bash
docker exec -it tgvault-mysql mysql -u tgvault -ptgvault --default-character-set=utf8mb4 tgvault
```

### Топ чатов по объёму архива

```sql
SELECT  c.id,
        c.title,
        c.kind,
        c.messages_cached                       AS messages,
        c.media_cached                          AS files,
        ROUND(c.bytes_cached / 1024 / 1024, 1)  AS mb
FROM    chats c
WHERE   c.account_id = 1
ORDER BY c.bytes_cached DESC
LIMIT   20;
```

### Медиа по типам в разрезе чата

```sql
SELECT  m.media_type,
        COUNT(*)                                        AS messages,
        COUNT(f.id)                                     AS files,
        ROUND(COALESCE(SUM(f.size), 0) / 1024 / 1024, 1) AS mb
FROM    messages m
LEFT JOIN media_files f
       ON f.message_id = m.id AND f.status = 'done'
WHERE   m.chat_id = 5
GROUP BY m.media_type
ORDER BY files DESC;
```

### Сколько «кружочков» по месяцам

```sql
SELECT  DATE_FORMAT(m.date, '%Y-%m') AS month,
        COUNT(*)                     AS video_notes
FROM    messages m
WHERE   m.chat_id = 5 AND m.media_type = 'video_note'
GROUP BY month
ORDER BY month;
```

### Неудавшиеся загрузки с причинами

```sql
SELECT  f.id,
        f.tg_message_id,
        f.kind,
        f.file_name,
        f.attempts,
        LEFT(f.error, 120) AS error,
        c.title            AS chat
FROM    media_files f
JOIN    chats c ON c.id = f.chat_id
WHERE   f.status = 'failed'
ORDER BY f.id DESC
LIMIT   50;
```

### Сводка ошибок по тексту

```sql
SELECT  LEFT(error, 60) AS reason, COUNT(*) AS n
FROM    media_files
WHERE   status = 'failed'
GROUP BY reason
ORDER BY n DESC;
```

### История задач с длительностью и скоростью

```sql
SELECT  j.id,
        c.title                                         AS chat,
        j.status,
        j.phase,
        j.processed_messages,
        j.downloaded_files,
        j.failed_files,
        ROUND(j.bytes_downloaded / 1024 / 1024, 1)      AS mb,
        ROUND(j.speed_bps / 1024, 0)                    AS kb_s,
        TIMESTAMPDIFF(SECOND, j.started_at, j.finished_at) AS seconds,
        j.error
FROM    export_jobs j
JOIN    chats c ON c.id = j.chat_id
ORDER BY j.id DESC
LIMIT   30;
```

### Активные и зависшие задачи

```sql
SELECT id, chat_id, status, phase, processed_messages, total_messages, started_at
FROM   export_jobs
WHERE  status IN ('queued', 'running', 'paused')
ORDER BY id;
```

### Таймлайн конкретной задачи

```sql
SELECT ts, level, message
FROM   job_events
WHERE  job_id = 12
ORDER BY id;
```

### Самые активные отправители чата

```sql
SELECT  sender_id,
        MAX(sender_name) AS name,
        COUNT(*)         AS messages
FROM    messages
WHERE   chat_id = 5 AND sender_id IS NOT NULL
GROUP BY sender_id
ORDER BY messages DESC
LIMIT   10;
```

### Дубликаты одного и того же файла (одинаковый `file_unique`)

```sql
SELECT  file_unique, COUNT(*) AS copies, SUM(size) AS total_bytes
FROM    media_files
WHERE   status = 'done' AND file_unique IS NOT NULL
GROUP BY file_unique
HAVING  copies > 1
ORDER BY total_bytes DESC
LIMIT   20;
```

### Размер таблиц

```sql
SELECT  table_name,
        table_rows,
        ROUND((data_length + index_length) / 1024 / 1024, 1) AS mb
FROM    information_schema.tables
WHERE   table_schema = 'tgvault'
ORDER BY (data_length + index_length) DESC;
```

### Очистка старых логов приложения

```sql
DELETE FROM app_logs WHERE ts < NOW() - INTERVAL 30 DAY;
```
