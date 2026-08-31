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

# Kubernetes topology — disabled by default. See docs/kubernetes-topology.md
# for the least-privilege RBAC manifest and security boundaries.
# KUBERNETES_ENABLED=true
# KUBERNETES_SOURCE=in_cluster       # auto | in_cluster | kubeconfig
# KUBERNETES_CLUSTER_NAME=kubernetes
# KUBERNETES_SYNC_INTERVAL=300
```

### Kubernetes topology (optional)

Kubernetes topology is an observed, read-only graph separate from the editable
canvas. It is disabled by default. For a production deployment, run the
backend in the target cluster with a projected, least-privilege ServiceAccount
and set `KUBERNETES_SOURCE=in_cluster`.

Do not grant Secrets, ConfigMaps, `pods/log`, `pods/exec`, or any mutating
Kubernetes verb. The full RBAC manifest, an external Docker/kubeconfig example,
data-redaction rules, and sync-state behaviour are in
[docs/kubernetes-topology.md](./docs/kubernetes-topology.md).

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
