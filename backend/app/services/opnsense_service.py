"""OPNsense REST API client.

API key + secret → Basic auth (base64 key:secret).
Fetches ARP table and DHCP leases to build a device inventory.
"""
import base64
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _auth_header(api_key: str, api_secret: str) -> dict[str, str]:
    token = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


async def test_opnsense_connection(
    base_url: str,
    api_key: str,
    api_secret: str,
    verify_tls: bool = False,
) -> tuple[bool, str]:
    base = base_url.rstrip("/")
    headers = _auth_header(api_key, api_secret)
    try:
        async with httpx.AsyncClient(verify=verify_tls, timeout=10.0) as client:
            r = await client.get(f"{base}/api/diagnostics/interface/getArp", headers=headers)
            if r.status_code == 401:
                return False, "Authentication failed: invalid API key or secret"
            if r.status_code != 200:
                return False, f"Unexpected response {r.status_code} from {base_url}"
            data = r.json()
            rows = data if isinstance(data, list) else data.get("rows", [])
            return True, f"Connected — {len(rows)} ARP entr{'y' if len(rows) == 1 else 'ies'} found"
    except httpx.ConnectError as exc:
        return False, f"Cannot reach {base_url} — {exc}"
    except Exception as exc:
        return False, str(exc)


async def fetch_opnsense_inventory(
    base_url: str,
    api_key: str,
    api_secret: str,
    verify_tls: bool = False,
) -> list[dict[str, Any]]:
    """Fetch ARP table + DHCP leases and return normalized device dicts."""
    base = base_url.rstrip("/")
    headers = _auth_header(api_key, api_secret)

    async with httpx.AsyncClient(verify=verify_tls, timeout=15.0) as client:
        arp = await _fetch_arp(client, base, headers)
        leases = await _fetch_dhcp_leases(client, base, headers)

    # Merge: DHCP leases enrich ARP entries with hostnames/descriptions
    lease_by_mac: dict[str, dict[str, Any]] = {}
    for lease in leases:
        mac = (lease.get("mac") or "").lower().strip()
        if mac:
            lease_by_mac[mac] = lease

    seen_macs: set[str] = set()
    results: list[dict[str, Any]] = []

    for entry in arp:
        mac = (entry.get("mac") or "").lower().strip()
        ip = (entry.get("ip") or "").strip()
        if not mac and not ip:
            continue
        if mac in seen_macs:
            continue
        if mac:
            seen_macs.add(mac)

        lease = lease_by_mac.get(mac, {})
        hostname = (
            entry.get("hostname")
            or lease.get("hostname")
            or lease.get("descr")
            or None
        )
        if hostname:
            hostname = hostname.strip() or None

        iface = (entry.get("intf") or entry.get("intf_description") or "").strip()
        props: list[dict[str, str]] = []
        if iface:
            props.append({"name": "Interface", "value": iface})
        lease_state = lease.get("state") or lease.get("type")
        if lease_state:
            props.append({"name": "DHCP state", "value": str(lease_state)})

        ieee = f"opnsense-{mac}" if mac else f"opnsense-{ip}"
        results.append({
            "ieee_address": ieee,
            "mac": mac or None,
            "ip": ip or None,
            "hostname": hostname,
            "label": hostname or mac or ip,
            "type": "device",
            "vendor": None,
            "model": None,
            "properties": props,
        })

    # Add any DHCP lease entries not in ARP (static leases, offline hosts)
    for mac, lease in lease_by_mac.items():
        if mac in seen_macs:
            continue
        ip = (lease.get("address") or lease.get("ip") or "").strip()
        hostname = (lease.get("hostname") or lease.get("descr") or "").strip() or None
        ieee = f"opnsense-{mac}" if mac else f"opnsense-{ip}"
        results.append({
            "ieee_address": ieee,
            "mac": mac or None,
            "ip": ip or None,
            "hostname": hostname,
            "label": hostname or mac or ip,
            "type": "device",
            "vendor": None,
            "model": None,
            "properties": [{"name": "DHCP state", "value": "static/offline"}],
        })
        seen_macs.add(mac)

    logger.info("OPNsense: %d devices fetched from %s", len(results), base_url)
    return results


async def _fetch_arp(
    client: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    try:
        r = await client.get(f"{base}/api/diagnostics/interface/getArp", headers=headers)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            return list(data)
        rows: list[dict[str, Any]] = data.get("rows", [])
        return rows
    except Exception as exc:
        logger.warning("OPNsense ARP fetch failed: %s", exc)
        return []


async def _fetch_dhcp_leases(
    client: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    try:
        r = await client.get(f"{base}/api/dhcpv4/leases/searchLease", headers=headers)
        r.raise_for_status()
        rows: list[dict[str, Any]] = r.json().get("rows", [])
        return rows
    except Exception as exc:
        logger.debug("OPNsense DHCP lease fetch failed (may not be available): %s", exc)
        return []
