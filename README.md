# Homelable

Homelable is a self-hosted infrastructure visualization solution. It provides a network scanning feature to accelerate the identification of machines and services deployed on your local infrastructure.

Homelable also offers a healthcheck system (WIP) through multiple methods (ping/TCP, /health API, etc.) to get a global overview of online/offline services.


---

## Quick Start — Docker

```bash
git clone https://github.com/Pouzor/homelable.git
cd homelable
cp .env.example .env
docker compose up -d
```

Open **http://localhost:3000** — login with `admin` / `admin`.

> Change the password before exposing to a network: edit `backend/config.yml` and replace `password_hash` with a new bcrypt hash.
>
> Generate a hash: `docker compose exec backend python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('yourpassword'))"`

---

## Proxmox LXC Install

Run inside a Debian/Ubuntu LXC container:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/lxc-install.sh)
```

This installs the backend as a systemd service and serves the frontend via nginx.

---

## Configuration

`backend/config.yml`:

```yaml
auth:
  username: admin
  password_hash: "$2b$12$..."   # bcrypt hash

scanner:
  ranges:
    - "192.168.1.0/24"          # CIDR ranges to scan

status_checker:
  interval_seconds: 60          # how often to check node status
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

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, TypeScript, Vite, React Flow v12, Zustand, Tailwind CSS, Shadcn/ui |
| Backend | FastAPI, SQLAlchemy async, SQLite, APScheduler, python-nmap |
| Auth | JWT (python-jose), bcrypt (passlib) |
| Deployment | Docker Compose, nginx, systemd |

---


## Development Mode

**Backend (Python 3.13):**
```bash
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # edit SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Default login: `admin` / `admin`

---
