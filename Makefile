# rushsite root tasks. Calls into the pnpm workspaces, the Go agent and the C# plugin.

SHELL := /bin/bash
# Falls back to .env.example so compose commands work on a fresh clone.
ENV_FILE     := $(if $(wildcard .env),.env,.env.example)
COMPOSE      := docker compose --env-file $(ENV_FILE)
COMPOSE_PROD := docker compose --env-file $(ENV_FILE) -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help install dev infra-up infra-down build test smoke \
        docker-build up down logs prod-up prod-down backup config

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## Install workspace dependencies
	pnpm install

infra-up: ## Start postgres, redis and minio only
	$(COMPOSE) up -d --wait postgres redis minio
	$(COMPOSE) up --no-log-prefix minio-init

infra-down: ## Stop the dev infra containers
	$(COMPOSE) stop $(INFRA_SVCS)

dev: infra-up ## Start infra in Docker and run api and web in watch mode on the host
	pnpm -r --parallel --filter "./apps/*" --filter "./packages/*" run --if-present dev

build: ## Build every workspace, the agent and the plugin
	pnpm -r run --if-present build
	@if [ -f agent/go.mod ]; then cd agent && go build ./...; else echo "skip agent, no go.mod"; fi
	@if ls plugin/*.sln plugin/*.csproj plugin/*/*.csproj >/dev/null 2>&1; then cd plugin && dotnet build -c Release; else echo "skip plugin, no project"; fi

test: ## Run tests in every workspace, the agent and the plugin
	pnpm -r run --if-present test
	@if [ -f agent/go.mod ]; then cd agent && go test ./...; else echo "skip agent, no go.mod"; fi
	@if ls plugin/*.sln plugin/*.csproj plugin/*/*.csproj >/dev/null 2>&1; then cd plugin && dotnet test; else echo "skip plugin, no project"; fi

smoke: ## Curl api /health, web / and every agent /health
	./infra/scripts/smoke.sh

config: ## Validate the compose files
	$(COMPOSE) config -q
	STEAM_API_KEY=$${STEAM_API_KEY:-check} COOKIE_DOMAIN=$${COOKIE_DOMAIN:-.check} $(COMPOSE_PROD) config -q

docker-build: ## Build the api and web images
	$(COMPOSE) build api web

up: infra-up ## Run the full stack in Docker
	$(COMPOSE) up -d --build --wait api web

down: ## Stop the full stack
	$(COMPOSE) down

logs: ## Tail api and web logs
	$(COMPOSE) logs -f api web

prod-up: ## Build and start the production stack with Caddy
	$(COMPOSE_PROD) up -d --build --wait postgres redis api web caddy

prod-down: ## Stop the production stack
	$(COMPOSE_PROD) down

backup: ## Dump the database now
	./infra/scripts/db-backup.sh
