#!/usr/bin/env bash
# Homelable — update to latest version
# Run inside the LXC / any Linux host where lxc-install.sh was used:
#   bash /opt/homelable/scripts/update.sh
# Or pull-and-run directly:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/update.sh)

set -euo pipefail

INSTALL_DIR=/opt/homelable

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[homelable]${NC} $*"; }
warn()  { echo -e "${YELLOW}[homelable]${NC} $*"; }
error() { echo -e "${RED}[homelable]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root (sudo bash ...)"
[[ -d "$INSTALL_DIR/.git" ]] || error "Homelable not found at $INSTALL_DIR — run lxc-install.sh first"

# ── Pull latest code ──────────────────────────────────────────────────────────
info "Pulling latest code..."
BEFORE=$(git -C "$INSTALL_DIR" rev-parse HEAD)
git -C "$INSTALL_DIR" pull --quiet
AFTER=$(git -C "$INSTALL_DIR" rev-parse HEAD)

if [[ "$BEFORE" == "$AFTER" ]]; then
  info "Already up to date."
  exit 0
fi

echo ""
info "Changes since last update:"
git -C "$INSTALL_DIR" log --oneline "${BEFORE}..${AFTER}"
echo ""

# ── Stop backend ─────────────────────────────────────────────────────────────
info "Stopping backend service..."
systemctl stop homelable-backend

# ── Backend deps ─────────────────────────────────────────────────────────────
info "Updating Python dependencies..."
cd "$INSTALL_DIR/backend"
.venv/bin/pip install --quiet -r requirements.txt

# ── Frontend build ────────────────────────────────────────────────────────────
info "Rebuilding frontend..."
cd "$INSTALL_DIR/frontend"
npm ci --silent
npm run build

# ── nginx config ─────────────────────────────────────────────────────────────
info "Updating nginx config..."
sed \
  -e 's|http://backend:8000|http://127.0.0.1:8000|g' \
  -e "s|/usr/share/nginx/html|$INSTALL_DIR/frontend/dist|g" \
  "$INSTALL_DIR/docker/nginx.conf" > /etc/nginx/sites-available/homelable
nginx -t && systemctl reload nginx

# ── Restart backend ───────────────────────────────────────────────────────────
info "Starting backend service..."
systemctl start homelable-backend

echo ""
echo -e "  ${GREEN}Homelable updated successfully!${NC}"
echo -e "  Running at http://$(hostname -I | awk '{print $1}')"
echo ""
