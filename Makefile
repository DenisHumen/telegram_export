# TgVault — тонкая обёртка над start.sh / stop.sh / status.sh.
# Всё, что реально делает работу, живёт в шелл-скриптах: make здесь только
# для удобства (`make dev` вместо `./start.sh --dev`).
#
# В Windows запускать через Git Bash (make из состава Git for Windows /
# choco install make) — SHELL ниже принудительно задаёт bash.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

.PHONY: help start dev api stop restart status logs rebuild fresh purge compose-config

help: ## показать эту справку
	@printf '\nTgVault — доступные команды:\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@printf '\n'

start: ## обычный запуск (docker + backend + собранный фронтенд)
	@./start.sh

dev: ## запуск с Vite dev-сервером
	@./start.sh --dev

api: ## только API, без фронтенда
	@./start.sh --no-frontend

stop: ## остановить всё (приложение + контейнеры)
	@./stop.sh

restart: ## перезапуск: stop --keep-db, затем start
	@./stop.sh --keep-db || true
	@./start.sh

status: ## показать статус компонентов
	@./status.sh

logs: ## запустить и остаться в логах
	@./start.sh --logs

rebuild: ## переустановить зависимости и пересобрать фронтенд
	@./start.sh --rebuild

fresh: ## пересоздать docker-тома (СНОСИТ БД, спросит подтверждение)
	@./start.sh --fresh

purge: ## остановить всё и удалить docker-тома (СНОСИТ БД)
	@./stop.sh --purge

compose-config: ## проверить синтаксис docker/docker-compose.yml
	@docker compose -f docker/docker-compose.yml config >/dev/null && echo "docker-compose.yml OK"
