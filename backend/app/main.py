import logging
import logging.config
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, canvas, edges, liveview, node_history, nodes, scan, status
from app.api.routes import settings as settings_routes
from app.core.config import settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Ensure app logs are visible: attach a handler to the root logger if none
    # exists (uvicorn only installs handlers on its own loggers, not the root).
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
        root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)
    logging.getLogger("app").setLevel(logging.INFO)
    logging.getLogger("app.services.scanner").setLevel(logging.INFO)
    await init_db()
    settings.load_overrides()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Homelable API",
    version="1.8.3",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(nodes.router, prefix="/api/v1/nodes", tags=["nodes"])
app.include_router(edges.router, prefix="/api/v1/edges", tags=["edges"])
app.include_router(canvas.router, prefix="/api/v1/canvas", tags=["canvas"])
app.include_router(scan.router, prefix="/api/v1/scan", tags=["scan"])
app.include_router(status.router, prefix="/api/v1/status", tags=["status"])
app.include_router(settings_routes.router, prefix="/api/v1/settings", tags=["settings"])
app.include_router(node_history.router, prefix="/api/v1/node-history", tags=["node-history"])
app.include_router(liveview.router, prefix="/api/v1/liveview", tags=["liveview"])


@app.get("/api/v1/health")
async def health() -> dict[str, Any]:
    return {"status": "ok"}
