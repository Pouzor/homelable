"""Shared builders for scan test suite (pure helpers, no fixtures)."""
import uuid

from app.db.models import Design, InventoryDevice, Node


async def _add_design(db_session, name: str) -> str:
    design = Design(id=str(uuid.uuid4()), name=name)
    db_session.add(design)
    await db_session.commit()
    return design.id


def _node(design_id: str, *, ip=None, ieee=None, mac=None, device_id=None) -> Node:
    """A canvas node. Addresses belong to the inventory row it draws, so pass
    `device_id`, or let `_node_for` mint the row from the addresses."""
    return Node(
        id=str(uuid.uuid4()), label="n", type="server", pos_x=0.0, pos_y=0.0,
        design_id=design_id, device_id=device_id,
    )


async def _node_for(db_session, design_id: str, *, ip=None, ieee=None, mac=None, **device_kwargs) -> Node:
    """A node plus the inventory row carrying its addresses, linked.

    Reuses a row that already describes these addresses — one device is one row,
    so a test placing the same host on a second canvas gets a second node, not a
    second device.
    """
    from app.services.inventory_sync import find_device_for

    device = await find_device_for(db_session, ip=ip, mac=mac, ieee=ieee)
    if device is None:
        device = InventoryDevice(
            id=str(uuid.uuid4()), ip=ip, mac=mac, ieee_address=ieee,
            status="approved", status_live="online", **device_kwargs,
        )
        db_session.add(device)
        await db_session.flush()
    node = _node(design_id, device_id=device.id)
    db_session.add(node)
    await db_session.commit()
    return node


async def _seed_zigbee_pending_pair(db_session):
    """Create a coordinator Node + a pending device + a link between them."""
    from app.db.models import InventoryDeviceLink, Node

    coord_device = InventoryDevice(
        ieee_address="0xCOORD",
        friendly_name="Coordinator",
        suggested_type="zigbee_coordinator",
        status="approved",
    )
    db_session.add(coord_device)
    await db_session.flush()
    coord = Node(
        label="Coordinator",
        type="zigbee_coordinator",
        device_id=coord_device.id,
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
