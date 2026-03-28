#!/usr/bin/env bash
# Homelable — in-container installer
# Runs INSIDE a Debian/Ubuntu LXC container (called automatically by install-proxmox.sh)
# Can also be run manually inside any Debian/Ubuntu machine:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/lxc-install.sh)

set -euo pipefail

INSTALL_DIR=/opt/homelable
DATA_DIR=/opt/homelable/data
SERVICE_USER=homelable
REPO_URL="https://github.com/Pouzor/homelable.git"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[homelable]${NC} $*"; }
warn()  { echo -e "${YELLOW}[homelable]${NC} $*"; }
error() { echo -e "${RED}[homelable]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root (sudo bash ...)"

# ── Detect OS ─────────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
else
  error "Cannot detect OS"
fi
info "Detected: $PRETTY_NAME"
[[ "$ID" =~ ^(debian|ubuntu)$ ]] || error "Requires Debian or Ubuntu"

# ── System deps ───────────────────────────────────────────────────────────────
info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv nmap curl git nginx

# ── Node.js 20 ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# ── Service user ──────────────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --shell /sbin/nologin "$SERVICE_USER"
  info "Created service user: $SERVICE_USER"
fi

# ── Clone / update repo ───────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --quiet
else
  info "Cloning repository..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

mkdir -p "$DATA_DIR"

# ── Backend ───────────────────────────────────────────────────────────────────
info "Setting up Python backend..."
cd "$INSTALL_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install --quiet -r requirements.txt

# Generate .env if missing
if [[ ! -f .env ]]; then
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  # Default hash = bcrypt of "admin" (same as .env.example)
  cat > .env <<EOF
SECRET_KEY=$SECRET
SQLITE_PATH=$DATA_DIR/homelab.db
CORS_ORIGINS=["http://localhost","http://$(hostname -I | awk '{print $1}')"]

# Auth — default credentials: admin / admin
# Change AUTH_PASSWORD_HASH before exposing on a network.
# Generate: python3 -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('yourpassword'))"
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH='\$2b\$12\$RtMbyw17l4N5UGzeXMNAWuzCaVV.XFBY7ZetWheQhxcBDcxahapkG'

SCANNER_RANGES=["192.168.1.0/24"]
STATUS_CHECKER_INTERVAL=60
EOF
  warn "Created .env with default admin/admin — change AUTH_PASSWORD_HASH before exposing on a network!"
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR/backend/.venv"

# ── systemd: backend ──────────────────────────────────────────────────────────
cat > /etc/systemd/system/homelable-backend.service <<EOF
[Unit]
Description=Homelable Backend
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$INSTALL_DIR/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Frontend ──────────────────────────────────────────────────────────────────
info "Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci --silent
npm run build

# ── nginx ─────────────────────────────────────────────────────────────────────
info "Configuring nginx..."
# Use the project nginx config, adjusted for local backend
sed \
  -e 's|http://backend:8000|http://127.0.0.1:8000|g' \
  -e "s|/usr/share/nginx/html|$INSTALL_DIR/frontend/dist|g" \
  "$INSTALL_DIR/docker/nginx.conf" > /etc/nginx/sites-available/homelable

ln -sf /etc/nginx/sites-available/homelable /etc/nginx/sites-enabled/homelable
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx || systemctl start nginx

# ── Enable & start ────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now homelable-backend
systemctl enable --now nginx

info "Done!"
echo ""
echo -e "  ${GREEN}Homelable is running at http://$(hostname -I | awk '{print $1}')${NC}"
echo -e "  Default login: admin / admin"
echo -e "  ${YELLOW}⚠ Change the password: edit $INSTALL_DIR/backend/.env (AUTH_PASSWORD_HASH)${NC}"
echo ""
