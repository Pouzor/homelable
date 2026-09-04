#!/bin/bash
# Install Homelable (backend + frontend) natively on a Debian/Ubuntu host — no Docker.
#
# Run interactively as root on any Debian 12+/Ubuntu 22.04+ host, VM or LXC.
# Installs:
#   - a Python venv + systemd unit for the FastAPI backend on 127.0.0.1:8000
#   - the built Vite frontend, served by nginx on $HTTP_PORT with /api and /ws
#     proxied to the backend
#
# Idempotent: re-running is safe. An existing backend/.env is kept untouched;
# only the venv, the frontend build, the systemd unit and the nginx site are
# refreshed. Use it to upgrade: pull (or re-clone) then re-run.
#
# Optional env vars (override defaults / skip the matching prompt):
#   INSTALL_DIR     repo root (default: /opt/homelable)
#   REPO_URL        clone URL if $INSTALL_DIR is empty (default: https://github.com/Pouzor/homelable.git)
#   REPO_REF        branch/tag/commit when cloning (default: main)
#   SERVICE_USER    systemd User= (default: homelable)
#   BACKEND_PORT    uvicorn listen port, loopback only (default: 8000)
#   HTTP_PORT       nginx listen port (default: 3000)
#   SERVER_NAME     nginx server_name (default: _)
#   BASE_PATH       serve under a subpath instead of the root of the origin,
#                   e.g. BASE_PATH=/homelab/ (default: /). Baked into the
#                   frontend build and into the generated nginx site.
#   ADMIN_PASSWORD  initial admin password (default: prompt, "admin" on empty)
#   SCANNER_RANGES  JSON array of CIDRs to scan (default: prompt, guessed from
#                   the primary interface)
#
# The two prompts are skipped when stdin is not a TTY (`curl … | sudo bash`);
# set the matching variables to control them there, or take the defaults.
#   SKIP_NGINX=1    do not install or touch nginx (bring your own reverse proxy)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/homelable}"
REPO_URL="${REPO_URL:-https://github.com/Pouzor/homelable.git}"
REPO_REF="${REPO_REF:-main}"
SERVICE_USER="${SERVICE_USER:-homelable}"
SERVICE_NAME="homelable"
BACKEND_PORT="${BACKEND_PORT:-8000}"
HTTP_PORT="${HTTP_PORT:-3000}"
SERVER_NAME="${SERVER_NAME:-_}"
SKIP_NGINX="${SKIP_NGINX:-0}"
# Normalized to a leading + trailing slash ('/' when unset), mirroring
# normalizeBasePath() in frontend/src/utils/basePath.ts.
BASE_PATH="$(printf '%s' "${BASE_PATH:-/}" | sed -e 's#^/*#/#' -e 's#/*$#/#' -e 's#//*#/#g')"
[[ -n "$BASE_PATH" ]] || BASE_PATH="/"
BASE_PATH_NO_SLASH="${BASE_PATH%/}"
NODE_MAJOR=20

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root (sudo bash $0)."
command -v apt-get >/dev/null || fail "This script targets Debian/Ubuntu (apt-get not found)."

log "Installing OS dependencies"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  git curl ca-certificates gnupg python3 python3-venv python3-pip \
  build-essential nmap iputils-ping iproute2 openssl >/dev/null

