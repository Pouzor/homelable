from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, canvas, edges, nodes, scan, status
from app.core.config import settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_db()
    settings.load_overrides()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Homelable API",
    version="1.3.1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(nodes.router, prefix="/api/v1/nodes", tags=["nodes"])
app.include_router(edges.router, prefix="/api/v1/edges", tags=["edges"])
app.include_router(canvas.router, prefix="/api/v1/canvas", tags=["canvas"])
app.include_router(scan.router, prefix="/api/v1/scan", tags=["scan"])
app.include_router(status.router, prefix="/api/v1/status", tags=["status"])


@app.get("/api/v1/health")
async def health() -> dict[str, Any]:
    return {"status": "ok"}
