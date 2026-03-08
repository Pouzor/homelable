"""Match nmap scan results against service_signatures.json."""
import json
import re
from pathlib import Path
from typing import Any

_SIGNATURES: list[dict[str, Any]] | None = None


def _load() -> list[dict[str, Any]]:
    global _SIGNATURES
    if _SIGNATURES is None:
        path = Path(__file__).parent.parent.parent / "data" / "service_signatures.json"
        with open(path) as f:
            _SIGNATURES = json.load(f)
    return _SIGNATURES


def match_port(port: int, protocol: str, banner: str | None = None) -> dict[str, Any] | None:
    """Return the first signature matching port+protocol, optionally banner."""
    for sig in _load():
        if sig["port"] != port or sig["protocol"] != protocol:
            continue
        if sig.get("banner_regex") and (not banner or not re.search(sig["banner_regex"], banner, re.IGNORECASE)):
            continue
        return sig
    return None


def fingerprint_ports(open_ports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Given a list of {port, protocol, banner?} dicts, return matched services.
    Unknown ports are included as unknown_service.
    """
    results = []
    for p in open_ports:
        sig = match_port(p["port"], p.get("protocol", "tcp"), p.get("banner"))
        if sig:
            results.append({
                "port": p["port"],
                "protocol": p.get("protocol", "tcp"),
                "service_name": sig["service_name"],
                "icon": sig.get("icon"),
                "category": sig.get("category"),
            })
        else:
            proto = p.get("protocol", "tcp").upper()
            results.append({
                "port": p["port"],
                "protocol": p.get("protocol", "tcp"),
                "service_name": f"{proto}/{p['port']}",
                "icon": None,
                "category": None,
            })
    return results


_PORT_TYPE_HINTS: dict[int, str] = {
    # Proxmox
    8006: "proxmox",
    # NAS / storage
    5000: "nas",   # Synology DSM
    5001: "nas",   # Synology DSM HTTPS
    548: "nas",    # AFP
    873: "nas",    # rsync
    # Routers / network devices
    8291: "router",  # MikroTik Winbox
    179: "router",   # BGP
    # Cameras / RTSP
    554: "camera",
    8554: "camera",
    37777: "camera",   # Dahua
    34567: "camera",   # Amcrest
    2020: "camera",    # Tapo
    # Smart-home / MQTT → iot
    1883: "iot",
    8883: "iot",
    6052: "iot",    # ESPHome
    # AP / wireless
    8880: "ap",     # UniFi HTTP
    8443: "ap",     # UniFi HTTPS
    # Switches
    161: "switch",  # SNMP
    162: "switch",  # SNMP trap
}


def suggest_node_type(open_ports: list[dict[str, Any]]) -> str:
    """Suggest a node type based on the most specific matched signature."""
    priority = ["proxmox", "nas", "router", "lxc", "vm", "server", "ap", "camera", "iot", "switch"]
    found: set[str] = set()
    for p in open_ports:
        port = p["port"]
        proto = p.get("protocol", "tcp")
        sig = match_port(port, proto)
        if sig and sig.get("suggested_node_type"):
            found.add(sig["suggested_node_type"])
        if port in _PORT_TYPE_HINTS:
            found.add(_PORT_TYPE_HINTS[port])
    for t in priority:
        if t in found:
            return t
    return "generic"
