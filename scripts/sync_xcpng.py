"""Trigger an immediate XCP-ng inventory sync via the backend API.

Usage: make sync-xcpng
Reads XCPNG_HOST / XCPNG_USERNAME / XCPNG_PASSWORD from the container env.
"""
import asyncio
import os
import sys

import httpx

BASE = "http://localhost:8000/api/v1"


async def main() -> None:
    service_key = os.environ.get("MCP_SERVICE_KEY", "")
    if not service_key:
        print("  ERROR: MCP_SERVICE_KEY not set", file=sys.stderr)
        sys.exit(1)

    headers = {"X-Mcp-Service-Key": service_key}

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{BASE}/xcpng/sync-now", headers=headers)
        if r.status_code == 200:
            run = r.json()
            print(f"  XCP-ng sync queued — run id: {run.get('id')} status: {run.get('status')}")
        else:
            print(f"  ERROR: {r.status_code} {r.text[:200]}", file=sys.stderr)
            sys.exit(1)


asyncio.run(main())
