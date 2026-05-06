"""FastAPI router for Zigbee2MQTT import."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.schemas.zigbee import (
    ZigbeeEdgeOut,
    ZigbeeImportRequest,
    ZigbeeImportResponse,
    ZigbeeNodeOut,
    ZigbeeTestConnectionRequest,
    ZigbeeTestConnectionResponse,
)
from app.services.zigbee_service import fetch_networkmap, test_mqtt_connection

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/import", response_model=ZigbeeImportResponse)
async def import_zigbee_network(
    payload: ZigbeeImportRequest,
    _: str = Depends(get_current_user),
) -> ZigbeeImportResponse:
    """Fetch the Zigbee2MQTT network map and return nodes + edges ready for canvas drop.

    Connects to the specified MQTT broker, publishes a networkmap request to
    ``<base_topic>/bridge/request/networkmap``, and waits up to 10 s for the
    response.  The devices are returned as typed homelable nodes with a
    coordinator → router → end-device hierarchy.
    """
    try:
        nodes_raw, edges_raw = await fetch_networkmap(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            base_topic=payload.base_topic,
            username=payload.mqtt_username,
            password=payload.mqtt_password,
            tls=payload.mqtt_tls,
            tls_insecure=payload.mqtt_tls_insecure,
        )
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Zigbee import")
        raise HTTPException(status_code=500, detail="Unexpected error during Zigbee import") from exc

    nodes = [ZigbeeNodeOut(**n) for n in nodes_raw]
    edges = [ZigbeeEdgeOut(**e) for e in edges_raw]
    return ZigbeeImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/test-connection", response_model=ZigbeeTestConnectionResponse)
async def test_zigbee_connection(
    payload: ZigbeeTestConnectionRequest,
    _: str = Depends(get_current_user),
) -> ZigbeeTestConnectionResponse:
    """Quick MQTT ping to validate broker connection before importing."""
    try:
        await test_mqtt_connection(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            username=payload.mqtt_username,
            password=payload.mqtt_password,
            tls=payload.mqtt_tls,
            tls_insecure=payload.mqtt_tls_insecure,
        )
        return ZigbeeTestConnectionResponse(connected=True, message="Connection successful")
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except (ConnectionError, TimeoutError) as exc:
        return ZigbeeTestConnectionResponse(connected=False, message=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error during connection test")
        return ZigbeeTestConnectionResponse(connected=False, message=f"Unexpected error: {exc}")
