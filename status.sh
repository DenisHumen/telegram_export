#!/usr/bin/env bash
#
# TgVault — компактный статус всех частей системы.
#
#   ./status.sh          таблица состояния
#   ./status.sh --json   health-ответ бэкенда как есть (для скриптов)
#
set -uo pipefail

case "$0" in
  */*) ROOT_DIR="$(cd "${0%/*}" && pwd -P)" ;;
  *)   ROOT_DIR="$(pwd -P)" ;;
esac
cd "$ROOT_DIR"

ENV_FILE=".env"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

OPT_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json)    OPT_JSON=1 ;;
    -h|--help)
      printf 'TgVault status.\n\n  ./status.sh          таблица состояния\n  ./status.sh --json   только JSON из /api/health\n'
      exit 0
      ;;
    *) printf 'Неизвестный флаг: %s\n' "$1" >&2; exit 1 ;;
  esac
  shift
done

have() { command -v "$1" >/dev/null 2>&1; }

PY_BIN=""; PY_ARGS=""
for cand in python python3; do
  if have "$cand" && "$cand" -c 'import sys' >/dev/null 2>&1; then PY_BIN="$cand"; break; fi
done
if [ -z "$PY_BIN" ] && have py && py -3 -c 'import sys' >/dev/null 2>&1; then
  PY_BIN="py"; PY_ARGS="-3"
fi
pyrun() {
  [ -n "$PY_BIN" ] || return 1
  if [ -n "$PY_ARGS" ]; then "$PY_BIN" $PY_ARGS "$@"; else "$PY_BIN" "$@"; fi
}

env_get() {
  _k="$1"; _d="${2-}"
  _v=""
  if [ -f "$ENV_FILE" ]; then
    _v="$(sed -n "s/^[[:space:]]*${_k}[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" 2>/dev/null \
          | head -n1 | tr -d '\r"'"'" || true)"
  fi
  [ -n "$_v" ] && printf '%s' "$_v" || printf '%s' "$_d"
}

TGV_PORT="$(env_get TGV_PORT 8077)"
TGV_FRONTEND_PORT="$(env_get TGV_FRONTEND_PORT 5177)"
TGV_MYSQL_PORT="$(env_get TGV_MYSQL_PORT 13306)"
DATA_DIR_RAW="$(env_get TGV_DATA_DIR ./data)"
case "$DATA_DIR_RAW" in
  /*|[A-Za-z]:[/\\]*) DATA_DIR="$DATA_DIR_RAW" ;;
  *)                  DATA_DIR="$ROOT_DIR/${DATA_DIR_RAW#./}" ;;
esac
RUN_DIR="$DATA_DIR/run"
LOG_DIR="$DATA_DIR/logs"
HEALTH_URL="http://127.0.0.1:$TGV_PORT/api/health"

http_get() {
  if have curl; then
    curl -fsS --max-time 5 "$1"
  else
    pyrun - "$1" <<'PYEOF'
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=5) as r:
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
s = socket.socket(); s.settimeout(1.0)
try:
    rc = s.connect_ex(("127.0.0.1", int(sys.argv[1])))
finally:
    s.close()
sys.exit(0 if rc == 0 else 1)
PYEOF
}

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

read_pidfile() {
  [ -f "$1" ] || return 1
  _v="$(tr -cd '0-9' < "$1")"
  [ -n "$_v" ] || return 1
  printf '%s' "$_v"
}

UP="${C_GREEN}● up${C_RESET}"
DOWN="${C_RED}○ down${C_RESET}"

row() { printf '  %-14s %-34s %s\n' "$1" "$2" "$3"; }

# --- JSON-режим -------------------------------------------------------------
if [ "$OPT_JSON" -eq 1 ]; then
  http_get "$HEALTH_URL" || { printf '{"status":"down"}\n'; exit 1; }
  printf '\n'
  exit 0
fi

printf '\n%s%sTgVault — статус%s   %s%s%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET" "$C_DIM" "$ROOT_DIR" "$C_RESET"
printf '  %s\n' "--------------------------------------------------------------------------"
printf '  %-14s %-34s %s\n' "COMPONENT" "ADDRESS / DETAILS" "STATE"
printf '  %s\n' "--------------------------------------------------------------------------"

# --- backend ----------------------------------------------------------------
B_PID="$(read_pidfile "$RUN_DIR/backend.pid" || true)"
B_STATE="$DOWN"
B_DETAIL="http://127.0.0.1:$TGV_PORT"
HEALTH_BODY=""
if [ -n "$B_PID" ] && pid_alive "$B_PID"; then
  B_DETAIL="$B_DETAIL  pid=$B_PID"
else
  [ -n "$B_PID" ] && B_DETAIL="$B_DETAIL  pid=$B_PID (мёртв)" || B_DETAIL="$B_DETAIL  pid=-"
fi
if HEALTH_BODY="$(http_get "$HEALTH_URL" 2>/dev/null)"; then
  B_STATE="$UP"
elif tcp_open "$TGV_PORT"; then
  B_STATE="${C_YELLOW}◐ порт занят, /api/health молчит${C_RESET}"
  HEALTH_BODY=""
else
  HEALTH_BODY=""
fi
row "backend" "$B_DETAIL" "$B_STATE"

# --- frontend ---------------------------------------------------------------
F_PID="$(read_pidfile "$RUN_DIR/frontend.pid" || true)"
if [ -n "$F_PID" ] && pid_alive "$F_PID" && tcp_open "$TGV_FRONTEND_PORT"; then
  row "frontend" "http://127.0.0.1:$TGV_FRONTEND_PORT  pid=$F_PID (dev)" "$UP"
elif [ -f "frontend/dist/index.html" ]; then
  row "frontend" "frontend/dist — отдаётся бэкендом" "${C_GREEN}● built${C_RESET}"
else
  row "frontend" "нет dev-сервера и нет frontend/dist" "$DOWN"
fi

# --- docker -----------------------------------------------------------------
container_row() {
  _label="$1"; _name="$2"; _detail="$3"
  if ! have docker || ! docker info >/dev/null 2>&1; then
    row "$_label" "docker недоступен" "$DOWN"
    return
  fi
  _st="$(MSYS_NO_PATHCONV=1 docker inspect \
      --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' \
      "$_name" 2>/dev/null | tr -d '\r')"
  if [ -z "$_st" ]; then
    row "$_label" "контейнер $_name не создан" "$DOWN"
    return
  fi
  _run="${_st%%|*}"; _health="${_st##*|}"
  case "$_run/$_health" in
    running/healthy) _s="${C_GREEN}● up (healthy)${C_RESET}" ;;
    running/starting) _s="${C_YELLOW}◐ starting${C_RESET}" ;;
    running/unhealthy) _s="${C_RED}● up (unhealthy)${C_RESET}" ;;
    running/-) _s="${C_GREEN}● up${C_RESET}" ;;
    *) _s="${C_RED}○ $_run${C_RESET}" ;;
  esac
  row "$_label" "$_detail" "$_s"
}
container_row "mysql" "tgvault-mysql" "127.0.0.1:$TGV_MYSQL_PORT  (tgvault-mysql)"
container_row "redis" "tgvault-redis" "127.0.0.1:16379  (tgvault-redis)"

# --- диск -------------------------------------------------------------------
EXPORTS_DIR="$DATA_DIR/exports"
EXPORTS_SHORT="${EXPORTS_DIR#$ROOT_DIR/}"
if [ -d "$EXPORTS_DIR" ]; then
  EX_SIZE="$(du -sh "$EXPORTS_DIR" 2>/dev/null | awk '{print $1}')"
  [ -n "$EX_SIZE" ] || EX_SIZE="?"
  EX_N="$(find "$EXPORTS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  row "exports" "$EXPORTS_SHORT" "${C_BOLD}${EX_SIZE}${C_RESET} / ${EX_N} dir(s)"
else
  row "exports" "$EXPORTS_SHORT" "${C_DIM}(нет)${C_RESET}"
fi

printf '  %s\n' "--------------------------------------------------------------------------"

# --- health JSON ------------------------------------------------------------
if [ -n "$HEALTH_BODY" ]; then
  printf '\n  %s/api/health%s\n' "$C_BOLD" "$C_RESET"
  if ! printf '%s' "$HEALTH_BODY" \
      | pyrun -c "import sys,json;print(json.dumps(json.load(sys.stdin),indent=2,ensure_ascii=False))" 2>/dev/null \
      | sed 's/^/    /'; then
    printf '    %s\n' "$HEALTH_BODY"
  fi
fi

# --- последние строки app.log ----------------------------------------------
APP_LOG="$LOG_DIR/app.log"
printf '\n  %sПоследние 5 строк %s%s\n' "$C_BOLD" "${APP_LOG#$ROOT_DIR/}" "$C_RESET"
if [ -f "$APP_LOG" ]; then
  tail -n 5 "$APP_LOG" 2>/dev/null | sed 's/^/    /' || true
else
  printf '    %s(файл ещё не создан)%s\n' "$C_DIM" "$C_RESET"
fi

printf '\n  %sЗапуск: ./start.sh   Остановка: ./stop.sh%s\n\n' "$C_DIM" "$C_RESET"

[ -n "$HEALTH_BODY" ] && exit 0 || exit 1
