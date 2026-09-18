"""Trigger auto-place topology layout on a design.

Usage (via Makefile): make auto-place
                      make auto-place FORCE=true
                      make auto-place DESIGN_ID=<id>
Authenticates via MCP service key (MCP_SERVICE_KEY from env).
"""
import asyncio
import os
import sys

import httpx

BASE = "http://localhost:8000/api/v1"


async def main(design_id: str, force: bool) -> None:
    service_key = os.environ.get("MCP_SERVICE_KEY", "")
    if not service_key:
        print("  ERROR: MCP_SERVICE_KEY not set", file=sys.stderr)
        sys.exit(1)

    headers = {"X-Mcp-Service-Key": service_key}

    # Resolve design_id if not provided — pick first network design
    if not design_id:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{BASE}/designs", headers=headers)
            r.raise_for_status()
            designs = [d for d in r.json() if d.get("design_type") == "network"]
            if not designs:
                print("  ERROR: no network designs found", file=sys.stderr)
                sys.exit(1)
            design_id = designs[0]["id"]
            print(f"  Using design: {designs[0]['name']} ({design_id})")

    params = {"force": "true"} if force else {}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            f"{BASE}/designs/{design_id}/auto-place",
            headers=headers,
            params=params,
        )
        r.raise_for_status()
        result = r.json()

    print(f"  Nodes placed    : {result['nodes_placed']}")
    if result.get("nodes_moved"):
        print(f"  Nodes moved     : {result['nodes_moved']}")
    print(f"  Edges created   : {result['edges_created']}")
    print(f"  Already placed  : {result['skipped']}")


design_id = os.environ.get("DESIGN_ID", "")
force = os.environ.get("FORCE", "false").lower() not in ("false", "0", "no")
asyncio.run(main(design_id, force))
