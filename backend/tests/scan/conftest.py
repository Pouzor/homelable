"""Fixtures shared across the scan test modules."""
import uuid

import pytest

from app.db.models import InventoryDevice


@pytest.fixture
async def pending_device(db_session):
    import uuid
    device = InventoryDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.100",
        mac="aa:bb:cc:dd:ee:ff",
        hostname="my-server",
        os="Linux",
        services=[{"port": 22, "name": "ssh"}],
        suggested_type="server",
        status="pending",
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


@pytest.fixture
async def mem_db():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.db.database import Base
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def two_device_inventory(db_session):
    devices = []
    for i in range(2):
        d = InventoryDevice(
            id=str(uuid.uuid4()),
            ip=f"192.168.1.{10 + i}",
            mac=None,
            hostname=f"host-{i}",
            os=None,
            services=[],
            suggested_type="generic",
            status="pending",
        )
        db_session.add(d)
        devices.append(d)
    await db_session.commit()
    for d in devices:
        await db_session.refresh(d)
    return devices


@pytest.fixture
async def zigbee_pending_device(db_session):
    device = InventoryDevice(
        id=str(uuid.uuid4()),
        ip=None,
        mac=None,
        hostname=None,
        friendly_name="bulb_1",
        services=[],
        suggested_type="zigbee_enddevice",
        device_subtype="EndDevice",
        ieee_address="0xABCDEF",
        vendor="IKEA",
        model="TRADFRI",
        lqi=180,
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device
