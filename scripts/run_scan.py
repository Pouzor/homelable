#!/usr/bin/env python3
"""
Standalone scan script — run with sudo to allow nmap OS detection and SYN scans.

Usage (from the repo root):
    sudo python scripts/run_scan.py 192.168.1.0/24
    sudo python scripts/run_scan.py 192.168.1.0/24 10.0.0.0/24

Results are written directly to the database and appear as Pending Devices
in the Homelable UI. The backend does not need to be restarted.
"""
import asyncio
import sys
import shutil
import logging
from pathlib import Path

# Load environment variables from .env before importing app modules
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / '.env')
except Exception:
    # dotenv not installed or .env missing — proceed, Settings may fallback to env
    pass

# Make sure app/ is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.db.database import AsyncSessionLocal, init_db # type: ignore
from app.db.models import ScanRun # type: ignore
from app.services.scanner import run_scan # type: ignore

logger = logging.getLogger(__name__)


async def main(ranges: list[str]) -> None:
    # Check for nmap availability
    if shutil.which('nmap') is None:
        logger.error('nmap not found in PATH — please install nmap to run the scanner')
        print('Error: nmap not found in PATH. Install nmap and retry.', file=sys.stderr)
        return

    await init_db()

    run_id: str | None = None
    try:
        # create a ScanRun record
        async with AsyncSessionLocal() as db:
            run = ScanRun(status="running", ranges=ranges)
            db.add(run)
            await db.commit()
            await db.refresh(run)
            run_id = run.id
            print(f"Scan started (id={run.id}) for ranges: {', '.join(ranges)}")

        # execute the scanner (this will update DB as it runs)
        async with AsyncSessionLocal() as db:
            await run_scan(ranges, db, run_id)

    except Exception as exc:
        logger.exception('Scanner failed')
        # mark the run as failed and save the error message
        if run_id is not None:
            try:
                async with AsyncSessionLocal() as db:
                    r = await db.get(ScanRun, run_id)
                    if r:
                        r.status = 'failed'
                        r.error = str(exc)
                        await db.commit()
            except Exception:
                logger.exception('Failed to record scan run failure to DB')
        print(f"Scan failed: {exc}", file=sys.stderr)

    finally:
        # print final status
        if run_id is not None:
            try:
                async with AsyncSessionLocal() as db:
                    r = await db.get(ScanRun, run_id)
                    if r:
                        print(f"Scan {r.status} — {r.devices_found} device(s) found")
                        if r.error:
                            print(f"Error: {r.error}", file=sys.stderr)
            except Exception:
                logger.exception('Failed to fetch final scan run status')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: sudo python scripts/run_scan.py <cidr> [<cidr> ...]")
        print("Example: sudo python scripts/run_scan.py 192.168.1.0/24")
        sys.exit(1)

    ranges = sys.argv[1:]
    asyncio.run(main(ranges))
