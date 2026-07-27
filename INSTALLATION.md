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

## Build from source

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
