# Homelable

Homelable is a self-hosted infrastructure visualization solution. It provides a network scanning feature to accelerate the identification of machines and services deployed on your local infrastructure.

Homelable also offers a healthcheck system (WIP) through multiple methods (ping/TCP, /health API, etc.) to get a global overview of online/offline services.

You can also select some pre-built design styles, or personalize each device in your diagram.

If you just like the design, you can only run the frontend and export your design as PNG.


---

## Screenshots

<p align="center">
  <img src="docs/homelable1.png" alt="Homelable canvas overview" width="100%" />
  <img src="docs/homelable2.png" alt="Homelable node detail" width="100%" />
  <img src="docs/homelable3.png" alt="Homelable sidebar and scan" width="100%" />
</p>

---

## Quick Start — Docker

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash
cd homelable && docker compose up -d
```

Open **http://localhost:3000** — login with `admin` / `admin`.

> Change the password before exposing to a network: edit `.env` and update `AUTH_USERNAME` / `AUTH_PASSWORD_HASH`.
>
> Generate a new hash: `docker compose exec backend python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('yourpassword'))"`
>
> ⚠️ Keep the single quotes around the hash value in `.env` — bcrypt hashes contain `$` characters that Docker Compose would otherwise misinterpret.

## Quick Start - Front only

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash -s -- --standalone
cd homelable && docker compose up -d
```

### Update

Re-run the install script — it detects an existing install and only updates `docker-compose.yml`:

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash
cd homelable && docker compose pull && docker compose up -d
```

### Build from source

```bash
git clone https://github.com/Pouzor/homelable.git
cd homelable
cp .env.example .env
docker compose up -d
```

---

## Proxmox LXC Install

Run this **on the Proxmox host** — it creates a Debian 12 LXC container and installs Homelable inside automatically:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/install-proxmox.sh)
```

Default container settings: 2 cores, 1 GB RAM, 8 GB disk, DHCP on `vmbr0`. Override before running:

```bash
CTID=150 RAM=2048 STORAGE=local-zfs bash <(curl -fsSL .../install-proxmox.sh)
```

The backend runs as a systemd service, the frontend is served via nginx on port 80.

> To install manually inside an existing Debian/Ubuntu machine or LXC:
> ```bash
> bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/lxc-install.sh)
> ```

---

## Configuration

All configuration is done via `.env` (copied from `.env.example`):

```env
SECRET_KEY=change_me_in_production

# Auth — default: admin / admin
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH='$2b$12$...'   # bcrypt hash — keep single quotes

# CIDR ranges to scan
SCANNER_RANGES=["192.168.1.0/24"]

# How often to check node status (seconds)
STATUS_CHECKER_INTERVAL=60
```

All settings are also editable in-app via the **Scan Network** button.

---

## Network Scanner

The scanner runs `nmap -sV --open` on your configured CIDR ranges and populates a **Pending Devices** queue. From the sidebar you can then approve (adds a node to the canvas), hide, or ignore each discovered device.

### Triggering a scan

Click **Scan Network** in the sidebar. The Scan History tab opens automatically and refreshes every 3 seconds until the scan completes. Errors are shown inline and as a toast notification.

### macOS / root privileges

Some nmap scan types (SYN scan, OS detection) require root. If the scan fails with a permissions error, run it manually with sudo using the included script:

```bash
cd backend
sudo python ../scripts/run_scan.py 192.168.1.0/24

# Multiple ranges:
sudo python ../scripts/run_scan.py 192.168.1.0/24 10.0.0.0/24
```

Results are written directly to the database and appear as Pending Devices in the UI without restarting the backend.

> On Linux the backend process itself can be given the `NET_RAW` capability instead of running as root:
> ```bash
> sudo setcap cap_net_raw+ep $(which nmap)
> ```

---

## Proxmox Nested Nodes

Proxmox nodes render as a resizable group container. VM and LXC nodes can be placed inside:

1. Add a **Proxmox VE** node to the canvas
2. Add a **VM** or **LXC** node — select the Proxmox node in the **Parent Proxmox** dropdown
3. The child node appears inside the group and moves with it
4. Select the Proxmox node to reveal resize handles (drag corners to expand)

---

## Node Check Methods

| Method | Description |
|--------|-------------|
| `ping` | ICMP ping |
| `http` | GET request, success if status < 500 |
| `https` | GET with TLS verify |
| `tcp` | TCP connect (target: `host:port`) |
| `ssh` | TCP connect to port 22 |
| `prometheus` | GET `/metrics` |
| `health` | GET `/health` |

---

## Development Mode

**Backend (Python 3.13):**
```bash
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env       # edit SECRET_KEY and review defaults
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```


---
