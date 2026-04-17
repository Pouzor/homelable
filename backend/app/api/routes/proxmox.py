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
        # Initialize service with Node data (adjust fields if necessary)
        service = ProxmoxService(
            host=node.ip,
            user=node.api_token_id,
            token_value=node.api_token_secret
        )
        resources = await service.get_node_resources(node.name)
        
        return {
            "node_id": node_id,
            "node_name": node.name,
            "resources": resources
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))