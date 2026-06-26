"""Match nmap scan results against service_signatures.json."""
import json
import re
import threading
from pathlib import Path
from typing import Any

_SIGNATURES: list[dict[str, Any]] | None = None
_OUI_MAP: dict[str, str] | None = None
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


def _load_oui() -> dict[str, str]:
    """Load OUI database and flatten to {prefix: node_type}."""
    global _OUI_MAP
    if _OUI_MAP is None:
        with _LOCK:
            if _OUI_MAP is None:
                path = Path(__file__).parent.parent / "data" / "oui_database.json"
                try:
                    with open(path) as f:
                        entries = json.load(f)
                except FileNotFoundError as err:
                    raise FileNotFoundError(
                        f"oui_database.json not found at {path}. "
                        "This file should be bundled with the application."
                    ) from err
                _OUI_MAP = {
                    prefix.lower(): entry["type"]
                    for entry in entries
                    for prefix in entry["prefixes"]
                }
    return _OUI_MAP


def _http_regex_hit(sig: dict[str, Any], http_signals: dict[str, Any] | None) -> bool:
    """True when the signature's http_regex matches the probe's title/headers."""
    rx = sig.get("http_regex")
    if not rx or not http_signals:
        return False
    headers = http_signals.get("headers") or {}
    haystack = " ".join(
        s for s in (
            http_signals.get("title"),
            headers.get("Server"),
            headers.get("X-Powered-By"),
        ) if s
    )
    return bool(haystack and re.search(rx, haystack, re.IGNORECASE))


def _service_tier(
    sig: dict[str, Any],
    port: int,
    protocol: str,
    banner: str | None,
    http_signals: dict[str, Any] | None,
) -> int | None:
    """
    Rank how well a signature matches (lower = stronger). None = not a match.

    Tier 1: port match + http_regex confirmed
    Tier 2: port match + banner_regex confirmed
    Tier 3: port-agnostic (port: null) + http_regex confirmed
    Tier 4: port match only (no regex, or http_regex with probe disabled)

    When http_signals is None (probe not run) an http_regex entry degrades to
    a port-only match — identical to pre-probe behaviour, no regression.
    When http_signals is provided, http_regex is strict: a miss disqualifies.
    """
    probe_ran = http_signals is not None
    has_http = bool(sig.get("http_regex"))

    # Port-agnostic entries (port: null) match purely on HTTP signals.
    if sig.get("port") is None:
        if has_http and _http_regex_hit(sig, http_signals):
            return 3
        return None

    if sig["port"] != port or sig["protocol"] != protocol:
        return None

    # http_regex is authoritative once a probe has run.
    if has_http and probe_ran:
        return 1 if _http_regex_hit(sig, http_signals) else None

    if sig.get("banner_regex"):
        if banner and re.search(sig["banner_regex"], banner, re.IGNORECASE):
            return 2
        return None

    # No regex constraint (or http_regex but probe disabled) → port-only guess.
    return 4


def match_service(
    port: int,
    protocol: str,
    banner: str | None = None,
    http_signals: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Return the best signature for a port, walking tiers most-specific first."""
    best: dict[str, Any] | None = None
    best_tier = 99
    for sig in _load():
        tier = _service_tier(sig, port, protocol, banner, http_signals)
        if tier is not None and tier < best_tier:
            best, best_tier = sig, tier
            if best_tier == 1:
                break  # strongest possible — stop early
    return best


def match_port(port: int, protocol: str, banner: str | None = None) -> dict[str, Any] | None:
    """Back-compat alias: match without HTTP-probe signals."""
    return match_service(port, protocol, banner)


def fingerprint_ports(
    open_ports: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Given a list of {port, protocol, banner?, http_signals?} dicts, return
    matched services. Unknown ports are included as unknown_service.
    """
    results = []
    for p in open_ports:
        sig = match_service(
            p["port"], p.get("protocol", "tcp"), p.get("banner"), p.get("http_signals")
        )
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


def suggest_type_from_mac(mac: str | None) -> str | None:
    """Return a suggested node type from MAC OUI, or None if unknown."""
    if not mac:
        return None
    prefix = mac.lower()[:8]
    return _load_oui().get(prefix)


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
