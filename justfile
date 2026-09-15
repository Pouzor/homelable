# Show available recipes.
default:
    @just --list

# Install each project's lockfile-pinned dependencies into its local environment.
[group('setup')]
setup-frontend:
    npm --prefix frontend ci

[group('setup')]
setup-backend:
    python3.13 -m venv backend/.venv
    backend/.venv/bin/pip install -r backend/requirements.txt

[group('setup')]
setup-mcp:
    python3.13 -m venv mcp/.venv
    mcp/.venv/bin/pip install -r mcp/requirements.txt

[group('setup')]
setup: setup-frontend setup-backend setup-mcp

[group('lint')]
frontend-lint:
    npm --prefix frontend run lint

[group('lint')]
backend-lint:
    cd backend && .venv/bin/ruff check .

[group('validate')]
frontend-typecheck:
    npm --prefix frontend run typecheck

[group('validate')]
backend-mypy:
    cd backend && .venv/bin/mypy app/

[group('test')]
frontend-test:
    npm --prefix frontend test -- --run

[group('test')]
backend-test:
    cd backend && .venv/bin/pytest

[group('test')]
mcp-test:
    cd mcp && .venv/bin/pytest

# Local mirror of the project quality workflow; run setup first on a fresh checkout.
[group('validate')]
check: frontend-lint frontend-typecheck backend-lint backend-mypy frontend-test backend-test mcp-test
