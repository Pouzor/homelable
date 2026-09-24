#!/usr/bin/env bash
set -euo pipefail

REPO="Pouzor/homelable"
INSTALL_DIR="${HOMELABLE_DIR:-homelable}"
RAW="https://raw.githubusercontent.com/${REPO}/main"
STANDALONE=0

for arg in "$@"; do
  case $arg in
    --standalone) STANDALONE=1 ;;
  esac
done

# Detect install vs update
if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "Updating Homelable in ./${INSTALL_DIR}/"
  IS_UPDATE=1
else
  if [ "${STANDALONE}" -eq 1 ]; then
    echo "Installing Homelable (standalone mode) into ./${INSTALL_DIR}/"
  else
    echo "Installing Homelable into ./${INSTALL_DIR}/"
  fi
  IS_UPDATE=0
fi

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

if [ "${STANDALONE}" -eq 1 ]; then
  curl -fsSL "${RAW}/docker-compose.standalone.yml" -o docker-compose.yml
else
  curl -fsSL "${RAW}/docker-compose.prebuilt.yml" -o docker-compose.yml
  curl -fsSL "${RAW}/.env.example" -o .env.example
fi

if [ "${IS_UPDATE}" -eq 1 ]; then
  echo ""
  echo "  docker-compose.yml updated."
  echo "  Restart with:"
  echo "    cd ${INSTALL_DIR} && docker compose pull && docker compose up -d"
else
  if [ "${STANDALONE}" -eq 1 ]; then
    echo ""
    echo "  Standalone mode: no backend, no login, canvas saves to browser localStorage."
    echo ""
    echo "  Run:"
    echo "    cd ${INSTALL_DIR} && docker compose up -d"
  else
    if [ ! -f .env ]; then
      cp .env.example .env
      admin_password="${ADMIN_PASSWORD:-}"
      if [ -z "$admin_password" ]; then
        if [ -t 0 ]; then
          read -rsp "Initial admin password: " admin_password
          echo
        else
          echo "Set ADMIN_PASSWORD when running the installer without a terminal." >&2
          exit 1
        fi
      fi
      if [ -z "$admin_password" ]; then
        echo "The initial admin password cannot be empty." >&2
        exit 1
      fi

      secret_key="$(openssl rand -hex 32)"
      mcp_api_key="mcp_sk_$(openssl rand -hex 24)"
      mcp_service_key="svc_$(openssl rand -hex 24)"
      sed -i.bak \
        -e "s|^SECRET_KEY=.*|SECRET_KEY=${secret_key}|" \
        -e "s|^MCP_API_KEY=.*|MCP_API_KEY=${mcp_api_key}|" \
        -e "s|^MCP_SERVICE_KEY=.*|MCP_SERVICE_KEY=${mcp_service_key}|" \
        .env
      rm -f .env.bak

      password_hash="$(ADMIN_PASSWORD="$admin_password" docker compose run --rm --no-deps -T \
        -e ADMIN_PASSWORD backend python -c \
        'import os, bcrypt; print(bcrypt.hashpw(os.environ["ADMIN_PASSWORD"].encode(), bcrypt.gensalt()).decode())')"
      sed -i.bak \
        -e "s|^AUTH_PASSWORD_HASH=.*|AUTH_PASSWORD_HASH='${password_hash}'|" \
        .env
      rm -f .env.bak
    fi
    echo ""
    echo "  Initial admin credentials were generated in .env."
    echo "  Change them later by updating AUTH_PASSWORD_HASH and restarting the backend."
    echo ""
    echo "  Run:"
    echo "    cd ${INSTALL_DIR} && docker compose up -d"
  fi
  echo ""
  echo "  Open http://localhost:3000"
fi
