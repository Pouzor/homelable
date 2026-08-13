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


class Design(Base):
    __tablename__ = "designs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    design_type: Mapped[str] = mapped_column(String, nullable=False, default="network")
    icon: Mapped[str | None] = mapped_column(String, nullable=True, default="dashboard")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    type: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    design_id: Mapped[str | None] = mapped_column(String, ForeignKey("designs.id", ondelete="SET NULL"), nullable=True)
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
    parent_id: Mapped[str | None] = mapped_column(String, ForeignKey("nodes.id", ondelete="CASCADE"))
    container_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_colors: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    custom_icon: Mapped[str | None] = mapped_column(String, nullable=True)
    cpu_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_model: Mapped[str | None] = mapped_column(String, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    show_hardware: Mapped[bool] = mapped_column(Boolean, default=False)
    show_port_numbers: Mapped[bool] = mapped_column(Boolean, default=False)
    properties: Mapped[list[Any]] = mapped_column(JSON, default=list)
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)
    bottom_handles: Mapped[int] = mapped_column(Integer, default=1)
    top_handles: Mapped[int] = mapped_column(Integer, default=1)
    left_handles: Mapped[int] = mapped_column(Integer, default=0)
    right_handles: Mapped[int] = mapped_column(Integer, default=0)
    ieee_address: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_scan: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    design_id: Mapped[str | None] = mapped_column(String, ForeignKey("designs.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String, default="ethernet")
    label: Mapped[str | None] = mapped_column(String)
    vlan_id: Mapped[int | None] = mapped_column(Integer)
    speed: Mapped[str | None] = mapped_column(String)
    custom_color: Mapped[str | None] = mapped_column(String)
    path_style: Mapped[str | None] = mapped_column(String)
    line_style: Mapped[str | None] = mapped_column(String)
    width_mult: Mapped[float | None] = mapped_column(Float)
    animated: Mapped[str] = mapped_column(String, nullable=False, default='none')
    marker_start: Mapped[str] = mapped_column(String, nullable=False, default='none')
    marker_end: Mapped[str] = mapped_column(String, nullable=False, default='none')
    source_handle: Mapped[str | None] = mapped_column(String)
    target_handle: Mapped[str | None] = mapped_column(String)
    waypoints: Mapped[list[dict[str, float]] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CanvasState(Base):
    __tablename__ = "canvas_state"

    design_id: Mapped[str] = mapped_column(String, ForeignKey("designs.id", ondelete="CASCADE"), primary_key=True)
    viewport: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    custom_style: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Rack(Base):
    """A physical rack on a `design_type='rack'` canvas.

    Racks live per design, like nodes and edges. Geometry is expressed in rack
    units: `u_height` is the number of mountable U, and a device's `u_start` is
    always counted from the bottom rail — `numbering` only changes the printed
    labels.
    """

    __tablename__ = "racks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    design_id: Mapped[str] = mapped_column(String, ForeignKey("designs.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    u_height: Mapped[int] = mapped_column(Integer, default=42)
    # "19" or "10" (inches). Drives the drawn inner width.
    width_standard: Mapped[str] = mapped_column(String, default="19")
    # "bottom-up" or "top-down" — printed U labels only, never storage order.
    numbering: Mapped[str] = mapped_column(String, default="bottom-up")
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    # Frame/rail/interior colours + showNumbers/enclosed flags.
    style: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    pos_x: Mapped[float] = mapped_column(Float, default=0)
    pos_y: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class RackDevice(Base):
    """A piece of gear mounted in a rack.

    Two independent, both-optional links back to the rest of the app:

    * `device_id` — the Device Inventory entry (`device_inventory`). This is the
      primary link: inventory rows survive approval *and* node deletion, so
      unracking or deleting a canvas node never removes the inventory entry.
    * `node_id` — the logical-canvas node, when one exists. Only used to resolve
      live status and to seed cables from the network design's edges.

    Both are ``SET NULL`` on delete and `label` is denormalized, so a rack keeps
    rendering after an inventory purge.
    """

    __tablename__ = "rack_devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    design_id: Mapped[str] = mapped_column(String, ForeignKey("designs.id", ondelete="CASCADE"), nullable=False)
    rack_id: Mapped[str] = mapped_column(String, ForeignKey("racks.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("device_inventory.id", ondelete="SET NULL"), nullable=True
    )
    node_id: Mapped[str | None] = mapped_column(String, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    # 1-based, counted from the bottom rail.
    u_start: Mapped[int] = mapped_column(Integer, default=1)
    u_height: Mapped[int] = mapped_column(Integer, default=1)
    # 12-column horizontal grid: full = 12, half = 6, third = 4, quarter = 3.
    col_start: Mapped[int] = mapped_column(Integer, default=0)
    col_span: Mapped[int] = mapped_column(Integer, default=12)
    faceplate_id: Mapped[str] = mapped_column(String, nullable=False, default="blank-1u")
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="unknown")
    # [{id, label, type, x, y}] — positions are unit coordinates on the plate.
    ports: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class RackCable(Base):
    """A patch between two rack device ports.

    Not an `Edge`: rack cables are port-to-port and may cross racks, so they are
    their own relation rather than a canvas edge.
    """

    __tablename__ = "rack_cables"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    design_id: Mapped[str] = mapped_column(String, ForeignKey("designs.id", ondelete="CASCADE"), nullable=False)
    from_device_id: Mapped[str] = mapped_column(
        String, ForeignKey("rack_devices.id", ondelete="CASCADE"), nullable=False
    )
    from_port_id: Mapped[str] = mapped_column(String, nullable=False)
    to_device_id: Mapped[str] = mapped_column(
        String, ForeignKey("rack_devices.id", ondelete="CASCADE"), nullable=False
    )
    to_port_id: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, default="ethernet")
    color: Mapped[str] = mapped_column(String, default="#39d353")
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    # Print the label next to the run on the canvas.
    label_visible: Mapped[bool] = mapped_column(Boolean, default=False)
    # [{key, value, icon, visible}] — same records nodes carry; the visible ones
    # are drawn beside the cable.
    properties: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InventoryDevice(Base):
    __tablename__ = "device_inventory"
    # Permit the plain (non-Mapped[]) annotations on the transient request-only
    # attributes below; without this SQLAlchemy 2.0 tries to map them as columns.
    __allow_unmapped__ = True

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    mac: Mapped[str | None] = mapped_column(String)
    hostname: Mapped[str | None] = mapped_column(String)
    os: Mapped[str | None] = mapped_column(String)
    services: Mapped[list[Any]] = mapped_column(JSON, default=list)
    suggested_type: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    # Origin/primary source (first discovery): "arp"/"mdns"/"zigbee"/"zwave"/
    # "proxmox". Kept for back-compat; `discovery_sources` is the full set.
    discovery_source: Mapped[str | None] = mapped_column(String)
    # All sources that have observed this device. A device found by both an IP
    # scan and a Proxmox import carries e.g. ["arp", "proxmox"] and shows under
    # both inventory filters. Source of truth for the frontend source badges.
    discovery_sources: Mapped[list[Any]] = mapped_column(JSON, default=list)
    ieee_address: Mapped[str | None] = mapped_column(String, index=True, nullable=True, unique=True)
    friendly_name: Mapped[str | None] = mapped_column(String, nullable=True)
    device_subtype: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    lqi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Display properties carried from discovery (e.g. Proxmox specs: CPU/RAM/Disk,
    # VMID). Generic NodeProperty shape {key,value,icon,visible}; merged into the
    # Node's properties on approve. Empty for scan/mesh sources that don't set it.
    properties: Mapped[list[Any]] = mapped_column(JSON, default=list)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # --- Curated device facts (3.3.0) -------------------------------------
    # The inventory row, not the canvas node, owns what the device *is*. A node
    # only says how it is drawn. `label`/`type` supersede friendly_name/
    # suggested_type for a device that reached a canvas; the older pair is kept
    # so discovery imports and the source filters keep working unchanged.
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cpu_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_model: Mapped[str | None] = mapped_column(String, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    show_hardware: Mapped[bool] = mapped_column(Boolean, default=False)
    check_method: Mapped[str | None] = mapped_column(String, nullable=True)
    check_target: Mapped[str | None] = mapped_column(String, nullable=True)
    # Live reachability from the status checker. NOT `status` — that column holds
    # the inventory lifecycle (pending/approved/hidden) and the two must not be
    # conflated.
    status_live: Mapped[str] = mapped_column(String, default="unknown")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_scan: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    # Transient (not persisted): populated per-request by the scan routes to report
    # how many canvases this device already appears on. Not a mapped column.
    canvas_count: int = 0
    # Transient (not persisted): timestamps from the linked canvas node(s),
    # correlated by ip / ieee_address. None when the device is not on any canvas.
    node_created_at: datetime | None = None
    node_last_scan: datetime | None = None
    node_last_modified: datetime | None = None
    node_last_seen: datetime | None = None


class InventoryDeviceLink(Base):
    """Link between two Zigbee endpoints discovered during import.

    Endpoints are addressed by IEEE (stable across re-imports). Either side may
    already exist as a canvas Node (resolved via Node.ieee_address) or still be
    a InventoryDevice. On approval, the matching Edge is auto-created when both
    endpoints exist as canvas Nodes.
    """

    __tablename__ = "device_inventory_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    source_ieee: Mapped[str] = mapped_column(String, nullable=False, index=True)
    target_ieee: Mapped[str] = mapped_column(String, nullable=False, index=True)
    lqi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    discovery_source: Mapped[str] = mapped_column(String, nullable=False, default="zigbee")
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ScanRun(Base):
    __tablename__ = "scan_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    status: Mapped[str] = mapped_column(String, default="running")
    kind: Mapped[str] = mapped_column(String, default="ip", server_default="ip")
    ranges: Mapped[list[str]] = mapped_column(JSON, default=list)
    devices_found: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
