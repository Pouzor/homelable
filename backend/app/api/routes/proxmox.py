root@homelable:/opt/homelable# curl -s http://127.0.0.1:8000/api/v1/proxmox/proxmox-1/discover
{"detail":"Not authenticated"}root@homelable:/opt/homelable# cat $(find /opt/homelable/backend/app -name "*proxmox*.py")
import asyncio
from proxmoxer import ProxmoxAPI
import urllib3

# Disable common SSL warnings in local homelabs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class ProxmoxService:
    def __init__(self, host: str, user: str, token_value: str):
        # 1. Automatic token parsing (e.g., root@pam!token)
        if "!" in user:
            user_part, token_name = user.split("!", 1)
        else:
            user_part = user
            token_name = "token" # Fallback

        # 2. Clean IP (remove http:// and ports if any)
        clean_host = host.replace("http://", "").replace("https://", "").split(":")[0]

        self.proxmox = ProxmoxAPI(
            clean_host,
            user=user_part,
            token_name=token_name,
            token_value=token_value,
            verify_ssl=False
        )

    async def get_node_resources(self, node_name: str):
        loop = asyncio.get_event_loop()
        
        def fetch_resources():
            return self.proxmox.cluster.resources.get()
            
        try:
            # Run request in background to avoid blocking FastAPI
            resources = await loop.run_in_executor(None, fetch_resources)
            
            return [
                {
                    "vmid": res.get("vmid"),
                    "name": res.get("name"),
                    "type": res.get("type"),
                    "status": res.get("status"),
                    "cpu_usage": f"{res.get('cpu', 0) * 100:.1f}%",
                    "mem_usage": f"{(res.get('mem', 0) / res.get('maxmem', 1)) * 100:.1f}%" if res.get("maxmem") else "0%"
                }
                for res in resources if res.get("node") == node_name and res.get("type") in ["qemu", "lxc"]
            ]
        except Exception as e:
            print(f"Error fetching Proxmox resources for host {node_name}: {e}")
            return []from fastapi import APIRouter, Depends, HTTPException, status
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))root@homelable:/opt/homelable# 