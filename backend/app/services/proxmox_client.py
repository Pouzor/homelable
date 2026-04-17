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
            return []