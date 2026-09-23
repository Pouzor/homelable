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
    fi
    echo ""
    echo "  Edit .env if needed (default login: admin / admin):"
    echo "    - Set SECRET_KEY to a random string"
    echo "    - Change AUTH_PASSWORD_HASH before exposing on a network"
    echo ""
    echo "  Run:"
    echo "    cd ${INSTALL_DIR} && docker compose up -d"
  fi
  echo ""
  echo "  Open http://localhost:3000"
fi
