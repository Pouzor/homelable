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
        props = {}
        if isinstance(node.properties, list):
            props = {p.get("key", ""): p.get("value", "") for p in node.properties if isinstance(p, dict)}
        elif isinstance(node.properties, dict):
            props = node.properties

        user = props.get("token_id") or props.get("username") or props.get("user") or ""
        token_value = props.get("token_secret") or props.get("password") or props.get("token") or ""

        if not user or not token_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Credenciais do Proxmox ausentes. Adicione 'token_id' e 'token_secret' nas propriedades do nó."
            )

        service = ProxmoxService(
            host=node.ip,
            user=user,
            token_value=token_value
        )
        resources = await service.get_node_resources(node.name)
        
        return {
            "node_id": node_id,
            "node_name": node.name,
            "resources": resources
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))