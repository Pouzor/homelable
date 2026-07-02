#!/bin/bash
# Install / enable the Homelable MCP server as a systemd service.
#
# Run interactively as root, inside an LXC or any Debian/Ubuntu host.
# Typical Proxmox VE flow: create the LXC via the community-scripts/ProxmoxVE
# helper, then run this script inside that LXC.
#
# Idempotent: re-running is safe. If mcp/.env already exists, the script
# keeps it untouched and only refreshes the venv + systemd unit.
#
# Optional env vars (override defaults / skip the matching prompt):
#   INSTALL_DIR     repo root (default: /opt/homelable)
#   REPO_URL        clone URL if $INSTALL_DIR is empty (default: https://github.com/Pouzor/homelable.git)
#   REPO_REF        branch/tag/commit when cloning (default: main)
#   SERVICE_USER    systemd User= (default: homelable)
#   MCP_PORT        listen port (default: 8001)
#   MCP_API_KEY     client → MCP key (default: prompt, auto-gen on empty)
#   MCP_SERVICE_KEY MCP → backend key (default: prompt, auto-gen on empty; must match backend .env)
#   BACKEND_URL     backend base URL (default: http://127.0.0.1:8000)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/homelable}"
REPO_URL="${REPO_URL:-https://github.com/Pouzor/homelable.git}"
REPO_REF="${REPO_REF:-main}"
SERVICE_USER="${SERVICE_USER:-homelable}"
SERVICE_NAME="homelable-mcp"
MCP_PORT="${MCP_PORT:-8001}"
DEFAULT_BACKEND_URL="http://127.0.0.1:8000"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root (sudo bash $0)."

log "Installing OS dependencies (git, python3-venv, curl)"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  git python3 python3-venv python3-pip curl iproute2 >/dev/null

MCP_DIR="$INSTALL_DIR/mcp"
if [[ ! -d "$MCP_DIR" ]]; then
  log "Cloning $REPO_URL ($REPO_REF) → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
fi
[[ -f "$MCP_DIR/requirements.txt" ]] || fail "Missing $MCP_DIR/requirements.txt — repo layout unexpected."

if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${MCP_PORT}$"; then
  warn "Port $MCP_PORT already in use. If it's a previous $SERVICE_NAME instance this is fine; otherwise abort and free the port."
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating service user '$SERVICE_USER'"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

ENV_FILE="$MCP_DIR/.env"
gen_key() { python3 -c "import secrets;print('$1' + secrets.token_hex(24))"; }

if [[ -f "$ENV_FILE" ]]; then
  log ".env already present at $ENV_FILE — keeping existing values"
else
  [[ -f "$MCP_DIR/.env.example" ]] || fail "Missing $MCP_DIR/.env.example"
  log "No .env found — generating one (press Enter to accept defaults)"

  api_key="${MCP_API_KEY:-}"
  svc_key="${MCP_SERVICE_KEY:-}"
  backend_url="${BACKEND_URL:-}"

  if [[ -z "$api_key" ]]; then
    default_api_key="$(gen_key mcp_sk_)"
    read -rp "MCP_API_KEY (client → MCP) [default: auto-generate]: " api_key
    api_key="${api_key:-$default_api_key}"
  fi
  if [[ -z "$svc_key" ]]; then
    default_svc_key="$(gen_key svc_)"
    read -rp "MCP_SERVICE_KEY (MCP → backend, must match backend .env) [default: auto-generate]: " svc_key
    svc_key="${svc_key:-$default_svc_key}"
  fi
  if [[ -z "$backend_url" ]]; then
    read -rp "BACKEND_URL [$DEFAULT_BACKEND_URL]: " backend_url
    backend_url="${backend_url:-$DEFAULT_BACKEND_URL}"
  fi

  umask 077
  cat >"$ENV_FILE" <<EOF
MCP_API_KEY=$api_key
MCP_SERVICE_KEY=$svc_key
BACKEND_URL=$backend_url
EOF
  log "Wrote $ENV_FILE (mode 600)"
  warn "If the backend runs elsewhere, set the SAME MCP_SERVICE_KEY in its .env."
fi

VENV="$MCP_DIR/.venv"
if [[ ! -d "$VENV" ]]; then
  log "Creating venv at $VENV"
  python3 -m venv "$VENV"
fi
log "Installing Python deps"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$MCP_DIR/requirements.txt"

chown -R "$SERVICE_USER":"$SERVICE_USER" "$MCP_DIR"
chmod 600 "$ENV_FILE"

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
log "Writing $UNIT"
cat >"$UNIT" <<EOF
[Unit]
Description=Homelable MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$MCP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/uvicorn app.main:app --host 0.0.0.0 --port $MCP_PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

log "Waiting for MCP to come up on :$MCP_PORT"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  warn "MCP did not respond on /health within 10s. Check: journalctl -u $SERVICE_NAME -n 50"
else
  log "MCP server is up."
fi

LXC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
API_KEY_VALUE="$(grep -E '^MCP_API_KEY=' "$ENV_FILE" | cut -d= -f2-)"

cat <<EOF

----------------------------------------------------------------
MCP server installed.

  Service:     $SERVICE_NAME  (systemctl status $SERVICE_NAME)
  Listen:      http://${LXC_IP:-<lxc-ip>}:${MCP_PORT}/mcp
  Env file:    $ENV_FILE
  Logs:        journalctl -u $SERVICE_NAME -f

Claude Code client setup:
  claude mcp add --transport sse homelable http://${LXC_IP:-<lxc-ip>}:${MCP_PORT}/mcp \\
    --header "X-API-Key: $API_KEY_VALUE"
----------------------------------------------------------------
EOF
