#!/usr/bin/env bash
set -euo pipefail

REPO="Pouzor/homelable"
INSTALL_DIR="${HOMELABLE_DIR:-homelable}"
RAW="https://raw.githubusercontent.com/${REPO}/main"

# Detect install vs update
if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "Updating Homelable in ./${INSTALL_DIR}/"
  IS_UPDATE=1
else
  echo "Installing Homelable into ./${INSTALL_DIR}/"
  IS_UPDATE=0
fi

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

# Always update docker-compose.yml and refresh .env.example
curl -fsSL "${RAW}/docker-compose.prebuilt.yml" -o docker-compose.yml
curl -fsSL "${RAW}/.env.example" -o .env.example

if [ "${IS_UPDATE}" -eq 1 ]; then
  echo ""
  echo "  docker-compose.yml updated."
  echo "  Check .env.example for any new variables, then restart:"
  echo "    cd ${INSTALL_DIR} && docker compose pull && docker compose up -d"
else
  if [ ! -f .env ]; then
    cp .env.example .env
  fi
  echo ""
  echo "  Edit .env if needed (default login: admin / admin):"
  echo "    - Set SECRET_KEY to a random string"
  echo "    - Change AUTH_PASSWORD_HASH before exposing on a network"
  echo ""
  echo "  Then run:"
  echo "    cd ${INSTALL_DIR} && docker compose up -d"
  echo ""
  echo "  Open http://localhost:3000"
fi
