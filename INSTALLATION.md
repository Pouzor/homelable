# Homelable — Installation

## Quick Start — Docker

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash
cd homelable && docker compose up -d
```

Open **http://localhost:3000** — login with `admin` / `admin`.

> Change the password before exposing to a network: edit `.env` and update `AUTH_USERNAME` / `AUTH_PASSWORD_HASH`.
>
Generate a new hash: 
```bash 
docker compose exec backend python -c 'import bcrypt; print(bcrypt.hashpw(b"yourpassword", bcrypt.gensalt()).decode())'
```


⚠️ **bcrypt hashes contain `$` characters** — how to handle them depends on where you set the value:
 - **`.env` file** (recommended): wrap the hash in single quotes → `AUTH_PASSWORD_HASH='$2b$12$...'`
 - **`docker-compose.yml` `environment:` block**: escape every `$` as `$$` — use this command to generate a pre-escaped hash:
   ```bash
   docker compose exec backend python -c 'import bcrypt; print(bcrypt.hashpw(b"yourpassword", bcrypt.gensalt()).decode().replace("$", "$$"))'
   ```

## Quick Start — Frontend only

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash -s -- --standalone
cd homelable && docker compose up -d
```

## Update (Docker)

Re-run the install script — it detects an existing install and only updates `docker-compose.yml`:

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/install.sh | bash
cd homelable && docker compose pull && docker compose up -d
```

## Pre-built Docker images

The quick starts above never build anything — `install.sh` writes `docker-compose.prebuilt.yml` (or `docker-compose.standalone.yml` with `--standalone`) as your `docker-compose.yml`, and both pull ready-made images. They are published to the GitHub Container Registry on every push to `main` and every `v*` tag, for `linux/amd64` and `linux/arm64`:

| Image | Contents |
|---|---|
| [`ghcr.io/pouzor/homelable-backend`](https://github.com/Pouzor/homelable/pkgs/container/homelable-backend) | FastAPI API, scanner, status checker |
| [`ghcr.io/pouzor/homelable-frontend`](https://github.com/Pouzor/homelable/pkgs/container/homelable-frontend) | React SPA behind nginx, proxying `/api` to the backend |
| [`ghcr.io/pouzor/homelable-frontend-standalone`](https://github.com/Pouzor/homelable/pkgs/container/homelable-frontend-standalone) | Same SPA built with `VITE_STANDALONE=true` — no backend, canvases in `localStorage` |
| [`ghcr.io/pouzor/homelable-mcp`](https://github.com/Pouzor/homelable/pkgs/container/homelable-mcp) | MCP server exposing the canvas to AI clients |

Tags: `latest` (tip of `main`), plus `X.Y.Z` and `X.Y` for releases.

To wire it up by hand instead of using `install.sh`:

```bash
curl -fsSLO https://raw.githubusercontent.com/Pouzor/homelable/main/docker-compose.prebuilt.yml
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/.env.example -o .env
docker compose -f docker-compose.prebuilt.yml up -d
```

Update the same way: `docker compose -f docker-compose.prebuilt.yml pull && … up -d`.

## Build from source

`docker-compose.yml` at the repo root builds the images locally instead of pulling them — use it for development, or to run a patched tree.

```bash
git clone https://github.com/Pouzor/homelable.git
cd homelable
cp .env.example .env
docker compose up -d
```

---

## Proxmox LXC Install

You can now install Homelable with community-scripts (proxmox-VE) : 

`https://community-scripts.org/scripts/homelable`


```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/homelable.sh)"
```

---

## Bare metal — no Docker

`scripts/install-baremetal.sh` installs Homelable natively on a Debian 12+ /
Ubuntu 22.04+ host (physical, VM or LXC): a Python venv and a `homelable`
systemd unit for the backend on `127.0.0.1:8000`, the built frontend served by
nginx on port 3000.

```bash
git clone https://github.com/Pouzor/homelable.git /opt/homelable
sudo bash /opt/homelable/scripts/install-baremetal.sh
```

The script can also clone for you — run it from anywhere and it fetches the repo
into `INSTALL_DIR` if that directory is empty:

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/install-baremetal.sh \
  | sudo bash
```

It prompts for the admin password and the CIDR range to scan, then writes
`backend/.env` with a generated `SECRET_KEY` and bcrypt hash. Open
**http://\<host-ip\>:3000**.

Re-running is safe and is how you upgrade — an existing `backend/.env` is kept
untouched, everything else is rebuilt:

```bash
cd /opt/homelable && git pull
sudo bash scripts/install-baremetal.sh
```

### Options

Every setting is an environment variable, so a non-interactive install is one line:

```bash
sudo HTTP_PORT=8080 ADMIN_PASSWORD=hunter2 SCANNER_RANGES='["10.0.0.0/24"]' \
  bash scripts/install-baremetal.sh
