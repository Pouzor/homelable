# show available recipes
default:
    @just --list

# install backend, MCP, and frontend dependencies into local ignored paths
setup:
    uv venv --allow-existing --python "$(command -v python3.11)" .venv/backend
    uv pip install --python .venv/backend/bin/python -r backend/requirements.txt
    uv venv --allow-existing --python "$(command -v python3.13)" .venv/mcp
    uv pip install --python .venv/mcp/bin/python -r mcp/requirements.txt
    npm --prefix frontend ci

[group('test')]
backend-test:
    cd backend && ../.venv/backend/bin/pytest

[group('test')]
mcp-test:
    .venv/mcp/bin/pytest -c mcp/pytest.ini mcp/tests

[group('test')]
frontend-test:
    npm --prefix frontend test -- --run

[group('test')]
test: backend-test mcp-test frontend-test

[group('lint')]
lint:
    cd backend && ../.venv/backend/bin/ruff check .
    npm --prefix frontend run lint
    shellcheck scripts/*.sh
    hadolint --ignore DL3008 Dockerfile.backend
    hadolint --ignore DL3008 Dockerfile.frontend

[group('validate')]
typecheck:
    cd backend && ../.venv/backend/bin/mypy app/
    npm --prefix frontend run typecheck

[group('validate')]
build:
    npm --prefix frontend run build

[group('validate')]
fmt-check:
    nixfmt --check flake.nix

[group('validate')]
check: fmt-check lint typecheck test
