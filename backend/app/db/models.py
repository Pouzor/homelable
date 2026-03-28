import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    type: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    hostname: Mapped[str | None] = mapped_column(String)
    ip: Mapped[str | None] = mapped_column(String)
    mac: Mapped[str | None] = mapped_column(String)
    os: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="unknown")
    check_method: Mapped[str | None] = mapped_column(String)
    check_target: Mapped[str | None] = mapped_column(String)
    services: Mapped[list[Any]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    pos_x: Mapped[float] = mapped_column(Float, default=0)
    pos_y: Mapped[float] = mapped_column(Float, default=0)
    parent_id: Mapped[str | None] = mapped_column(String, ForeignKey("nodes.id"))
    container_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_colors: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    custom_icon: Mapped[str | None] = mapped_column(String, nullable=True)
    cpu_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_model: Mapped[str | None] = mapped_column(String, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    show_hardware: Mapped[bool] = mapped_column(Boolean, default=False)
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response_time_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    children: Mapped[list["Node"]] = relationship("Node", back_populates="parent")
    parent: Mapped["Node | None"] = relationship("Node", back_populates="children", remote_side=[id])


class Edge(Base):
    __tablename__ = "edges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String, ForeignKey("nodes.id", ondelete="CASCADE"))
    target: Mapped[str] = mapped_column(String, ForeignKey("nodes.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String, default="ethernet")
    label: Mapped[str | None] = mapped_column(String)
    vlan_id: Mapped[int | None] = mapped_column(Integer)
    speed: Mapped[str | None] = mapped_column(String)
    custom_color: Mapped[str | None] = mapped_column(String)
    path_style: Mapped[str | None] = mapped_column(String)
    animated: Mapped[bool] = mapped_column(Boolean, default=False)
    source_handle: Mapped[str | None] = mapped_column(String)
    target_handle: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CanvasState(Base):
    __tablename__ = "canvas_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    viewport: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PendingDevice(Base):
    __tablename__ = "pending_devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    ip: Mapped[str] = mapped_column(String, nullable=False)
    mac: Mapped[str | None] = mapped_column(String)
    hostname: Mapped[str | None] = mapped_column(String)
    os: Mapped[str | None] = mapped_column(String)
    services: Mapped[list[Any]] = mapped_column(JSON, default=list)
    suggested_type: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ScanRun(Base):
    __tablename__ = "scan_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    status: Mapped[str] = mapped_column(String, default="running")
    ranges: Mapped[list[str]] = mapped_column(JSON, default=list)
    devices_found: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
