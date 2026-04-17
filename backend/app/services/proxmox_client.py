import asyncio
import logging
from proxmoxer import ProxmoxAPI
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

class ProxmoxService:
    def __init__(self, host: str, user: str, token_value: str):
        if "!" in user:
            user_part, token_name = user.split("!", 1)
        else:
            user_part = user
            token_name = "token"

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
            resources = await loop.run_in_executor(None, fetch_resources)
            
            # Normalizamos o nome para comparação (case-insensitive)
            search_name = node_name.lower().strip()
            
            output = []
            for res in resources:
                res_node = str(res.get("node", "")).lower().strip()
                res_type = res.get("type", "")
                
                if res_node == search_name and res_type in ["qemu", "lxc"]:
                    # Cálculos seguros para evitar erro com valores None
                    cpu = res.get("cpu", 0) or 0
                    mem = res.get("mem", 0) or 0
                    maxmem = res.get("maxmem", 1) or 1
                    
                    output.append({
                        "vmid": res.get("vmid"),
                        "name": res.get("name") or f"ID-{res.get('vmid')}",
                        "type": res_type,
                        "status": res.get("status", "unknown"),
                        "cpu_usage": f"{cpu * 100:.1f}%",
                        "mem_usage": f"{(mem / maxmem) * 100:.1f}%"
                    })
            return output
        except Exception as e:
            logger.exception("Error fetching Proxmox resources")
            return []