if [[ "$SKIP_NGINX" != "1" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx >/dev/null
fi

# Node 20+ — Debian 12 ships 18, too old for Vite 7 / React 19.
# `|| true`: with no node installed the substitution exits 127, and under
# `set -euo pipefail` that aborts the script before we get to install it.
node_major="$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || true)"
node_major="${node_major//[^0-9]/}"   # `-lt` errors on anything non-numeric
node_major="${node_major:-0}"
if [[ "$node_major" -lt "$NODE_MAJOR" ]]; then
  found="$node_major"
  if [[ "$found" == "0" ]]; then found="none"; fi
  log "Installing Node.js $NODE_MAJOR (found: $found)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi

BACKEND_DIR="$INSTALL_DIR/backend"
FRONTEND_DIR="$INSTALL_DIR/frontend"

if [[ ! -d "$BACKEND_DIR" ]]; then
  log "Cloning $REPO_URL ($REPO_REF) → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
fi
[[ -f "$BACKEND_DIR/requirements.txt" ]] || fail "Missing $BACKEND_DIR/requirements.txt — repo layout unexpected."
[[ -f "$FRONTEND_DIR/package.json" ]]    || fail "Missing $FRONTEND_DIR/package.json — repo layout unexpected."

for port in "$BACKEND_PORT" "$HTTP_PORT"; do
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; then
    warn "Port $port already in use. Fine if it's a previous Homelable instance; otherwise abort and free it."
  fi
done

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating service user '$SERVICE_USER'"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

DATA_DIR="$INSTALL_DIR/data"
mkdir -p "$DATA_DIR"

VENV="$BACKEND_DIR/.venv"
if [[ ! -d "$VENV" ]]; then
  log "Creating venv at $VENV"
  python3 -m venv "$VENV"
fi
log "Installing Python deps (this takes a few minutes)"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

ENV_FILE="$BACKEND_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  log ".env already present at $ENV_FILE — keeping existing values"
else
  [[ -f "$INSTALL_DIR/.env.example" ]] || fail "Missing $INSTALL_DIR/.env.example"
  log "No .env found — generating one (press Enter to accept defaults)"

  admin_password="${ADMIN_PASSWORD:-}"
  if [[ -z "$admin_password" ]]; then
    if [[ -t 0 ]]; then
      read -rsp "Initial admin password [default: admin]: " admin_password; echo
    else
      warn "No TTY (piped install) and ADMIN_PASSWORD unset — defaulting to 'admin'."
    fi
    admin_password="${admin_password:-admin}"
  fi

  scanner_ranges="${SCANNER_RANGES:-}"
  if [[ -z "$scanner_ranges" ]]; then
    guess="$(ip -o -f inet addr show scope global 2>/dev/null \
      | awk '{print $4}' | head -n1 \
      | awk -F/ '{split($1,o,"."); print o[1]"."o[2]"."o[3]".0/"$2}' || true)"
    guess="${guess:-192.168.1.0/24}"
    if [[ -t 0 ]]; then
      read -rp "CIDR range to scan [$guess]: " scanner_ranges
    else
      warn "No TTY (piped install) and SCANNER_RANGES unset — defaulting to $guess."
    fi
    scanner_ranges="[\"${scanner_ranges:-$guess}\"]"
  fi

  secret_key="$(openssl rand -hex 32)"
  # Passed through the environment, not argv — argv is world-readable in ps.
  password_hash="$(HL_PW="$admin_password" "$VENV/bin/python" -c \
    'import os, bcrypt; print(bcrypt.hashpw(os.environ["HL_PW"].encode(), bcrypt.gensalt()).decode())')"

  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  origins="[\"http://localhost:${HTTP_PORT}\""
  if [[ -n "$host_ip" ]]; then
    origins="${origins},\"http://${host_ip}:${HTTP_PORT}\""
  fi
  origins="${origins}]"

  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by scripts/install-baremetal.sh
# JSON values are single-quoted: systemd's EnvironmentFile parser strips
# bare double quotes, which would break the JSON before pydantic sees it.
SECRET_KEY=$secret_key
SQLITE_PATH=$DATA_DIR/homelab.db

# Set this to the URL(s) you use to reach Homelable in your browser.
# Behind a TLS reverse proxy, replace these with https://homelable.example.
CORS_ORIGINS='$origins'

AUTH_MODE=local
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH='$password_hash'

SCANNER_RANGES='$scanner_ranges'
SCANNER_HTTP_RANGES='[]'
SCANNER_HTTP_PROBE_ENABLED=false
SCANNER_HTTP_VERIFY_TLS=false
STATUS_CHECKER_INTERVAL=60
EOF
  umask 022
  log "Wrote $ENV_FILE (mode 600)"
  warn "Every other setting (OIDC, MCP, Proxmox, Zigbee, Z-Wave, live view) is documented in .env.example."
fi

log "Building the frontend"
if [[ -f "$FRONTEND_DIR/package-lock.json" ]]; then
  ( cd "$FRONTEND_DIR" && npm ci --silent )
else
  ( cd "$FRONTEND_DIR" && npm install --silent )
fi
( cd "$FRONTEND_DIR" && VITE_BASE_PATH="$BASE_PATH" npm run build )
[[ -d "$FRONTEND_DIR/dist" ]] || fail "Frontend build produced no $FRONTEND_DIR/dist."

chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$ENV_FILE"
# nginx (www-data) needs to traverse the tree down to dist/.
chmod o+x "$INSTALL_DIR" "$FRONTEND_DIR"

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
log "Writing $UNIT"
cat >"$UNIT" <<EOF
[Unit]
Description=Homelable backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$BACKEND_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/uvicorn app.main:app --host 127.0.0.1 --port $BACKEND_PORT
Restart=on-failure
RestartSec=5

# The scanner shells out to nmap. Without raw sockets nmap silently falls back
# to a TCP connect scan: hosts and open ports are still found, but OS detection
# (-O) and SYN scan (-sS) do not work. Uncomment to grant them.
#AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
#CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

if [[ "$SKIP_NGINX" != "1" ]]; then
  SITE="/etc/nginx/sites-available/homelable"
  log "Writing $SITE"
  if [[ "$BASE_PATH" == "/" ]]; then
    cat >"$SITE" <<EOF
server {
    listen $HTTP_PORT;
    server_name $SERVER_NAME;
    root $FRONTEND_DIR/dist;
    index index.html;

    client_max_body_size 20M;

    # WebSocket (must come before /api/ to take priority)
    location /api/v1/status/ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Legacy /ws/ path
    location /ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  else
    # Under a prefix the SPA is served from a webroot where the build hangs off
    # $BASE_PATH, so nginx keeps plain `root` semantics — `alias` plus `try_files`
    # mis-resolves \$uri. The symlink is refreshed on every run.
    WEBROOT="/var/www/homelable"
    mkdir -p "$(dirname "${WEBROOT}${BASE_PATH_NO_SLASH}")"
    ln -sfn "$FRONTEND_DIR/dist" "${WEBROOT}${BASE_PATH_NO_SLASH}"
    chmod -R o+rX "$WEBROOT"
    cat >"$SITE" <<EOF
server {
    listen $HTTP_PORT;
    server_name $SERVER_NAME;
    root $WEBROOT;
    index index.html;

    # Relative Location headers — the port and scheme belong to whatever proxy is
    # in front, not to this server block.
    absolute_redirect off;

    client_max_body_size 20M;

    # --- served under $BASE_PATH ---------------------------------------------
    location = $BASE_PATH_NO_SLASH {
        return 301 $BASE_PATH;
    }

    # WebSocket (must come before the API block to take priority)
    location ${BASE_PATH}api/v1/status/ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/api/v1/status/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location ${BASE_PATH}api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Legacy /ws/ path
    location ${BASE_PATH}ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    # SPA fallback under the prefix
    location $BASE_PATH {
        try_files \$uri \$uri/ ${BASE_PATH}index.html;
    }

    # --- prefix already stripped by a front proxy ----------------------------
    # No redirect to $BASE_PATH here: the front proxy would strip it again and loop.
    location /api/v1/status/ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    location / {
        root $FRONTEND_DIR/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  fi
  ln -sf "$SITE" /etc/nginx/sites-enabled/homelable
  if [[ "$HTTP_PORT" == "80" ]]; then rm -f /etc/nginx/sites-enabled/default; fi
  nginx -t
  systemctl reload nginx || systemctl restart nginx
fi

log "Waiting for the backend on :$BACKEND_PORT"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  warn "Backend did not answer /api/v1/health within 15s. Check: journalctl -u $SERVICE_NAME -n 50"
else
  log "Backend is up."
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

cat <<EOF

----------------------------------------------------------------
Homelable installed.

  Service:     $SERVICE_NAME  (systemctl status $SERVICE_NAME)
  Backend:     http://127.0.0.1:$BACKEND_PORT  (loopback only)
  Env file:    $ENV_FILE
  Data:        $DATA_DIR  (SQLite DB + uploads)
  Logs:        journalctl -u $SERVICE_NAME -f
EOF
if [[ "$SKIP_NGINX" != "1" ]]; then
  cat <<EOF
  Web UI:      http://${HOST_IP:-<host-ip>}:${HTTP_PORT}${BASE_PATH}
  nginx site:  /etc/nginx/sites-available/homelable
EOF
  if [[ "$BASE_PATH" != "/" ]]; then
    cat <<EOF
  Base path:   $BASE_PATH  (webroot /var/www/homelable, symlinked to the build)
EOF
  fi
else
  cat <<EOF
  nginx:       skipped — proxy your own front end to 127.0.0.1:$BACKEND_PORT
               and serve $FRONTEND_DIR/dist. See INSTALLATION.md.
EOF
fi
cat <<EOF

Log in as 'admin' with the password you set. Change it later by regenerating
AUTH_PASSWORD_HASH in $ENV_FILE:

  $VENV/bin/python -c "import bcrypt; print(bcrypt.hashpw(b'newpassword', bcrypt.gensalt()).decode())"
  systemctl restart $SERVICE_NAME

Upgrade: git -C $INSTALL_DIR pull && bash $INSTALL_DIR/scripts/install-baremetal.sh
----------------------------------------------------------------
EOF
