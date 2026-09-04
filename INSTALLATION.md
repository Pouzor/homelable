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

## Scanning from Docker — MAC addresses

Out of the box the backend runs on a Docker bridge network, and **the scan will
never report a MAC address** from it. MACs come from ARP, which is layer 2: the
container's ARP cache holds only the Docker gateway, and nmap can read a target's
hardware address only when that target sits in the same broadcast domain. From a
bridge every LAN host is one hop away behind the gateway, so the field stays
empty. `cap_add: NET_RAW` does not change this — the capability grants raw
sockets, not a place on the LAN.

This also affects device identity. When a device is rescanned it is matched on
MAC first and IP second, so without MACs a DHCP lease change makes the device
come back as a new entry in the inventory instead of updating the old one.

To collect MACs, put the backend on the LAN itself. In `docker-compose.yml` (or
`docker-compose.prebuilt.yml`), comment out the backend's `networks:` key and
uncomment:

```yaml
    network_mode: host
```

then `docker compose up -d`. Caveats:

- **Linux only.** On Docker Desktop for macOS and Windows the containers run
  inside a VM, so host networking still does not reach your physical LAN. There
  is no MAC-capable Docker setup on those platforms — run the
  [bare-metal install](#bare-metal--no-docker) instead.
- The backend binds `8000` directly on the host, with no port mapping and no
  network isolation from other host services.
- `frontend` and `mcp` reach the backend at `http://backend:8000` over the
  `homelable` bridge; once the backend leaves that network they need
  `http://127.0.0.1:8000` instead. Set `BACKEND_URL` on `mcp`, and for the front
  end either give it `network_mode: host` too or point its nginx proxy at the
  host address.

The alternative, if you would rather keep the backend isolated, is a **macvlan**
network, which gives the container its own MAC and IP on your physical LAN.
It needs a parent interface and a spare address range from your subnet, and on
most setups the Docker host itself cannot talk to a macvlan container without an
extra shim interface.

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

It prompts for the admin password and the CIDR range to scan, then writes
`backend/.env` with a generated `SECRET_KEY` and bcrypt hash. Open
**http://\<host-ip\>:3000**.

The script can also clone for you — run it from anywhere and it fetches the repo
into `INSTALL_DIR` when that directory is empty. Piped into `bash` there is no
terminal to prompt on, so pass the two answers as environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/Pouzor/homelable/main/scripts/install-baremetal.sh \
  | sudo ADMIN_PASSWORD=hunter2 SCANNER_RANGES='["192.168.1.0/24"]' bash
```

Without them the prompts are skipped and their defaults apply — the password
becomes `admin` and the range is guessed from the primary interface. The script
warns when that happens; change the password before exposing the host.

Re-running is safe and is how you upgrade — an existing `backend/.env` is kept
untouched, everything else is rebuilt:

```bash
cd /opt/homelable && git pull
sudo bash scripts/install-baremetal.sh
```

### Options

Every setting is an environment variable. Setting them all skips every prompt,
which is what makes an unattended install possible:

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
| `ADMIN_PASSWORD` | prompt, else `admin` | Initial password for user `admin` |
| `SCANNER_RANGES` | prompt, else guessed | JSON array of CIDRs |
| `SKIP_NGINX=1` | off | Do not install or touch nginx |
| `BASE_PATH` | `/` | Serve under a subpath — see [Serving under a subpath](#serving-under-a-subpath) |

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

## Serving under a subpath

By default Homelable owns the root of its origin (`https://homelable.example/`).
To put it behind an existing reverse proxy on a shared hostname — one cert, one
dynamic-DNS name, one open port, every service on its own prefix — build it with
a base path.

The base path is **baked into the build**: the browser has no way to guess it, so
it cannot be a runtime setting. Changing it means rebuilding the frontend.

### Docker

```bash
# in .env, next to the backend settings
VITE_BASE_PATH=/homelab/

docker compose build frontend && docker compose up -d
```

Homelable then answers on `http://<host>:3000/homelab/`. The generated nginx
config accepts both reverse-proxy styles, so either of these works in front of
it:

```nginx
# prefix forwarded intact — no trailing slash on proxy_pass
location /homelab/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}

# or: prefix stripped — trailing slash on proxy_pass
location /homelab/ {
    proxy_pass http://127.0.0.1:3000/;
    ...
}
```

The pre-built images (`docker-compose.prebuilt.yml`) are built for the root, so a
subpath needs a local build.

### Bare metal / LXC

```bash
sudo BASE_PATH=/homelab/ bash scripts/install-baremetal.sh
```

The script bakes the prefix into the build and writes the matching nginx site.
The build stays in `/opt/homelable/frontend/dist`; the site serves it through
`/var/www/homelable/homelab`, a symlink refreshed on every run. Re-running the
script with a different `BASE_PATH` (or none) rewrites both.

### Development

```bash
cd frontend && VITE_BASE_PATH=/homelab/ npm run dev   # http://localhost:5173/homelab/
```

The Vite dev proxy follows the same prefix and strips it before forwarding to
uvicorn on `:8000`.

### What to expect

- WebSocket status updates, uploaded floor plans and the read-only live view
  (`/homelab/view`) all follow the prefix.
- TLS in front still means adding your hostname to `CORS_ORIGINS` in
  `backend/.env`, exactly as at the root.
- OIDC: `OIDC_REDIRECT_URI` must carry the prefix
  (`https://home.example/homelab/api/v1/auth/oidc/callback`), and so must the
  redirect URI registered with your provider.
- Floor plans uploaded before the move keep working — stored URLs are resolved
  against the base path at render time.

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
