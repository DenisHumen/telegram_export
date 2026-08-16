#!/usr/bin/env bash
#
# TgVault — ЕДИНСТВЕННАЯ точка запуска.
#
# Работает в Git Bash (Windows), WSL, Linux и macOS.
# Поднимает: MySQL + Redis (docker) -> python venv -> frontend -> FastAPI backend.
#
#   ./start.sh                 обычный запуск (собранный фронтенд отдаёт backend)
#   ./start.sh --dev           Vite dev-сервер вместо собранного бандла
#   ./start.sh --no-docker     считать, что MySQL/Redis уже подняты
#   ./start.sh --help          все флаги
#
set -euo pipefail
set -E   # чтобы trap ERR срабатывал и внутри функций

# ---------------------------------------------------------------------------
# 0. Расположение скрипта (портабельно: readlink -f нет в macOS)
# ---------------------------------------------------------------------------
case "$0" in
  */*) ROOT_DIR="$(cd "${0%/*}" && pwd -P)" ;;
  *)   ROOT_DIR="$(pwd -P)" ;;
esac
cd "$ROOT_DIR"

APP_NAME="TgVault"
COMPOSE_FILE="docker/docker-compose.yml"
ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
REQ_FILE="backend/requirements.txt"
VENV_DIR="$ROOT_DIR/backend/.venv"

UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
IS_WINDOWS=0
IS_MAC=0
case "$UNAME_S" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  Darwin*)              IS_MAC=1 ;;
esac

# ---------------------------------------------------------------------------
# 1. Цвета и вывод
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

STEP=0
section() {
  STEP=$((STEP + 1))
  printf '\n%s%s[%s/%s] %s%s\n' "$C_BOLD" "$C_BLUE" "$STEP" "$TOTAL_STEPS" "$1" "$C_RESET"
  printf '%s%s%s\n' "$C_DIM" "--------------------------------------------------------------" "$C_RESET"
}
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s[ok]%s %s\n'   "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf '  %s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
erro() { printf '  %s[err]%s %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; }
hint() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET" >&2; }

die() {
  erro "$1"
  shift || true
  for l in "$@"; do hint "$l"; done
  exit 1
}

on_error() {
  ec="$1"; line="$2"
  printf '\n%s%s✖ %s: сбой на строке %s (код выхода %s)%s\n' \
    "$C_BOLD" "$C_RED" "$(basename -- "$0")" "$line" "$ec" "$C_RESET" >&2
  hint "Подробности выше. Логи: data/logs/  |  Остановить всё: ./stop.sh"
  exit "$ec"
}
trap 'on_error $? $LINENO' ERR

# ---------------------------------------------------------------------------
# 2. Флаги
# ---------------------------------------------------------------------------
OPT_DOCKER=1
OPT_FRONTEND=1
OPT_REBUILD=0
OPT_DEV=0
OPT_FRESH=0
OPT_LOGS=0
OPT_BROWSER=1
OPT_PORT=""
OPT_SUDO_DOCKER=0
# Все обращения к docker идут через эту переменную, чтобы --sudo-docker
# работал единообразно (в т.ч. в docker compose и docker inspect).
DOCKER_BIN="docker"

usage() {
  cat <<'EOF'
TgVault — единая точка запуска.

Использование: ./start.sh [флаги]

  --no-docker      не трогать docker: MySQL/Redis уже запущены и описаны в .env
  --sudo-docker    вызывать docker через sudo (когда пользователь не в группе
                   docker и нет прав на /var/run/docker.sock)
  --no-frontend    только API, фронтенд не ставить и не собирать
  --dev            запустить Vite dev-сервер (порт TGV_FRONTEND_PORT) вместо
                   собранного бандла frontend/dist
  --rebuild        принудительно переустановить python-зависимости и пересобрать фронтенд
  --fresh          удалить docker-тома (ВСЕ ДАННЫЕ БД!) и создать их заново;
                   требует интерактивного подтверждения словом "yes"
  --port N         запустить backend на порту N (перекрывает TGV_PORT из .env)
  --no-browser     не открывать браузер после старта
  --logs           после старта показывать логи (tail -f), Ctrl+C — выход из логов
  -h, --help       эта справка

Примеры:
  ./start.sh
  ./start.sh --dev --logs
  ./start.sh --no-docker --port 8099
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-docker)   OPT_DOCKER=0 ;;
    --sudo-docker) OPT_SUDO_DOCKER=1 ;;
    --no-frontend) OPT_FRONTEND=0 ;;
    --dev)         OPT_DEV=1 ;;
    --rebuild)     OPT_REBUILD=1 ;;
    --fresh)       OPT_FRESH=1 ;;
    --logs)        OPT_LOGS=1 ;;
    --no-browser)  OPT_BROWSER=0 ;;
    --port)
      shift || die "--port требует номер порта"
      [ $# -gt 0 ] || die "--port требует номер порта"
      OPT_PORT="$1"
      ;;
    --port=*)      OPT_PORT="${1#--port=}" ;;
    -h|--help)     usage; exit 0 ;;
    *)             usage >&2; die "Неизвестный флаг: $1" ;;
  esac
  shift
done

case "$OPT_PORT" in
  ''|*[!0-9]*) [ -z "$OPT_PORT" ] || die "--port ожидает число, получено: $OPT_PORT" ;;
esac

# env-check + .env + каталоги + venv + backend = 4 обязательных секции
TOTAL_STEPS=5
[ "$OPT_DOCKER" -eq 1 ]   && TOTAL_STEPS=$((TOTAL_STEPS + 1)) || true
[ "$OPT_FRONTEND" -eq 1 ] && TOTAL_STEPS=$((TOTAL_STEPS + 1)) || true
[ "$OPT_FRONTEND" -eq 1 ] && [ "$OPT_DEV" -eq 1 ] && TOTAL_STEPS=$((TOTAL_STEPS + 1)) || true

printf '\n%s%s%s v1.0 — launcher%s  %s(%s)%s\n' \
  "$C_BOLD" "$C_CYAN" "$APP_NAME" "$C_RESET" "$C_DIM" "$UNAME_S" "$C_RESET"

# ---------------------------------------------------------------------------
# 3. Мелкие утилиты
# ---------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

PY_BIN=""
PY_ARGS=""
pyrun() {
  if [ -n "$PY_ARGS" ]; then
    # shellcheck disable=SC2086
    "$PY_BIN" $PY_ARGS "$@"
  else
    "$PY_BIN" "$@"
  fi
}

nap() { sleep "$1" 2>/dev/null || sleep 1; }

now_s() { date +%s; }

file_hash() {
  [ -f "$1" ] || { printf 'missing'; return 0; }
  if have sha256sum; then
    sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    pyrun -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"
  fi
}

# Экспортирует KEY=VALUE из .env в окружение (устойчиво к CRLF и кавычкам).
load_env_file() {
  f="$1"
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) : ;; *) continue ;; esac
    k="${line%%=*}"
    v="${line#*=}"
    k="${k// /}"
    k="${k//$'\t'/}"
    case "$k" in
      ''|*[!A-Za-z0-9_]*) continue ;;
      [0-9]*) continue ;;
    esac
    case "$v" in
      \"*\") v="${v#\"}"; v="${v%\"}" ;;
      \'*\') v="${v#\'}"; v="${v%\'}" ;;
    esac
    export "$k=$v"
  done < "$f"
}

HAVE_CURL=0
http_get() {
  if [ "$HAVE_CURL" -eq 1 ]; then
    curl -fsS --max-time 6 "$1"
  else
    pyrun - "$1" <<'PYEOF'
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=6) as r:
        if r.status != 200:
            sys.exit(1)
        sys.stdout.write(r.read().decode("utf-8", "replace"))
except Exception:
    sys.exit(1)
PYEOF
  fi
}

tcp_open() {
  pyrun - "$1" <<'PYEOF'
import socket, sys
s = socket.socket()
s.settimeout(1.0)
try:
    rc = s.connect_ex(("127.0.0.1", int(sys.argv[1])))
finally:
    s.close()
sys.exit(0 if rc == 0 else 1)
PYEOF
}

print_json() {
  if ! printf '%s' "$1" | pyrun -c "import sys,json;print(json.dumps(json.load(sys.stdin),indent=2,ensure_ascii=False))" 2>/dev/null; then
    printf '%s\n' "$1"
  fi
}

pid_alive() {
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null
}

proc_info() {
  { ps -p "$1" -o args= 2>/dev/null || ps -p "$1" 2>/dev/null | tail -n +2 || true; } \
    | tr -d '\r' | tr '\n' ' '
}

win_pid() {
  ps -p "$1" 2>/dev/null | awk 'NR>1 {print $4; exit}' || true
}

# kill_pid <pid> — мягко, затем -9, затем taskkill (Git Bash). 0 = остановлен.
kill_pid() {
  _p="$1"
  pid_alive "$_p" || return 0
  kill "$_p" 2>/dev/null || true
  _n=0
  while [ "$_n" -lt 10 ]; do
    pid_alive "$_p" || return 0
    nap 0.5
    _n=$((_n + 1))
  done
  kill -9 "$_p" 2>/dev/null || true
  nap 1
  if pid_alive "$_p" && [ "$IS_WINDOWS" -eq 1 ]; then
    _w="$(win_pid "$_p")"
    if [ -n "$_w" ]; then
      MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' taskkill //PID "$_w" //F //T >/dev/null 2>&1 || true
    fi
    nap 1
  fi
  pid_alive "$_p" && return 1 || return 0
}

read_pidfile() {
  [ -f "$1" ] || return 1
  _v="$(tr -cd '0-9' < "$1")"
  [ -n "$_v" ] || return 1
  printf '%s' "$_v"
}

# ---------------------------------------------------------------------------
# 4. Preflight
# ---------------------------------------------------------------------------
section "Проверка окружения"

# --- python -----------------------------------------------------------------
for cand in python python3; do
  if have "$cand" && "$cand" -c 'import sys' >/dev/null 2>&1; then
    PY_BIN="$cand"; PY_ARGS=""
    break
  fi
done
if [ -z "$PY_BIN" ] && have py && py -3 -c 'import sys' >/dev/null 2>&1; then
  PY_BIN="py"; PY_ARGS="-3"
fi
[ -n "$PY_BIN" ] || die "Python не найден." \
  "Установите Python 3.10+ и убедитесь, что 'python' есть в PATH." \
  "Windows: https://www.python.org/downloads/  (галочка 'Add python.exe to PATH')"

if ! pyrun -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)'; then
  die "Нужен Python >= 3.10, найден: $(pyrun -c 'import sys;print(sys.version.split()[0])')"
fi
ok "python $(pyrun -c 'import sys;print(sys.version.split()[0])') ($PY_BIN ${PY_ARGS})"

have curl && HAVE_CURL=1 || HAVE_CURL=0

# --- node -------------------------------------------------------------------
if [ "$OPT_FRONTEND" -eq 1 ]; then
  if [ ! -f "frontend/package.json" ]; then
    warn "frontend/package.json отсутствует — фронтенд пропущен (API-only режим)."
    OPT_FRONTEND=0
    TOTAL_STEPS=$((TOTAL_STEPS - 1))
    [ "$OPT_DEV" -eq 1 ] && TOTAL_STEPS=$((TOTAL_STEPS - 1)) || true
  else
    have node || die "Node.js не найден." \
      "Установите Node.js >= 18 (https://nodejs.org) или запустите с --no-frontend."
    have npm || die "npm не найден." "Обычно ставится вместе с Node.js. Либо запустите с --no-frontend."
    NODE_V="$(node -v 2>/dev/null || echo v0)"
    NODE_MAJOR="${NODE_V#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
    case "$NODE_MAJOR" in
      ''|*[!0-9]*) die "Не удалось определить версию Node.js (получено '$NODE_V')." ;;
    esac
    [ "$NODE_MAJOR" -ge 18 ] || die "Нужен Node.js >= 18, найден $NODE_V." \
      "Обновите Node.js или запустите с --no-frontend."
    ok "node $NODE_V, npm $(npm -v 2>/dev/null || echo '?')"
  fi
fi

# --- docker -----------------------------------------------------------------
DC=""
if [ "$OPT_DOCKER" -eq 1 ]; then
  have docker || die "Docker не найден, а MySQL/Redis нужны для работы." \
    "Вариант 1: установите Docker Desktop — https://www.docker.com/products/docker-desktop" \
    "Вариант 2: поднимите MySQL 8 и Redis 7 сами и запустите:" \
    "           ./start.sh --no-docker   (адреса и пароли пропишите в .env)"
  if [ "$OPT_SUDO_DOCKER" -eq 1 ]; then
    have sudo || die "--sudo-docker указан, но команда 'sudo' не найдена."
    DOCKER_BIN="sudo docker"
    info "docker вызывается через sudo (--sudo-docker); может спросить пароль"
  fi

  # Важно разделять две разные причины отказа: демон не запущен и нет прав на
  # сокет. Раньше обе давали совет «запустите демон», что бесполезно, когда
  # демон уже работает, а пользователь просто не состоит в группе docker.
  DOCKER_ERR="$($DOCKER_BIN info 2>&1 >/dev/null || true)"
  if [ -n "$DOCKER_ERR" ]; then
    case "$DOCKER_ERR" in
      *"ermission denied"*)
        die "Нет прав на сокет Docker — демон запущен, но недоступен вашему пользователю." \
          "Ваш пользователь не входит в группу 'docker'." \
          "" \
          "Постоянное решение:" \
          "    sudo usermod -aG docker \$USER && newgrp docker" \
          "(newgrp применит группу к текущей оболочке; в новых терминалах — само)" \
          "" \
          "Разовый обход:  ./start.sh --sudo-docker" \
          "Без docker:     ./start.sh --no-docker  (MySQL/Redis подняты вами, адреса в .env)"
        ;;
      *"annot connect to the Docker daemon"*|*"docker daemon is not running"*|*"pipe/dockerDesktop"*)
        die "Docker установлен, но демон не отвечает." \
          "Linux:   sudo systemctl start docker" \
          "Win/Mac: запустите Docker Desktop и дождитесь статуса Running" \
          "Либо:    ./start.sh --no-docker с уже поднятыми MySQL/Redis в .env"
        ;;
      *)
        die "Docker недоступен. Ответ 'docker info':" \
          "    ${DOCKER_ERR}" \
          "Либо: ./start.sh --no-docker с уже поднятыми MySQL/Redis в .env"
        ;;
    esac
  fi

  if $DOCKER_BIN compose version >/dev/null 2>&1; then
    DC="$DOCKER_BIN compose"
  elif have docker-compose && docker-compose version >/dev/null 2>&1; then
    DC="docker-compose"
    [ "$OPT_SUDO_DOCKER" -eq 1 ] && DC="sudo docker-compose"
  else
    die "Не найден ни 'docker compose', ни 'docker-compose'." \
      "Установите плагин compose (Fedora: sudo dnf install docker-compose-plugin)."
  fi
  ok "docker $($DOCKER_BIN version --format '{{.Server.Version}}' 2>/dev/null || echo '?') ($DC)"
else
  info "docker пропущен (--no-docker): MySQL/Redis должны быть уже запущены."
fi

[ -f "$COMPOSE_FILE" ] || [ "$OPT_DOCKER" -eq 0 ] || die "Не найден $COMPOSE_FILE"
[ -f "$REQ_FILE" ] || die "Не найден $REQ_FILE"

# ---------------------------------------------------------------------------
# 5. .env
# ---------------------------------------------------------------------------
section "Конфигурация (.env)"

if [ -f "$ENV_FILE" ]; then
  ok ".env уже существует — оставляю как есть"
else
  [ -f "$ENV_EXAMPLE" ] || die "Нет ни .env, ни $ENV_EXAMPLE — нечего копировать."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  SECRET="$(pyrun -c 'import secrets;print(secrets.token_urlsafe(48))')"
  if grep -q '^TGV_SECRET_KEY=' "$ENV_FILE" 2>/dev/null; then
    awk -v k="$SECRET" '
      /^TGV_SECRET_KEY=/ && !done { print "TGV_SECRET_KEY=" k; done = 1; next }
      { print }
    ' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf 'TGV_SECRET_KEY=%s\n' "$SECRET" >> "$ENV_FILE"
  fi
  unset SECRET
  ok ".env создан из $ENV_EXAMPLE, сгенерирован TGV_SECRET_KEY"
fi

load_env_file "$ENV_FILE"

TGV_HOST="${TGV_HOST:-127.0.0.1}"
TGV_PORT="${TGV_PORT:-8077}"
TGV_DATA_DIR="${TGV_DATA_DIR:-./data}"
TGV_FRONTEND_PORT="${TGV_FRONTEND_PORT:-5177}"
[ -n "$OPT_PORT" ] && TGV_PORT="$OPT_PORT" || true
export TGV_HOST TGV_PORT TGV_DATA_DIR TGV_FRONTEND_PORT

case "$TGV_DATA_DIR" in
  /*|[A-Za-z]:[/\\]*) DATA_DIR="$TGV_DATA_DIR" ;;
  *)                  DATA_DIR="$ROOT_DIR/${TGV_DATA_DIR#./}" ;;
esac
RUN_DIR="$DATA_DIR/run"
LOG_DIR="$DATA_DIR/logs"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.out.log"
FRONTEND_LOG="$LOG_DIR/frontend.out.log"
HEALTH_URL="http://127.0.0.1:$TGV_PORT/api/health"

info "backend  : http://$TGV_HOST:$TGV_PORT"
info "data dir : $DATA_DIR"

# ---------------------------------------------------------------------------
# 6. Каталоги
# ---------------------------------------------------------------------------
section "Каталоги данных"
mkdir -p "$DATA_DIR" "$LOG_DIR" "$DATA_DIR/exports" "$RUN_DIR"
ok "$DATA_DIR  (logs/, exports/, run/)"

# ---------------------------------------------------------------------------
# 7. Docker: MySQL + Redis
# ---------------------------------------------------------------------------
dc() {
  # Относительные пути специально: Git Bash не конвертирует их в Windows-пути.
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    $DC --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

container_health() {
  _st="$(MSYS_NO_PATHCONV=1 $DOCKER_BIN inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' \
      "$1" 2>/dev/null || true)"
  [ -n "$_st" ] || _st="missing"
  printf '%s' "$_st"
}

wait_for_service() {
  _name="$1"; _container="$2"; _timeout="$3"; _svc="$4"
  _deadline=$(( $(now_s) + _timeout ))
  printf '  ожидаю %s ' "$_name"
  while [ "$(now_s)" -lt "$_deadline" ]; do
    _h="$(container_health "$_container")"
    case "$_h" in
      healthy)
        printf ' %s[ok]%s\n' "$C_GREEN" "$C_RESET"
        return 0
        ;;
      nohealth)
        # У образа нет healthcheck — пробуем вручную.
        if [ "$_svc" = "mysql" ]; then
          if dc exec -T mysql mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; then
            printf ' %s[ok]%s\n' "$C_GREEN" "$C_RESET"; return 0
          fi
        else
          if dc exec -T redis redis-cli ping 2>/dev/null | tr -d '\r' | grep -q PONG; then
            printf ' %s[ok]%s\n' "$C_GREEN" "$C_RESET"; return 0
          fi
        fi
        ;;
      missing)
        printf ' %s[err]%s\n' "$C_RED" "$C_RESET"
        erro "Контейнер $_container не создан."
        return 1
        ;;
    esac
    printf '.'
    nap 2
  done
  printf ' %s[timeout]%s\n' "$C_RED" "$C_RESET"
  return 1
}

if [ "$OPT_DOCKER" -eq 1 ]; then
  section "MySQL 8 + Redis 7 (docker)"

  if [ "$OPT_FRESH" -eq 1 ]; then
    if [ ! -t 0 ]; then
      die "--fresh удаляет тома с данными и требует интерактивного подтверждения." \
        "Запустите ./start.sh --fresh из терминала."
    fi
    printf '  %s%sВНИМАНИЕ:%s --fresh удалит тома tgvault_mysql_data и tgvault_redis_data.\n' \
      "$C_BOLD" "$C_RED" "$C_RESET"
    printf '  Все выгруженные сообщения и метаданные в БД будут ПОТЕРЯНЫ.\n'
    printf '  Введите %syes%s для подтверждения: ' "$C_BOLD" "$C_RESET"
    IFS= read -r CONFIRM || CONFIRM=""
    [ "$CONFIRM" = "yes" ] || die "Отменено пользователем (введено: '${CONFIRM}')."
    info "удаляю контейнеры и тома..."
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    ok "тома удалены"
  fi

  info "docker compose up -d ..."
  if ! dc up -d; then
    die "Не удалось запустить docker compose." \
      "Проверьте: docker compose -f $COMPOSE_FILE config" \
      "И занятость портов 13306 / 16379."
  fi

  if ! wait_for_service "MySQL (до 120с)" "tgvault-mysql" 120 mysql; then
    erro "MySQL не стал healthy. Последние строки лога контейнера:"
    dc logs --tail=40 mysql 2>&1 | sed 's/^/    /' || true
    die "MySQL недоступен." \
      "Часто помогает: ./start.sh --fresh (пересоздать том) или освободить порт ${TGV_MYSQL_PORT:-13306}."
  fi

  if ! wait_for_service "Redis (до 30с)" "tgvault-redis" 30 redis; then
    erro "Redis не стал healthy. Последние строки лога контейнера:"
    dc logs --tail=40 redis 2>&1 | sed 's/^/    /' || true
    die "Redis недоступен." "Освободите порт 16379 или запустите с TGV_REDIS_ENABLED=false."
  fi

  ok "MySQL 127.0.0.1:${TGV_MYSQL_PORT:-13306}, Redis 127.0.0.1:16379"
fi

# ---------------------------------------------------------------------------
# 8. Python venv + зависимости
# ---------------------------------------------------------------------------
section "Python venv и зависимости"

venv_python() {
  if [ -f "$VENV_DIR/Scripts/python.exe" ]; then
    printf '%s' "$VENV_DIR/Scripts/python.exe"
  elif [ -f "$VENV_DIR/bin/python" ]; then
    printf '%s' "$VENV_DIR/bin/python"
  elif [ -f "$VENV_DIR/bin/python3" ]; then
    printf '%s' "$VENV_DIR/bin/python3"
  else
    return 1
  fi
}

if [ "$OPT_REBUILD" -eq 1 ] && [ -d "$VENV_DIR" ]; then
  info "--rebuild: зависимости будут переустановлены"
fi

if ! VPY="$(venv_python)"; then
  info "создаю venv: backend/.venv"
  pyrun -m venv "$VENV_DIR" || die "Не удалось создать venv в $VENV_DIR" \
    "Linux: возможно, нужен пакет python3-venv (apt install python3-venv)."
  VPY="$(venv_python)" || die "venv создан, но интерпретатор не найден в $VENV_DIR"
  ok "venv создан"
else
  ok "venv найден: ${VPY#$ROOT_DIR/}"
fi

DEPS_STAMP="$VENV_DIR/.deps-hash"
REQ_HASH="$(file_hash "$REQ_FILE")"
NEED_INSTALL=1
if [ "$OPT_REBUILD" -eq 0 ] && [ -f "$DEPS_STAMP" ]; then
  if [ "$(tr -d '[:space:]' < "$DEPS_STAMP")" = "$REQ_HASH" ]; then
    NEED_INSTALL=0
  fi
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  info "pip install -r $REQ_FILE (может занять пару минут)..."
  "$VPY" -m pip install --upgrade pip setuptools wheel --quiet \
    || warn "не удалось обновить pip — продолжаю"
  if ! "$VPY" -m pip install -r "$REQ_FILE"; then
    die "Не удалось установить python-зависимости." \
      "Проверьте интернет/прокси и содержимое $REQ_FILE."
  fi
  printf '%s\n' "$REQ_HASH" > "$DEPS_STAMP"
  ok "зависимости установлены"
else
  ok "зависимости актуальны (hash requirements.txt не изменился)"
fi

# ---------------------------------------------------------------------------
# 9. Frontend
# ---------------------------------------------------------------------------
frontend_src_hash() {
  pyrun - "$ROOT_DIR/frontend" <<'PYEOF'
import hashlib, os, sys
root = sys.argv[1]
h = hashlib.sha256()
skip = {"node_modules", "dist", ".git", ".vite", ".turbo"}
for base, dirs, files in os.walk(root):
    dirs[:] = sorted(d for d in dirs if d not in skip)
    for f in sorted(files):
        p = os.path.join(base, f)
        rel = os.path.relpath(p, root).replace("\\", "/")
        try:
            st = os.stat(p)
        except OSError:
            continue
        h.update(rel.encode("utf-8"))
        h.update(b"%d" % st.st_size)
        h.update(b"%d" % int(st.st_mtime))
print(h.hexdigest())
PYEOF
}

FRONTEND_MODE="skipped"
if [ "$OPT_FRONTEND" -eq 1 ]; then
  section "Frontend"

  STAMP_DIR="$DATA_DIR/.stamps"
  mkdir -p "$STAMP_DIR"

  LOCK_FILE="frontend/package-lock.json"
  [ -f "$LOCK_FILE" ] || LOCK_FILE="frontend/package.json"
  LOCK_HASH="$(file_hash "$LOCK_FILE")"
  NPM_STAMP="$STAMP_DIR/frontend-npm.hash"

  NEED_NPM=1
  if [ "$OPT_REBUILD" -eq 0 ] && [ -d "frontend/node_modules" ] && [ -f "$NPM_STAMP" ]; then
    [ "$(tr -d '[:space:]' < "$NPM_STAMP")" = "$LOCK_HASH" ] && NEED_NPM=0 || true
  fi

  FE_OK=1
  if [ "$NEED_NPM" -eq 1 ]; then
    info "npm install ..."
    if ( cd frontend && npm install --no-fund --no-audit ); then
      printf '%s\n' "$LOCK_HASH" > "$NPM_STAMP"
      ok "npm-зависимости установлены"
    else
      warn "npm install завершился ошибкой — продолжаю в режиме API-only"
      FE_OK=0
    fi
  else
    ok "node_modules актуальны"
  fi

  if [ "$FE_OK" -eq 1 ] && [ "$OPT_DEV" -eq 0 ]; then
    SRC_HASH="$(frontend_src_hash)"
    BUILD_STAMP="$STAMP_DIR/frontend-build.hash"
    NEED_BUILD=1
    if [ "$OPT_REBUILD" -eq 0 ] && [ -f "frontend/dist/index.html" ] && [ -f "$BUILD_STAMP" ]; then
      [ "$(tr -d '[:space:]' < "$BUILD_STAMP")" = "$SRC_HASH" ] && NEED_BUILD=0 || true
    fi
    if [ "$NEED_BUILD" -eq 1 ]; then
      info "npm run build ..."
      if ( cd frontend && npm run build ); then
        printf '%s\n' "$(frontend_src_hash)" > "$BUILD_STAMP"
        ok "frontend/dist собран — его отдаёт backend"
        FRONTEND_MODE="static"
      else
        warn "сборка фронтенда упала — стартую в режиме API-only (/docs работает)"
        FE_OK=0
      fi
    else
      ok "frontend/dist актуален"
      FRONTEND_MODE="static"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 10. Backend
# ---------------------------------------------------------------------------
section "Backend (uvicorn)"

REUSE_BACKEND=0
if EXIST_PID="$(read_pidfile "$BACKEND_PID_FILE")" && pid_alive "$EXIST_PID"; then
  PINFO="$(proc_info "$EXIST_PID")"
  case "$PINFO" in
    *python*|*Python*|*uvicorn*)
      if [ "$OPT_REBUILD" -eq 1 ] || [ "$OPT_FRESH" -eq 1 ] || [ -n "$OPT_PORT" ]; then
        info "backend уже запущен (pid $EXIST_PID) — перезапускаю"
        kill_pid "$EXIST_PID" || warn "не удалось остановить pid $EXIST_PID"
        rm -f "$BACKEND_PID_FILE"
      elif http_get "$HEALTH_URL" >/dev/null 2>&1; then
        ok "backend уже работает и здоров (pid $EXIST_PID) — переиспользую"
        REUSE_BACKEND=1
      else
        info "backend жив (pid $EXIST_PID), но /api/health не отвечает — перезапускаю"
        kill_pid "$EXIST_PID" || warn "не удалось остановить pid $EXIST_PID"
        rm -f "$BACKEND_PID_FILE"
      fi
      ;;
    *)
      warn "pid $EXIST_PID из backend.pid принадлежит другому процессу — игнорирую"
      rm -f "$BACKEND_PID_FILE"
      ;;
  esac
else
  rm -f "$BACKEND_PID_FILE" 2>/dev/null || true
fi

if [ "$REUSE_BACKEND" -eq 0 ]; then
  [ -f "backend/app/main.py" ] || die "Не найден backend/app/main.py — код бэкенда отсутствует." \
    "Ожидается FastAPI-приложение 'app' в backend/app/main.py (см. docs/CONTRACT.md §1)."

  if tcp_open "$TGV_PORT"; then
    die "Порт $TGV_PORT уже занят другим процессом." \
      "Остановите его (./stop.sh) или выберите другой порт: ./start.sh --port 8078"
  fi

  info "uvicorn app.main:app --host $TGV_HOST --port $TGV_PORT"
  : > "$BACKEND_LOG"
  (
    cd "$ROOT_DIR/backend" || exit 1
    export PYTHONUNBUFFERED=1
    exec nohup "$VPY" -m uvicorn app.main:app \
      --host "$TGV_HOST" --port "$TGV_PORT" >>"$BACKEND_LOG" 2>&1
  ) &
  BACKEND_PID=$!
  disown "$BACKEND_PID" 2>/dev/null || true
  printf '%s\n' "$BACKEND_PID" > "$BACKEND_PID_FILE"
  info "pid $BACKEND_PID, лог: ${BACKEND_LOG#$ROOT_DIR/}"

  printf '  ожидаю /api/health '
  DEADLINE=$(( $(now_s) + 60 ))
  HEALTH_BODY=""
  while [ "$(now_s)" -lt "$DEADLINE" ]; do
    if ! pid_alive "$BACKEND_PID"; then
      printf ' %s[crash]%s\n' "$C_RED" "$C_RESET"
      erro "Процесс backend завершился. Последние строки $BACKEND_LOG:"
      tail -n 30 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    /' || true
      rm -f "$BACKEND_PID_FILE"
      die "Backend не стартовал."
    fi
    if HEALTH_BODY="$(http_get "$HEALTH_URL" 2>/dev/null)"; then
      printf ' %s[ok]%s\n' "$C_GREEN" "$C_RESET"
      break
    fi
    HEALTH_BODY=""
    printf '.'
    nap 1
  done

  if [ -z "$HEALTH_BODY" ]; then
    printf ' %s[timeout]%s\n' "$C_RED" "$C_RESET"
    erro "GET $HEALTH_URL не ответил 200 за 60с. Последние строки лога:"
    tail -n 30 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    /' || true
    die "Backend не прошёл health-check." "Остановить: ./stop.sh"
  fi
else
  HEALTH_BODY="$(http_get "$HEALTH_URL" 2>/dev/null || true)"
fi

if [ -n "${HEALTH_BODY:-}" ]; then
  printf '  %s/api/health:%s\n' "$C_DIM" "$C_RESET"
  print_json "$HEALTH_BODY" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 11. Frontend dev-сервер (--dev)
# ---------------------------------------------------------------------------
if [ "$OPT_FRONTEND" -eq 1 ] && [ "$OPT_DEV" -eq 1 ] && [ "${FE_OK:-0}" -eq 1 ]; then
  section "Vite dev-сервер"

  if FE_PID="$(read_pidfile "$FRONTEND_PID_FILE")" && pid_alive "$FE_PID"; then
    info "останавливаю предыдущий dev-сервер (pid $FE_PID)"
    kill_pid "$FE_PID" || warn "не удалось остановить pid $FE_PID"
    rm -f "$FRONTEND_PID_FILE"
  fi

  if tcp_open "$TGV_FRONTEND_PORT"; then
    warn "порт $TGV_FRONTEND_PORT занят — dev-сервер не запускаю"
  else
    : > "$FRONTEND_LOG"
    (
      cd "$ROOT_DIR/frontend" \
        && exec nohup npm run dev -- --port "$TGV_FRONTEND_PORT" --strictPort \
             >>"$FRONTEND_LOG" 2>&1
    ) &
    FRONTEND_PID=$!
    disown "$FRONTEND_PID" 2>/dev/null || true
    printf '%s\n' "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

    printf '  ожидаю http://127.0.0.1:%s ' "$TGV_FRONTEND_PORT"
    FE_DEADLINE=$(( $(now_s) + 60 ))
    FE_UP=0
    while [ "$(now_s)" -lt "$FE_DEADLINE" ]; do
      if tcp_open "$TGV_FRONTEND_PORT"; then FE_UP=1; break; fi
      pid_alive "$FRONTEND_PID" || break
      printf '.'
      nap 1
    done
    if [ "$FE_UP" -eq 1 ]; then
      printf ' %s[ok]%s\n' "$C_GREEN" "$C_RESET"
      ok "dev-сервер, pid $FRONTEND_PID, лог: ${FRONTEND_LOG#$ROOT_DIR/}"
      FRONTEND_MODE="dev"
    else
      printf ' %s[fail]%s\n' "$C_YELLOW" "$C_RESET"
      warn "dev-сервер не поднялся, см. ${FRONTEND_LOG#$ROOT_DIR/} — работаем в API-only"
      rm -f "$FRONTEND_PID_FILE"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 12. Итоговый баннер
# ---------------------------------------------------------------------------
if [ "$FRONTEND_MODE" = "dev" ]; then
  UI_URL="http://127.0.0.1:$TGV_FRONTEND_PORT"
else
  UI_URL="http://127.0.0.1:$TGV_PORT"
fi
DOCS_URL="http://127.0.0.1:$TGV_PORT/docs"

printf '\n%s%s' "$C_BOLD" "$C_GREEN"
printf '  ╔══════════════════════════════════════════════════════════════╗\n'
printf '  ║                    TgVault запущен                           ║\n'
printf '  ╚══════════════════════════════════════════════════════════════╝%s\n' "$C_RESET"
printf '\n'
printf '   %sUI%s        %s\n' "$C_BOLD" "$C_RESET" "$UI_URL"
printf '   %sAPI docs%s  %s\n' "$C_BOLD" "$C_RESET" "$DOCS_URL"
printf '   %sHealth%s    %s\n' "$C_BOLD" "$C_RESET" "$HEALTH_URL"
printf '   %sРежим%s     frontend: %s\n' "$C_BOLD" "$C_RESET" "$FRONTEND_MODE"
printf '   %sДанные%s    %s\n' "$C_BOLD" "$C_RESET" "$DATA_DIR"
printf '   %sЛоги%s      %s\n' "$C_BOLD" "$C_RESET" "$LOG_DIR"
printf '\n'
printf '   %sСтатус:%s  ./status.sh      %sОстановить:%s  ./stop.sh\n' \
  "$C_DIM" "$C_RESET" "$C_DIM" "$C_RESET"
printf '\n'

# ---------------------------------------------------------------------------
# 13. Браузер
# ---------------------------------------------------------------------------
open_browser() {
  _u="$1"
  if [ "$IS_WINDOWS" -eq 1 ]; then
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd.exe //c start "" "$_u" >/dev/null 2>&1 && return 0
    have explorer.exe && explorer.exe "$_u" >/dev/null 2>&1
    return 0
  fi
  if [ "$IS_MAC" -eq 1 ] && have open; then open "$_u" >/dev/null 2>&1 && return 0; fi
  have xdg-open && xdg-open "$_u" >/dev/null 2>&1 && return 0
  return 0
}

if [ "$OPT_BROWSER" -eq 1 ]; then
  open_browser "$UI_URL" || true
fi

# ---------------------------------------------------------------------------
# 14. Логи
# ---------------------------------------------------------------------------
if [ "$OPT_LOGS" -eq 1 ]; then
  printf '%s  Логи (Ctrl+C — выйти, сервисы продолжат работать)%s\n\n' "$C_DIM" "$C_RESET"
  trap 'printf "\n"; exit 0' INT
  trap - ERR
  TAIL_FILES="$BACKEND_LOG"
  [ -f "$LOG_DIR/app.log" ] && TAIL_FILES="$TAIL_FILES $LOG_DIR/app.log" || true
  [ "$FRONTEND_MODE" = "dev" ] && [ -f "$FRONTEND_LOG" ] && TAIL_FILES="$TAIL_FILES $FRONTEND_LOG" || true
  # shellcheck disable=SC2086
  tail -n 40 -f $TAIL_FILES
fi

exit 0
