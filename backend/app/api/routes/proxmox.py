from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.db.models import Node
from app.api.deps import get_current_user
from app.services.proxmox_client import ProxmoxService

router = APIRouter()

@router.get("/{node_id}/discover")
async def discover_resources(
    node_id: str, 
    db: AsyncSession = Depends(get_db), 
    _: str = Depends(get_current_user)
):
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    try:
        # Extract properties supporting both 'key' and 'name' formats
        props = {}
        if isinstance(node.properties, list):
            for p in node.properties:
                if isinstance(p, dict):
                    k = p.get("key") or p.get("name")
                    v = p.get("value")
                    if k: props[k] = v
        elif isinstance(node.properties, dict):
            props = node.properties

        # Flexible credential lookup
        user = props.get("proxmox_token") or props.get("token_id") or props.get("user") or ""
        token_value = props.get("proxmox_secret") or props.get("token_secret") or props.get("token") or ""
        
        # Determine target node name (default to 'pve2' based on your DB log)
        target_node_name = props.get("proxmox_node") or node.name

        if not user or not token_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Incomplete credentials. Please check proxmox_token and proxmox_secret."
            )

        service = ProxmoxService(
            host=node.ip,
            user=user,
            token_value=token_value
        )
        
        # Fetch resources filtered by the specific Proxmox node name
        resources = await service.get_node_resources(target_node_name)
        
        return {
            "node_id": node_id,
            "node_name": target_node_name,
            "resources": resources
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))