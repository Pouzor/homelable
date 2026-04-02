"""Match nmap scan results against service_signatures.json."""
import json
import re
import threading
from pathlib import Path
from typing import Any

_SIGNATURES: list[dict[str, Any]] | None = None
_LOCK = threading.Lock()


def _load() -> list[dict[str, Any]]:
    global _SIGNATURES
    if _SIGNATURES is None:
        with _LOCK:
            if _SIGNATURES is None:
                path = Path(__file__).parent.parent / "data" / "service_signatures.json"
                try:
                    with open(path) as f:
                        _SIGNATURES = json.load(f)
                except FileNotFoundError as err:
                    raise FileNotFoundError(
                        f"service_signatures.json not found at {path}. "
                        "This file should be bundled with the application."
                    ) from err
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


# Known OUI prefixes — lowercase, colon-separated, first 3 octets
_MAC_OUI_TYPES: dict[str, str] = {
    # Hypervisors / VMs
    "52:54:00": "vm",    # QEMU/KVM (Proxmox VMs)
    "bc:24:11": "vm",    # Proxmox official OUI (VMs and LXC, 7.3+)
    "00:50:56": "vm",    # VMware
    "00:0c:29": "vm",    # VMware Workstation / Fusion
    "08:00:27": "vm",    # VirtualBox
    "00:15:5d": "vm",    # Hyper-V
    # Shelly
    "34:94:54": "iot",
    "84:f3:eb": "iot",
    "ec:fa:bc": "iot",
    "30:c6:f7": "iot",
    # Espressif (ESP8266 / ESP32 — used by Sonoff, many DIY IoT)
    "a0:20:a6": "iot",
    "24:62:ab": "iot",
    "30:ae:a4": "iot",
    "cc:50:e3": "iot",
    "ac:67:b2": "iot",
    "b4:e6:2d": "iot",
    "3c:71:bf": "iot",
    "8c:aa:b5": "iot",
    # Sonoff / ITEAD
    "dc:4f:22": "iot",
    "e8:db:84": "iot",
    # Tapo / TP-Link smart home
    "b0:a7:b9": "iot",
    "50:c7:bf": "iot",
    "1c:3b:f3": "iot",
    "10:27:f5": "iot",
    # Philips Hue
    "00:17:88": "iot",
    "ec:b5:fa": "iot",
    # IKEA Tradfri
    "34:13:e8": "iot",
    "00:21:2e": "iot",
    # Tuya / Smart Life (widely used chip in many brands)
    "d8:f1:5b": "iot",
    "68:57:2d": "iot",
}


def suggest_type_from_mac(mac: str | None) -> str | None:
    """Return a suggested node type from MAC OUI, or None if unknown."""
    if not mac:
        return None
    prefix = mac.lower()[:8]
    return _MAC_OUI_TYPES.get(prefix)


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
    # Smart-home / MQTT / CoAP → iot
    1883: "iot",
    8883: "iot",
    6052: "iot",    # ESPHome dashboard
    4915: "iot",    # Shelly CoIoT
    5683: "iot",    # CoAP (Shelly Gen1, many IoT devices)
    5684: "iot",    # CoAP DTLS
    # AP / wireless
    8880: "ap",     # UniFi HTTP
    8443: "ap",     # UniFi HTTPS
    # Switches
    161: "switch",  # SNMP
    162: "switch",  # SNMP trap
}


def suggest_node_type(open_ports: list[dict[str, Any]], mac: str | None = None) -> str:
    """Suggest a node type based on matched signatures, port hints, and MAC OUI."""
    # IoT vendor MACs are a strong, unambiguous signal — don't let generic HTTP ports override
    mac_type = suggest_type_from_mac(mac)
    if mac_type == "iot":
        return "iot"

    priority = ["proxmox", "nas", "router", "lxc", "vm", "ap", "camera", "iot", "server", "switch"]
    found: set[str] = set()
    for p in open_ports:
        port = p["port"]
        proto = p.get("protocol", "tcp")
        sig = match_port(port, proto)
        if sig and sig.get("suggested_node_type"):
            found.add(sig["suggested_node_type"])
        if port in _PORT_TYPE_HINTS:
            found.add(_PORT_TYPE_HINTS[port])

    if mac_type:
        found.add(mac_type)

    for t in priority:
        if t in found:
            return t
    return "generic"
