# ============================================================
#  homelable — operational Makefile
# ============================================================

COMPOSE     := docker compose -f docker-compose.yml
SCRIPTS     := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))scripts

# ANSI colours
RESET  := \033[0m
BOLD   := \033[1m
RED    := \033[31m
GREEN  := \033[32m
YELLOW := \033[33m
BLUE   := \033[34m
CYAN   := \033[36m
WHITE  := \033[97m
DIM    := \033[2m

.DEFAULT_GOAL := help

.PHONY: help up up-detached down restart pull deploy \
        logs logs-backend logs-frontend logs-mcp \
        ps shell-backend shell-mcp \
        db-stats db-query sync-xcpng clean

# ── help ─────────────────────────────────────────────────────
help:
	@printf "\n$(BOLD)$(WHITE)  homelable ops$(RESET)  $(DIM)docker compose wrapper$(RESET)\n\n"
	@printf "$(BOLD)  DEPLOY$(RESET)\n"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "up"          "Start all containers (attached)"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "up-detached" "Start all containers (detached)"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "down"        "Stop and remove containers"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "restart"     "Restart all containers"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "pull"        "Pull latest images"
	@printf "  $(CYAN)%-20s$(RESET)%s\n" "deploy"      "Pull latest images then restart"
	@printf "\n$(BOLD)  LOGS$(RESET)\n"
	@printf "  $(YELLOW)%-20s$(RESET)%s\n" "logs"          "Tail all container logs"
	@printf "  $(YELLOW)%-20s$(RESET)%s\n" "logs-backend"  "Tail backend logs"
	@printf "  $(YELLOW)%-20s$(RESET)%s\n" "logs-frontend" "Tail frontend logs"
	@printf "  $(YELLOW)%-20s$(RESET)%s\n" "logs-mcp"      "Tail MCP server logs"
	@printf "\n$(BOLD)  INSPECT$(RESET)\n"
	@printf "  $(GREEN)%-20s$(RESET)%s\n" "ps"            "Show running container status"
	@printf "  $(GREEN)%-20s$(RESET)%s\n" "shell-backend" "Open shell in backend container"
	@printf "  $(GREEN)%-20s$(RESET)%s\n" "shell-mcp"     "Open shell in MCP container"
	@printf "  $(GREEN)%-20s$(RESET)%s\n" "db-stats"      "Device counts by source + status"
	@printf "  $(GREEN)%-20s$(RESET)%s\n" "db-query"      "Run SQL: make db-query SQL=\"SELECT ...\""
	@printf "\n$(BOLD)  MAINTENANCE$(RESET)\n"
	@printf "  $(RED)%-20s$(RESET)%s\n"   "sync-xcpng"    "Trigger immediate XCP-ng VM inventory sync"
	@printf "  $(RED)%-20s$(RESET)%s\n"   "clean"         "Stop + remove volumes (DESTRUCTIVE)"
	@printf "\n"

# ── deploy ───────────────────────────────────────────────────
up:
	@printf "$(BOLD)$(BLUE)══ Starting homelable ──────────────────────────────$(RESET)\n"
	@$(COMPOSE) up

up-detached:
	@printf "$(BOLD)$(BLUE)══ Starting homelable (detached) ───────────────────$(RESET)\n"
	@$(COMPOSE) up -d
	@printf "$(GREEN)  ✓ Services started$(RESET)\n"
	@$(COMPOSE) ps

down:
	@printf "$(BOLD)$(BLUE)══ Stopping homelable ──────────────────────────────$(RESET)\n"
	@$(COMPOSE) down
	@printf "$(GREEN)  ✓ Stopped$(RESET)\n"

restart:
	@printf "$(BOLD)$(BLUE)══ Restarting homelable ────────────────────────────$(RESET)\n"
	@$(COMPOSE) restart
	@printf "$(GREEN)  ✓ Restarted$(RESET)\n"

pull:
	@printf "$(BOLD)$(BLUE)══ Pulling latest images ───────────────────────────$(RESET)\n"
	@$(COMPOSE) pull
	@printf "$(GREEN)  ✓ Images up to date$(RESET)\n"

deploy: pull
	@printf "$(BOLD)$(BLUE)══ Deploying ────────────────────────────────────────$(RESET)\n"
	@$(COMPOSE) up -d --pull always
	@printf "$(GREEN)  ✓ Deployed$(RESET)\n"
	@$(COMPOSE) ps

# ── logs ─────────────────────────────────────────────────────
logs:
	@printf "$(BOLD)$(YELLOW)══ All logs ────────────────────────────────────────$(RESET)\n"
	@$(COMPOSE) logs -f

logs-backend:
	@printf "$(BOLD)$(YELLOW)══ Backend logs ────────────────────────────────────$(RESET)\n"
	@$(COMPOSE) logs -f backend

logs-frontend:
	@printf "$(BOLD)$(YELLOW)══ Frontend logs ───────────────────────────────────$(RESET)\n"
	@$(COMPOSE) logs -f frontend

logs-mcp:
	@printf "$(BOLD)$(YELLOW)══ MCP server logs ─────────────────────────────────$(RESET)\n"
	@$(COMPOSE) logs -f mcp

# ── inspect ──────────────────────────────────────────────────
ps:
	@$(COMPOSE) ps

shell-backend:
	@$(COMPOSE) exec backend /bin/bash

shell-mcp:
	@$(COMPOSE) exec mcp /bin/sh

db-stats:
	@printf "$(BOLD)$(CYAN)══ Device inventory stats ───────────────────────────$(RESET)\n"
	@$(COMPOSE) exec -T backend python3 -c \
	  "import sqlite3, os; db=sqlite3.connect(os.environ.get('SQLITE_PATH','/app/data/homelab.db')); \
	   rows=db.execute(\"SELECT discovery_source, status, COUNT(*) FROM device_inventory GROUP BY 1,2 ORDER BY 1,2\").fetchall(); \
	   [print(f'  {r[0]:20} {r[1]:10} {r[2]:5}') for r in rows]; db.close()"

db-query:
	@printf "$(BOLD)$(CYAN)══ DB query ─────────────────────────────────────────$(RESET)\n"
	@$(COMPOSE) exec -T backend python3 -c \
	  "import sqlite3, os; db=sqlite3.connect(os.environ.get('SQLITE_PATH','/app/data/homelab.db')); \
	   rows=db.execute('$(SQL)').fetchall(); [print(r) for r in rows]; db.close()"

# ── maintenance ───────────────────────────────────────────────
sync-xcpng:
	@printf "$(BOLD)$(CYAN)══ XCP-ng VM sync ──────────────────────────────────$(RESET)\n"
	@$(COMPOSE) exec -T backend python3 - < $(SCRIPTS)/sync_xcpng.py

clean:
	@printf "$(BOLD)$(RED)══ Clean ────────────────────────────────────────────$(RESET)\n"
	@printf "$(RED)$(BOLD)  WARNING: removes all volumes including the database!$(RESET)\n"
	@printf "$(RED)  Press Ctrl-C within 5 s to abort …$(RESET)\n"
	@sleep 5
	@$(COMPOSE) down -v
	@printf "$(GREEN)  ✓ Clean done$(RESET)\n"
