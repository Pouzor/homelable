"""Shared builders for scan test suite (pure helpers, no fixtures)."""
import uuid

from app.db.models import Design, InventoryDevice, Node


async def _add_design(db_session, name: str) -> str:
    design = Design(id=str(uuid.uuid4()), name=name)
    db_session.add(design)
    await db_session.commit()
    return design.id


def _node(design_id: str, *, ip=None, ieee=None, mac=None) -> Node:
    return Node(
        id=str(uuid.uuid4()), label="n", type="server", status="online",
        ip=ip, mac=mac, ieee_address=ieee, services=[], pos_x=0.0, pos_y=0.0,
        design_id=design_id,
    )


async def _seed_zigbee_pending_pair(db_session):
    """Create a coordinator Node + a pending device + a link between them."""
    from app.db.models import InventoryDeviceLink, Node

    coord = Node(
        label="Coordinator",
        type="zigbee_coordinator",
        status="unknown",
        ieee_address="0xCOORD",
    )
    db_session.add(coord)

    pending = InventoryDevice(
        ieee_address="0xR1",
        friendly_name="router_1",
        suggested_type="zigbee_router",
        device_subtype="Router",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add(pending)

    db_session.add(
        InventoryDeviceLink(
            source_ieee="0xCOORD",
            target_ieee="0xR1",
            discovery_source="zigbee",
        )
    )
    await db_session.commit()
    return coord, pending
