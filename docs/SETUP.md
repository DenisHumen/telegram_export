# Установка и запуск

Назад: [README](../README.md) · Смежное: [USAGE](USAGE.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md)

---

## 1. Требования

| Компонент | Минимальная версия | Зачем | Проверить |
|---|---|---|---|
| Python | 3.10 (в проекте целевая — 3.12) | backend | `python --version` |
| Node.js | 18 | сборка фронтенда | `node -v` |
| npm | любой из комплекта Node | установка зависимостей фронтенда | `npm -v` |
| Docker + Compose v2 | Docker Desktop 4.x / Docker Engine 24+ | MySQL 8 и Redis 7 | `docker info` и `docker compose version` |
| Bash | Git Bash (Windows), любой sh-совместимый (Linux/macOS/WSL) | `start.sh` / `stop.sh` / `status.sh` | `bash --version` |

```bash
python --version && node -v && npm -v && docker compose version
```

`start.sh` сам проверяет каждый пункт и падает с осмысленным сообщением, если что-то не найдено.
Python ищется как `python`, затем `python3`, затем `py -3`.

> **Примечание:** Node.js обязателен только если нужен UI. С флагом `--no-frontend` работает
> API-only режим: REST + WebSocket + Swagger на `/docs`.

Верхней границы по версии Python нет. Зависимости заданы диапазонами, а не точными
пинами, и из списка убрано всё, что не импортируется кодом, — из-за этого остаётся
единственный пакет с компилируемым расширением (`cryptography`). Так проект ставится
и на 3.12, и на 3.14, где для точных старых версий колёс может не быть.

### Linux: установка и права на Docker

```bash
sudo dnf install -y python3 nodejs npm docker docker-compose-plugin   # Fedora
sudo apt install -y python3 python3-venv nodejs npm docker.io docker-compose-plugin   # Debian/Ubuntu
```

Запустить демон и — обязательно — добавить себя в группу `docker`, иначе `start.sh`
не сможет открыть `/var/run/docker.sock`, даже когда демон работает:

```bash
sudo systemctl enable --now docker && sudo usermod -aG docker $USER && newgrp docker
```

