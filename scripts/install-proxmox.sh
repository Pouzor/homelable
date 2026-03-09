#!/usr/bin/env bash
# Homelable — Proxmox VE LXC creator
# Run this on the Proxmox HOST (not inside a container):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/install-proxmox.sh)

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[homelable]${NC} $*"; }
warn()  { echo -e "${YELLOW}[homelable]${NC} $*"; }
error() { echo -e "${RED}[homelable]${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $*${NC}"; }

# ── Must run on a Proxmox VE host ─────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root on the Proxmox host"
command -v pct &>/dev/null || error "pct not found — run this on a Proxmox VE host, not inside a container"

# ── Detect available storages for LXC rootfs ──────────────────────────────────
mapfile -t STORAGES < <(pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
[[ ${#STORAGES[@]} -eq 0 ]] && error "No active storage found that supports LXC rootfs (rootdir content type)"

if [[ ${#STORAGES[@]} -eq 1 ]]; then
  DEFAULT_STORAGE="${STORAGES[0]}"
else
  echo ""
  echo "Available storages:"
  for i in "${!STORAGES[@]}"; do
    echo "  $((i+1))) ${STORAGES[$i]}"
  done
  read -rp "Select storage [1]: " STORAGE_IDX
  STORAGE_IDX="${STORAGE_IDX:-1}"
  DEFAULT_STORAGE="${STORAGES[$((STORAGE_IDX-1))]}"
fi

# ── Settings (override via env vars) ──────────────────────────────────────────
CTID="${CTID:-$(pvesh get /cluster/nextid 2>/dev/null || echo 200)}"
CT_HOSTNAME="${CT_HOSTNAME:-homelable}"
STORAGE="${STORAGE:-$DEFAULT_STORAGE}"
DISK_SIZE="${DISK_SIZE:-8}"        # GB
RAM="${RAM:-1024}"                 # MB
CORES="${CORES:-2}"
BRIDGE="${BRIDGE:-vmbr0}"
RAW="https://raw.githubusercontent.com/Pouzor/homelable/main"

step "Creating Homelable LXC (CTID=$CTID, hostname=$CT_HOSTNAME, storage=$STORAGE)"

# ── Download Debian 12 template if needed ─────────────────────────────────────
TEMPLATE_STORAGE=$(pvesm status --content vztmpl | awk 'NR>1 {print $1; exit}')
TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep "debian-12" | tail -1 | awk '{print $1}')

if [[ -z "$TEMPLATE" ]]; then
  info "Downloading Debian 12 LXC template..."
  pveam update
  TEMPLATE_NAME=$(pveam available --section system | grep "debian-12" | tail -1 | awk '{print $2}')
  [[ -z "$TEMPLATE_NAME" ]] && error "Could not find a Debian 12 template"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
  TEMPLATE="$TEMPLATE_STORAGE:vztmpl/$TEMPLATE_NAME"
fi

info "Using template: $TEMPLATE"

# ── Create the container ───────────────────────────────────────────────────────
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --storage "$STORAGE" \
  --rootfs "${STORAGE}:${DISK_SIZE}" \
  --memory "$RAM" \
  --cores "$CORES" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --ostype debian \
  --unprivileged 1 \
  --features "nesting=1" \
  --start 1

info "Container $CTID created and started"

# ── Wait for network ───────────────────────────────────────────────────────────
info "Waiting for container network..."
for i in $(seq 1 20); do
  if pct exec "$CTID" -- ping -c1 -W1 8.8.8.8 &>/dev/null; then
    break
  fi
  [[ $i -eq 20 ]] && error "Container has no network after 20s — check bridge $BRIDGE"
  sleep 1
done

# ── Grant NET_RAW for nmap (ping-based checks) ─────────────────────────────────
# lxc.cap.keep must include net_raw for nmap SYN scan in unprivileged containers
pct set "$CTID" --mp0 "" 2>/dev/null || true
echo "lxc.cap.keep = net_raw net_bind_service" >> /etc/pve/lxc/${CTID}.conf 2>/dev/null || true

# ── Run the installer inside the container ────────────────────────────────────
step "Running Homelable installer inside container $CTID..."
pct exec "$CTID" -- bash -c "curl -fsSL ${RAW}/scripts/lxc-install.sh | bash"

# ── Done ──────────────────────────────────────────────────────────────────────
IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || echo "<container-ip>")
echo ""
echo -e "  ${GREEN}✓ Homelable installed in LXC $CTID${NC}"
echo -e "  ${GREEN}✓ Open http://${IP}${NC}"
echo -e "  Default login: ${YELLOW}admin / admin${NC}"
echo -e "  ${YELLOW}⚠ Change the password: edit /opt/homelable/backend/.env (AUTH_PASSWORD_HASH)${NC}"
echo ""