```

| Variable | Default | What |
|---|---|---|
| `INSTALL_DIR` | `/opt/homelable` | Repo root |
| `REPO_URL` / `REPO_REF` | upstream / `main` | Used only when `INSTALL_DIR` is empty |
| `SERVICE_USER` | `homelable` | systemd `User=` |
| `BACKEND_PORT` | `8000` | uvicorn port, bound to loopback |
| `HTTP_PORT` | `3000` | nginx port |
| `SERVER_NAME` | `_` | nginx `server_name` |
| `ADMIN_PASSWORD` | prompt (`admin`) | Initial password for user `admin` |
| `SCANNER_RANGES` | prompt (guessed) | JSON array of CIDRs |
| `SKIP_NGINX=1` | off | Do not install or touch nginx |

### Afterwards

```bash
systemctl status homelable
journalctl -u homelable -f
```

- Config: `/opt/homelable/backend/.env` — every other option (OIDC, MCP,
  Proxmox, Zigbee, Z-Wave, live view) is documented in `.env.example`.
  `systemctl restart homelable` after an edit.
- Data: `/opt/homelable/data` — SQLite DB and uploads. Back up this folder.
- nginx site: `/etc/nginx/sites-available/homelable`.

Change the password later:

```bash
/opt/homelable/backend/.venv/bin/python -c \
  'import bcrypt; print(bcrypt.hashpw(b"newpassword", bcrypt.gensalt()).decode())'
# put it in backend/.env as AUTH_PASSWORD_HASH='$2b$12$...' (keep the single quotes)
systemctl restart homelable
```

⚠️ Keep JSON values in `backend/.env` single-quoted — `CORS_ORIGINS='["http://…"]'`.
systemd's `EnvironmentFile` parser strips bare double quotes, which breaks the
JSON before the backend parses it. This does not apply to the Docker install.

### Scanning as a non-root service

The unit runs as `homelable`, not root, so nmap has no raw sockets and silently
falls back to a TCP connect scan: hosts and open ports are still found, OS
detection (`-O`) and SYN scan (`-sS`) are not. To grant them, uncomment in
`/etc/systemd/system/homelable.service`:

```ini
AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN
```

then `systemctl daemon-reload && systemctl restart homelable`.

### Your own reverse proxy

With `SKIP_NGINX=1` the script leaves the front end to you: serve
`/opt/homelable/frontend/dist` as a static SPA and proxy the API to the backend.
The nginx translation of `docker/nginx.conf` — what the script writes, with
`backend:8000` replaced by `127.0.0.1:8000`:

```nginx
server {
    listen 3000;
    server_name _;
    root /opt/homelable/frontend/dist;
    index index.html;

    client_max_body_size 20M;

    # WebSocket — must come before /api/ to take priority
    location /api/v1/status/ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Legacy /ws/ path
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Terminating TLS in front of it means adding your own hostname to
`CORS_ORIGINS` in `backend/.env` (`https://homelable.example`) and restarting
the service.

---

## Configuration

All configuration is done via `.env` (copied from `.env.example`):

```env
# Generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=change_me_in_production

# Auth — default: admin / admin
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH='$2b$12$...'   # bcrypt hash — keep single quotes

# CIDR ranges to scan
SCANNER_RANGES=["192.168.1.0/24"]

# How often to check node status (seconds)
STATUS_CHECKER_INTERVAL=60
```

### OpenID Connect (optional)

OIDC is an exclusive alternative to the local password. Existing installs stay
in `AUTH_MODE=local` unless explicitly changed.

```env
AUTH_MODE=oidc
CORS_ORIGINS=["https://homelable.example"]
OIDC_DISCOVERY_URL=https://idp.example/application/o/homelable/.well-known/openid-configuration
OIDC_CLIENT_ID=homelable
OIDC_CLIENT_SECRET=replace-with-a-secret
OIDC_REDIRECT_URI=https://homelable.example/api/v1/auth/oidc/callback
OIDC_SCOPES="openid profile email"
OIDC_COOKIE_SECURE=true
OIDC_SESSION_EXPIRE_MINUTES=480
```

Register `OIDC_REDIRECT_URI` exactly at the identity provider. Production OIDC
requires HTTPS, a non-wildcard `CORS_ORIGINS`, and a confidential client. The
backend uses Authorization Code with PKCE and keeps provider tokens out of the
browser. `SECRET_KEY` must contain at least 32 bytes in OIDC mode. Do not expose
`OIDC_CLIENT_SECRET` in Compose YAML or commit it to Git.

All settings are also editable in-app via the **Scan Network** button.

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
