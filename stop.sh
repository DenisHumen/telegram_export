#!/usr/bin/env bash
#
# TgVault — остановка всего, что запустил start.sh.
#
#   ./stop.sh              остановить backend + frontend + docker (mysql, redis)
#   ./stop.sh --keep-db    остановить только приложение, контейнеры оставить
#   ./stop.sh --purge      + удалить docker-тома (данные БД!), с подтверждением
#
set -euo pipefail
set -E

case "$0" in
  */*) ROOT_DIR="$(cd "${0%/*}" && pwd -P)" ;;
  *)   ROOT_DIR="$(pwd -P)" ;;
esac
cd "$ROOT_DIR"

COMPOSE_FILE="docker/docker-compose.yml"
ENV_FILE=".env"

UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
IS_WINDOWS=0
case "$UNAME_S" in MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;; esac

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

section() { printf '\n%s%s%s%s\n' "$C_BOLD" "$C_BLUE" "$1" "$C_RESET"; }
info()    { printf '  %s\n' "$*"; }
ok()      { printf '  %s[ok]%s %s\n'   "$C_GREEN"  "$C_RESET" "$*"; }
skip()    { printf '  %s[--]%s %s\n'   "$C_DIM"    "$C_RESET" "$*"; }
warn()    { printf '  %s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
erro()    { printf '  %s[err]%s %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; }

on_error() {
  printf '\n%s%s✖ stop.sh: сбой на строке %s (код %s)%s\n' \
    "$C_BOLD" "$C_RED" "$2" "$1" "$C_RESET" >&2
  exit "$1"
}
trap 'on_error $? $LINENO' ERR

OPT_KEEP_DB=0
OPT_PURGE=0

usage() {
  cat <<'EOF'
TgVault — остановка.

Использование: ./stop.sh [флаги]

  --keep-db     не трогать docker-контейнеры (MySQL/Redis продолжат работать)
  --purge       остановить всё И удалить docker-тома (ВСЕ ДАННЫЕ БД!),
                требует подтверждения словом "yes"
  -h, --help    эта справка
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-db)  OPT_KEEP_DB=1 ;;
    --purge)    OPT_PURGE=1 ;;
    -h|--help)  usage; exit 0 ;;
    *)          usage >&2; erro "Неизвестный флаг: $1"; exit 1 ;;
  esac
  shift
done

have() { command -v "$1" >/dev/null 2>&1; }
nap()  { sleep "$1" 2>/dev/null || sleep 1; }

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

proc_info() {
  { ps -p "$1" -o args= 2>/dev/null || ps -p "$1" 2>/dev/null | tail -n +2 || true; } \
    | tr -d '\r' | tr '\n' ' '
}

win_pid() { ps -p "$1" 2>/dev/null | awk 'NR>1 {print $4; exit}' || true; }

read_pidfile() {
  [ -f "$1" ] || return 1
  _v="$(tr -cd '0-9' < "$1")"
  [ -n "$_v" ] || return 1
  printf '%s' "$_v"
}

# stop_service <название> <pid-файл> <паттерн-владельца>
stop_service() {
  _label="$1"; _pidfile="$2"; _pattern="$3"

  if ! _pid="$(read_pidfile "$_pidfile")"; then
    skip "$_label: pid-файл отсутствует — уже остановлен"
    return 0
  fi

  if ! pid_alive "$_pid"; then
    skip "$_label: процесс $_pid уже не работает (чищу pid-файл)"
    rm -f "$_pidfile"
    return 0
  fi

  # Проверяем, что PID действительно наш, а не переиспользован системой.
  _info="$(proc_info "$_pid")"
  _match=0
  _oldifs="$IFS"; IFS='|'
  for _pat in $_pattern; do
    case "$_info" in *"$_pat"*) _match=1 ;; esac
  done
  IFS="$_oldifs"

  if [ "$_match" -eq 0 ]; then
    warn "$_label: pid $_pid принадлежит чужому процессу — не трогаю"
    [ -n "$_info" ] && printf '        %s%s%s\n' "$C_DIM" "$_info" "$C_RESET" || true
    rm -f "$_pidfile"
    return 0
  fi

  info "$_label: останавливаю pid $_pid ..."
  kill "$_pid" 2>/dev/null || true
  _n=0
  while [ "$_n" -lt 10 ]; do
    pid_alive "$_pid" || break
    nap 0.5
    _n=$((_n + 1))
  done

  if pid_alive "$_pid"; then
    kill -9 "$_pid" 2>/dev/null || true
    nap 1
  fi

  if pid_alive "$_pid" && [ "$IS_WINDOWS" -eq 1 ]; then
    _w="$(win_pid "$_pid")"
    if [ -n "$_w" ]; then
      info "$_label: kill не сработал, пробую taskkill //PID $_w //F //T"
      MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
        taskkill //PID "$_w" //F //T >/dev/null 2>&1 || true
      nap 1
    fi
  fi

  if pid_alive "$_pid"; then
    erro "$_label: не удалось остановить pid $_pid"
    return 1
  fi

  rm -f "$_pidfile"
  ok "$_label остановлен (pid $_pid)"
  return 0
}

# --- каталог данных из .env -------------------------------------------------
DATA_DIR_RAW="./data"
if [ -f "$ENV_FILE" ]; then
  _v="$(sed -n 's/^[[:space:]]*TGV_DATA_DIR[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" 2>/dev/null \
        | head -n1 | tr -d '\r"'"'" || true)"
  [ -n "$_v" ] && DATA_DIR_RAW="$_v" || true
fi
case "$DATA_DIR_RAW" in
  /*|[A-Za-z]:[/\\]*) DATA_DIR="$DATA_DIR_RAW" ;;
  *)                  DATA_DIR="$ROOT_DIR/${DATA_DIR_RAW#./}" ;;
esac
RUN_DIR="$DATA_DIR/run"

printf '\n%sTgVault — остановка%s  %s(%s)%s\n' "$C_BOLD" "$C_RESET" "$C_DIM" "$UNAME_S" "$C_RESET"

# --- приложение -------------------------------------------------------------
section "Приложение"
FAILED=0
stop_service "frontend (vite)" "$RUN_DIR/frontend.pid" 'node|npm|vite' || FAILED=1
stop_service "backend (uvicorn)" "$RUN_DIR/backend.pid" 'python|Python|uvicorn' || FAILED=1

# --- docker -----------------------------------------------------------------
section "Docker (MySQL / Redis)"

DC=""
if have docker && docker info >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
  elif have docker-compose && docker-compose version >/dev/null 2>&1; then
    DC="docker-compose"
  fi
fi

ENV_FILE_ARG=""
[ -f "$ENV_FILE" ] && ENV_FILE_ARG="--env-file $ENV_FILE" || true

dc() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    $DC ${ENV_FILE_ARG} -f "$COMPOSE_FILE" "$@"
}

if [ "$OPT_KEEP_DB" -eq 1 ]; then
  skip "--keep-db: контейнеры оставлены работать"
elif [ -z "$DC" ]; then
  skip "docker недоступен — контейнеры не трогаю"
elif [ ! -f "$COMPOSE_FILE" ]; then
  skip "$COMPOSE_FILE не найден"
else
  RUNNING="$(MSYS_NO_PATHCONV=1 docker ps -q --filter 'name=tgvault-' 2>/dev/null | tr -d '\r' || true)"
  if [ "$OPT_PURGE" -eq 1 ]; then
    if [ ! -t 0 ]; then
      erro "--purge удаляет тома с данными и требует интерактивного подтверждения."
      exit 1
    fi
    printf '  %s%sВНИМАНИЕ:%s --purge удалит тома tgvault_mysql_data и tgvault_redis_data.\n' \
      "$C_BOLD" "$C_RED" "$C_RESET"
    printf '  Все сохранённые чаты, сообщения и метаданные будут ПОТЕРЯНЫ безвозвратно.\n'
    printf '  Введите %syes%s для подтверждения: ' "$C_BOLD" "$C_RESET"
    IFS= read -r CONFIRM || CONFIRM=""
    if [ "$CONFIRM" != "yes" ]; then
      erro "Отменено (введено: '${CONFIRM}'). Тома не тронуты."
      exit 1
    fi
    info "docker compose down -v --remove-orphans ..."
    dc down -v --remove-orphans || FAILED=1
    ok "контейнеры остановлены, тома удалены"
  else
    if [ -z "$RUNNING" ]; then
      info "docker compose down (запущенных tgvault-* контейнеров не видно)"
    else
      info "docker compose down ..."
    fi
    dc down --remove-orphans || FAILED=1
    ok "контейнеры остановлены (тома сохранены)"
  fi
fi

# --- итог -------------------------------------------------------------------
printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '%s%s  TgVault остановлен.%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  [ "$OPT_KEEP_DB" -eq 1 ] && printf '  %sMySQL/Redis продолжают работать (--keep-db).%s\n' "$C_DIM" "$C_RESET" || true
  printf '  %sЗапустить снова: ./start.sh%s\n\n' "$C_DIM" "$C_RESET"
  exit 0
else
  printf '%s%s  Остановлено с ошибками — см. сообщения выше.%s\n\n' "$C_BOLD" "$C_YELLOW" "$C_RESET"
  exit 1
fi