`newgrp` применяет группу к текущему терминалу; в новых она подхватится сама.
Если менять группы не хочется — `./start.sh --sudo-docker`
(подробнее в [TROUBLESHOOTING](TROUBLESHOOTING.md#демон-запущен-но-нет-прав-на-сокет-docker)).

---

## 2. Получение `api_id` / `api_hash`

1. <https://my.telegram.org> → войти по номеру телефона, код придёт в приложение Telegram.
2. Пункт **API development tools**.
3. Форма: `App title` (например `TgVault`), `Short name` (например `tgvault`), `Platform` — `Desktop`,
   `URL`/`Description` можно оставить пустыми.
4. Кнопка **Create application**.
5. Со следующей страницы забрать **App api_id** (число) и **App api_hash** (32 hex-символа).

Пару можно ввести в UI при добавлении аккаунта или прописать в `.env` как значения по умолчанию:

```bash
TGV_DEFAULT_API_ID=1234567
TGV_DEFAULT_API_HASH=0123456789abcdef0123456789abcdef
```

Одна пара штатно обслуживает несколько аккаунтов — это по дизайну Telegram. Не используйте
`api_id` из чужих репозиториев: публично засвеченные пары постоянно тротлятся сервером.

> **Примечание:** страница `my.telegram.org` часто отвечает «ERROR» из-за репутации IP.
> Регистрируйте приложение без VPN/прокси, с адреса той же страны, что и номер телефона.

---

## 3. Что делает `./start.sh`

Скрипт выполняет шаги строго по порядку и останавливается на первом сбое.

| Шаг | Действие |
|---|---|
| 1. Проверка окружения | ищет Python ≥ 3.10, при необходимости Node ≥ 18 и npm, проверяет `docker info` и наличие `docker compose` / `docker-compose`; убеждается, что есть `docker/docker-compose.yml` и `backend/requirements.txt` |
| 2. Конфигурация | если `.env` нет — копирует `.env.example` и вписывает свежесгенерированный `TGV_SECRET_KEY`. **Существующий `.env` никогда не перезаписывается.** Затем загружает переменные из файла (устойчиво к CRLF и кавычкам) |
| 3. Каталоги данных | создаёт `data/`, `data/logs/`, `data/exports/`, `data/run/` |
| 4. Docker | `docker compose --env-file .env -f docker/docker-compose.yml up -d`, затем ждёт healthcheck: MySQL до 120 с, Redis до 30 с. При провале печатает `docker compose logs --tail=40` соответствующего сервиса |
| 5. Python venv | создаёт `backend/.venv`, ставит зависимости из `requirements.txt`. Установка пропускается, если sha256 `requirements.txt` совпадает с сохранённым в `backend/.venv/.deps-hash` |
| 6. Frontend | `npm install` (при изменении `package-lock.json`), затем `npm run build`, если хэш дерева `frontend/` изменился. Сборка кладётся в `frontend/dist` и отдаётся backend'ом. Провал npm не фатален — старт продолжается в API-only режиме |
| 7. Backend | если в `data/run/backend.pid` живой процесс и `/api/health` отвечает — переиспользует его. Иначе проверяет, что порт свободен, и запускает `uvicorn app.main:app --host $TGV_HOST --port $TGV_PORT` через `nohup`, пишет pid и ждёт `/api/health` до 60 с |
| 8. Vite dev-сервер | только с `--dev`: `npm run dev -- --port $TGV_FRONTEND_PORT --strictPort` |
| 9. Баннер и браузер | печатает URL UI, `/docs`, `/api/health`, каталоги данных и логов; открывает браузер (если не `--no-browser`) |
| 10. Логи | только с `--logs`: `tail -f` по `backend.out.log`, `app.log` и логу dev-сервера |

Логи самих процессов: `data/logs/backend.out.log` и `data/logs/frontend.out.log`;
логи приложения — `data/logs/app.log`, `error.log`, `telegram.log`.

### Флаги `start.sh`

| Флаг | Действие |
|---|---|
| `--no-docker` | не трогать docker; MySQL/Redis считаются уже поднятыми и описанными в `.env` |
| `--sudo-docker` | вызывать docker через `sudo` — когда пользователь не в группе `docker` и нет прав на `/var/run/docker.sock`. Тот же флаг понимает `./stop.sh` |
| `--no-frontend` | только API: npm не запускается, фронтенд не собирается |
| `--dev` | вместо собранного `frontend/dist` поднять Vite dev-сервер на `TGV_FRONTEND_PORT` (5177) |
| `--rebuild` | принудительно переустановить python-зависимости и пересобрать фронтенд; backend перезапускается |
| `--fresh` | `docker compose down -v --remove-orphans` — **удаляет тома `tgvault_mysql_data` и `tgvault_redis_data`** и создаёт их заново. Требует ввода слова `yes` в интерактивном терминале |
| `--port N` | запустить backend на порту `N` вместо `TGV_PORT` из `.env`. Форма `--port=N` тоже принимается |
| `--no-browser` | не открывать браузер после старта |
| `--logs` | после старта остаться в `tail -f`; `Ctrl+C` выходит из логов, сервисы продолжают работать |
| `-h`, `--help` | справка |

```bash
./start.sh --dev --logs
```

```bash
./start.sh --no-docker --port 8099
```

```bash
./start.sh --no-frontend
```

Те же операции доступны через `Makefile` (запускать из Git Bash):

```bash
make dev
```

`make help` печатает список целей: `start`, `dev`, `api`, `stop`, `restart`, `status`, `logs`,
`rebuild`, `fresh`, `purge`, `compose-config`.

---

## 4. Справочник `.env`

Все переменные читаются `pydantic-settings` с префиксом `TGV_` из `<корень проекта>/.env`.
Неизвестные переменные игнорируются.

### Приложение

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_HOST` | `127.0.0.1` | адрес, на котором слушает uvicorn |
| `TGV_PORT` | `8077` | порт backend'а |
| `TGV_LOG_LEVEL` | `INFO` | уровень консольного вывода (`DEBUG`/`INFO`/`WARNING`/`ERROR`); в `app.log` всегда пишется от `DEBUG` |
| `TGV_DATA_DIR` | `./data` | корень данных: `logs/`, `exports/`, `avatars/`, `run/`, `secret.key`. Относительный путь резолвится от корня проекта |
| `TGV_SECRET_KEY` | пусто | мастер-секрет для Fernet. Пусто → генерируется и сохраняется в `data/secret.key` |

### MySQL

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_MYSQL_HOST` | `127.0.0.1` | хост MySQL |
| `TGV_MYSQL_PORT` | `13306` | порт (нестандартный, чтобы не конфликтовать с локальным сервером) |
| `TGV_MYSQL_USER` | `tgvault` | пользователь |
| `TGV_MYSQL_PASSWORD` | `tgvault` | пароль |
| `TGV_MYSQL_DB` | `tgvault` | имя базы; создаётся автоматически при старте |
| `TGV_DB_ECHO` | `false` | `true` — писать все SQL-запросы SQLAlchemy в лог |

### Redis

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_REDIS_URL` | `redis://127.0.0.1:16379/0` | DSN шины событий |
| `TGV_REDIS_ENABLED` | `true` | `false` — не подключаться к Redis вовсе; шина работает in-process |

### Telegram

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_DEFAULT_API_ID` | пусто | `api_id` по умолчанию для новых аккаунтов |
| `TGV_DEFAULT_API_HASH` | пусто | `api_hash` по умолчанию |

### Экспорт

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_MAX_RETRIES` | `5` | число попыток на один шаг `iter_messages` и на одну загрузку файла |
| `TGV_FLOOD_SLEEP_THRESHOLD` | `60` | порог (сек), ниже которого Telethon сам засыпает на FloodWait. Выше порога ожиданием управляет движок экспорта |
| `TGV_DOWNLOAD_CONCURRENCY` | `4` | присутствует в `.env.example` и читается в конфиг, но **движком не используется**: параллельность берётся из `ExportOptions.concurrency` (см. [ARCHITECTURE](ARCHITECTURE.md#5-отклонения-от-контракта)) |

### Frontend

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_FRONTEND_PORT` | `5177` | порт Vite dev-сервера (`./start.sh --dev`) |

### Переменные, которых нет в `.env.example`, но которые читает `config.py`

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_DATABASE_URL` | пусто | полный override DSN; при заполнении игнорирует все `TGV_MYSQL_*`. Например `sqlite+aiosqlite:///./data/tgvault.db` |
| `TGV_DB_POOL_SIZE` | `10` | размер пула SQLAlchemy (только MySQL) |
| `TGV_DB_MAX_OVERFLOW` | `20` | overflow пула (только MySQL) |
| `TGV_SERVE_FRONTEND` | `true` | `false` — не монтировать `frontend/dist`, работать API-only |
| `TGV_OPEN_BROWSER` | `false` | читается в конфиг, но в коде не используется (браузер открывает `start.sh`) |
| `TGV_REQUEST_RETRIES` | `5` | `request_retries` для `TelegramClient` |
| `TGV_CONNECTION_RETRIES` | `5` | `connection_retries` для `TelegramClient` |

### Переменные, которые использует только `docker/docker-compose.yml`

| Переменная | По умолчанию | Значение |
|---|---|---|
| `TGV_MYSQL_ROOT_PASSWORD` | `tgvault_root` | пароль root в контейнере MySQL |
| `TGV_REDIS_PORT` | `16379` | порт, на который пробрасывается Redis |
| `TZ` | `UTC` | таймзона контейнера MySQL |

> **Примечание:** сервер MySQL стартует с `--default-time-zone=+00:00`, а приложение хранит все
> времена как naive UTC. Менять `TZ` без необходимости не стоит.

---

## 5. Внешние MySQL и Redis

Если БД и кэш уже подняты (свой сервер, managed-инстанс, другой compose), docker из уравнения
выбрасывается:

```bash
./start.sh --no-docker
```

Перед этим пропишите доступы в `.env`:

```bash
TGV_MYSQL_HOST=db.internal
TGV_MYSQL_PORT=3306
TGV_MYSQL_USER=tgvault
TGV_MYSQL_PASSWORD=<пароль>
TGV_MYSQL_DB=tgvault
TGV_REDIS_URL=redis://cache.internal:6379/0
```

Требования к MySQL: версия 8.0+, кодировка `utf8mb4` / `utf8mb4_unicode_ci`, движок InnoDB.
Пользователю нужны права `CREATE DATABASE` (база создаётся при старте, если её нет), `CREATE`,
`ALTER`, `INDEX`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`. `ALTER`/`INDEX` нужны для мягких
миграций при обновлении схемы (см. [DATABASE](DATABASE.md#12-мягкие-миграции-и-почему-нет-fulltext)).

Redis можно выключить совсем:

```bash
TGV_REDIS_ENABLED=false
```

Приложение продолжит работать: шина событий деградирует до in-process fan-out, WebSocket и
прогресс задач сохраняются. Теряется только возможность подключить к шине второй процесс.

---

## 6. Ручной запуск (dev, без `start.sh`)

Инфраструктура:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Виртуальное окружение — Git Bash / WSL / Linux / macOS:

```bash
python -m venv backend/.venv && source backend/.venv/bin/activate
```

Виртуальное окружение — Windows PowerShell:

```powershell
python -m venv backend\.venv; if ($?) { backend\.venv\Scripts\Activate.ps1 }
```

> **Примечание:** в Git Bash на Windows venv кладёт интерпретатор в
> `backend/.venv/Scripts/python.exe`, поэтому активация выглядит как
> `source backend/.venv/Scripts/activate`.

Зависимости:

```bash
pip install -r backend/requirements.txt
```

Backend (запускать из каталога `backend/`, иначе не найдётся пакет `app`):

```bash
cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8077 --reload
```

Frontend в dev-режиме (в отдельном терминале):

```bash
cd frontend && npm install && npm run dev
```

Vite слушает `5177` и проксирует `/api` и `/ws` на `127.0.0.1:8077` — CORS настраивать не нужно.

Сборка продакшн-бандла, который отдаёт сам backend:

```bash
cd frontend && npm run build
```

Проверка типов фронтенда без сборки:

```bash
cd frontend && npm run typecheck
```

Swagger UI доступен всегда: <http://127.0.0.1:8077/docs>.

---

## 7. Остановка

```bash
./stop.sh
```

Останавливает vite и uvicorn по pid-файлам из `data/run/` (проверяя, что pid не переиспользован
системой), затем `docker compose down --remove-orphans`. Тома с данными сохраняются.

| Флаг | Действие |
|---|---|
| *(без флагов)* | остановить приложение + контейнеры, тома оставить |
| `--keep-db` | остановить только backend и frontend; MySQL и Redis продолжат работать |
| `--purge` | остановить всё и выполнить `docker compose down -v` — **удаляет тома `tgvault_mysql_data` и `tgvault_redis_data` со всей базой**. Требует ввода `yes` в интерактивном терминале |
| `-h`, `--help` | справка |

```bash
./stop.sh --keep-db
```

```bash
./stop.sh --purge
```

Проверить, что и где работает:

```bash
./status.sh
```

```bash
./status.sh --json
```

---

## 8. Где лежат данные и как их бэкапить

| Путь | Содержимое | Критичность |
|---|---|---|
| `data/secret.key` | мастер-секрет Fernet | **критично**: без него сессии не расшифровать |
| `data/exports/` | результаты экспорта: медиа, `manifest.json`, отчёты, `index.html` | критично — это и есть продукт |
| `data/avatars/` | аватарки чатов (`{account_id}_{tg_chat_id}.jpg`) | восстановимо ресинком |
| `data/logs/` | `app.log`, `error.log`, `telegram.log`, `backend.out.log`, `frontend.out.log` | не бэкапить |
| `data/run/` | pid-файлы | не бэкапить |
| docker-том `tgvault_mysql_data` | вся база: аккаунты, чаты, сообщения, файлы, задачи | критично |
| docker-том `tgvault_redis_data` | AOF Redis (только кэш и pub/sub) | не критично |
| `.env` | конфигурация, в т.ч. `TGV_SECRET_KEY`, если он там | критично |

Дамп базы из контейнера:

```bash
docker exec tgvault-mysql mysqldump -u tgvault -ptgvault --single-transaction --default-character-set=utf8mb4 tgvault > tgvault-$(date +%Y%m%d).sql
```

Восстановление:

```bash
docker exec -i tgvault-mysql mysql -u tgvault -ptgvault --default-character-set=utf8mb4 tgvault < tgvault-20260816.sql
```

Файлы и ключ (архив папки данных, кроме логов и pid-файлов):

```bash
tar -czf tgvault-data-$(date +%Y%m%d).tar.gz --exclude=data/logs --exclude=data/run data/ .env
```

> **Внимание:** такой архив вместе с дампом БД эквивалентен полному доступу к Telegram-аккаунтам.
> Храните его как секрет.

Полный сброс всего состояния (база, тома, сессии — кроме файлов в `data/exports/`):

```bash
./stop.sh --purge
```
