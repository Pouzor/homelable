# Contributing to Homelable

Thanks for taking the time to contribute! This document covers everything you need to get started.

---

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Commit Message Format](#commit-message-format)

---

## Ways to Contribute

- Report bugs or unexpected behavior
- Suggest new features or improvements
- Fix open issues (check the [issue tracker](https://github.com/Pouzor/homelable/issues))
- Improve documentation
- Add service signatures to `service_signatures.json`

---

## Reporting Bugs

Before opening an issue, search existing ones to avoid duplicates.

When filing a bug, include:

- **Homelable version** (visible in the sidebar bottom-left)
- **Deployment method** (Docker Compose, Proxmox LXC, source)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Relevant logs** (`docker compose logs backend` / `docker compose logs frontend`)
- **Browser console errors** if it's a UI issue

---

## Suggesting Features

Open an issue with the `enhancement` label. Describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

For large changes, discuss first before writing code — it avoids wasted effort.

---

## Development Setup

### Prerequisites

- **Node.js 20+** and **npm**
- **Python 3.11–3.13** (3.14 not yet supported by all dependencies)
- **nmap** installed on your system (required for scanner)
- **Docker + Docker Compose** (optional, for full-stack testing)

### 1. Clone the repo

```bash
git clone https://github.com/Pouzor/homelable.git
cd homelable
```

### 2. Backend

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env             # edit AUTH_PASSWORD_HASH, SECRET_KEY, etc.

# Start the backend (auto-reloads on change)
uvicorn app.main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite proxies `/api` to `localhost:8000` — the backend must be running.

### 4. Verify tooling

```bash
./scripts/verify-tooling.sh
```

---

## Project Structure

```
homelable/
├── frontend/src/
│   ├── components/
│   │   ├── canvas/          # React Flow canvas, custom nodes & edges
│   │   ├── panels/          # Sidebar, detail panel, toolbar
│   │   ├── modals/          # Add/edit node, scan config, pending devices
│   │   └── ui/              # Shadcn/ui base components
│   ├── stores/              # Zustand state (canvas, auth, scan)
│   ├── hooks/               # Custom React hooks
│   ├── types/               # TypeScript interfaces & enums
│   ├── api/                 # Axios client & typed endpoints
│   └── utils/               # Layout, export, color helpers
│
├── backend/app/
│   ├── api/routes/          # FastAPI route handlers
│   ├── services/            # Scanner, status checker, canvas service
│   ├── db/                  # SQLAlchemy models, Alembic migrations
│   ├── schemas/             # Pydantic request/response schemas
│   └── core/                # Config, JWT, scheduler
│
├── docker/                  # Nginx configs
├── scripts/                 # LXC bootstrap, dev helpers
└── mcp/                     # MCP server (AI integration)
```

---

## Coding Standards

### General

- No untested code merged — every feature or fix must include tests
- Keep changes focused — one concern per PR

### Frontend (TypeScript + React)

- Strict TypeScript — no `any`, no type assertions unless truly necessary
- React Flow node domain fields go in `node.data`, never on the node root
- State management via Zustand stores — no prop drilling beyond 2 levels
- Styling via TailwindCSS utility classes — follow the existing [design system](#design-system)
- Run before committing:
  ```bash
  cd frontend
  npm run lint
  npm run typecheck
  npm test
  ```

### Backend (Python + FastAPI)

- Python 3.11+ syntax
- Pydantic v2 schemas for all request/response types
- SQLAlchemy async sessions — never block the event loop
- Scanner logic runs in a background thread — never in an async route directly
- All schema changes via Alembic migrations — never modify tables directly
- Run before committing:
  ```bash
  cd backend
  source .venv/bin/activate
  ruff check .
  pytest
  ```

### Design System

| Token | Value |
|---|---|
| Background | `#0d1117` |
| Surface | `#161b22` |
| Card | `#21262d` |
| Accent cyan | `#00d4ff` |
| Online | `#39d353` |
| Offline | `#f85149` |
| Pending | `#e3b341` |
| Font (UI) | Inter |
| Font (IPs/ports) | JetBrains Mono |

---

## Testing

Tests run automatically via a pre-commit hook when frontend or backend files are staged.

### Frontend

```bash
cd frontend
npm test                  # run all tests
npm run test:coverage     # with coverage report
```

Test files live in `__tests__/` next to their module, named `*.test.ts(x)`.

**What to test:** Zustand store actions, utility functions, non-trivial component logic.

### Backend

```bash
cd backend
source .venv/bin/activate
pytest                    # run all tests
pytest -v tests/test_nodes.py   # single file
```

Test files live in `backend/tests/test_*.py`.

**What to test:** all API routes (happy path + error cases), auth flows, service logic.

Use the `client` and `headers` fixtures from `conftest.py` — they provide an in-memory SQLite database so tests are isolated and fast.

---

## Submitting a Pull Request

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** — include tests.

3. **Run the full test suite** (frontend + backend) and make sure everything passes.

4. **Open a PR** against `main`:
   - Use a clear title (see commit format below)
   - Describe what changed and why
   - Reference any related issues (`Closes #123`)
   - Include screenshots for UI changes

5. Keep the PR focused — one feature or fix per PR. Large refactors should be discussed in an issue first.

---

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change with no behavior change |
| `test` | Adding or fixing tests |
| `chore` | Build, deps, tooling |

**Examples:**
```
feat: add logout button to sidebar
fix: stop click propagation on pending device checkbox
docs: add CONTRIBUTING.md
```


---

## Questions?

Open a [GitHub Discussion](https://github.com/Pouzor/homelable/discussions) or drop a comment on a relevant issue.
