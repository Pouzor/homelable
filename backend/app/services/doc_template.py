"""Markdown scaffolding for documents.

The header of a device document is generated **once**, when the document is
created or migrated from the old `notes` field, and from then on it belongs to
the user — nothing here ever rewrites a body that already exists. What keeps the
document honest instead is `facts_snapshot`, which records the facts as they read
at generation time so the UI can tell the user the device has moved on, and
`render_block`, which lets them drop a freshly generated section back in from the
editor's `/` menu whenever they want it.

Every section is emitted even when its data is empty, with an italic prompt in
place of the value. A blank section is the document telling the user what has not
been written yet; omitting it would hide the gap.
"""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any

# Sections whose data is structural rather than descriptive: they are dropped
# entirely rather than printed empty, because an unracked device has no rack
# position to leave blank.
_EMPTY = "—"
_PROMPT = "_…_"

TEMPLATE_DEVICE = "device"
TEMPLATE_BLANK = "blank"
TEMPLATE_RUNBOOK = "runbook"
TEMPLATE_SERVICE = "service"
TEMPLATE_NETWORK = "network"
TEMPLATE_INCIDENT = "incident"
TEMPLATE_PROCEDURE = "procedure"
TEMPLATE_DECISION = "decision"
TEMPLATE_ZONE = "zone"

# Frontmatter carries a version from the first release: documents round-trip to
# disk through export/import, so the on-disk shape is a compatibility surface.
FRONTMATTER_VERSION = 1


def cell(value: Any) -> str:
    """Escape a value for a markdown table cell.

    Mirrors `frontend/src/utils/exportMarkdown.ts`: backslash first, then pipe,
    then collapse newlines so one field cannot break the row.
    """
    if value is None or value == "":
        return _EMPTY
    text = str(value).replace("\\", "\\\\").replace("|", "\\|")
    return " ".join(text.split())


def device_name(device: Any) -> str:
    for attr in ("label", "friendly_name", "hostname", "ip"):
        value = getattr(device, attr, None)
        if value:
            return str(value)
    return "device"


def device_type(device: Any) -> str | None:
    return getattr(device, "type", None) or getattr(device, "suggested_type", None)


def _fmt_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return _EMPTY


def _sources(device: Any) -> str:
    sources = getattr(device, "discovery_sources", None) or []
    if not sources:
        single = getattr(device, "discovery_source", None)
        sources = [single] if single else []
    return ", ".join(str(s) for s in sources) if sources else _EMPTY


def service_key(service: dict[str, Any]) -> str:
    """The identity used everywhere else for a service: port|protocol|name."""
    port = service.get("port")
    protocol = service.get("protocol") or "tcp"
    name = (service.get("service_name") or "").lower()
    return f"{port if port is not None else ''}|{protocol}|{name}"


# Ports that are definitely not HTTP. Mirrors NON_HTTP_PORTS in
# `frontend/src/utils/serviceUrl.ts` — a service link printed in a document has
# to be the same link the canvas offers, or the document is quietly wrong.
_NON_HTTP_PORTS = frozenset(
    {
        21, 23, 25, 53, 110, 143, 389, 445, 465, 514, 587, 636, 993, 995,
        1433, 3306, 5432, 5672, 6379, 9092, 11211, 27017, 27018,
    }
)


def service_url(service: dict[str, Any], host: str | None) -> str | None:
    """The browsable URL for a service, or None when there is not one.

    Follows `getServiceUrl`: everything is HTTP unless the port says otherwise,
    a host override wins over the device's address and hides the scanned port
    (it usually names a reverse proxy), and UDP and SSH have no browser URL.
    """
    override = (service.get("host") or "").strip()
    effective_host = override or host
    if not effective_host or service.get("protocol") == "udp":
        return None

    scheme: str | None = None
    hostname = effective_host.split(",")[0].strip()
    for prefix in ("https://", "http://"):
        if hostname.startswith(prefix):
            scheme = prefix[:-3]
            hostname = hostname[len(prefix):].rstrip("/")
            break
    if not hostname:
        return None

    port = service.get("port")
    if port == 22 or (port is not None and port in _NON_HTTP_PORTS):
        return None

    name = (service.get("service_name") or "").lower()
    if scheme is None:
        secure = any(token in name for token in ("https", "ssl", "tls")) or port in (443, 8443)
        scheme = "https" if secure else "http"

    # A host override points at the public name; the scanned port is internal.
    printed_port = "" if override else (f":{port}" if port is not None else "")
    path = (service.get("path") or "").strip()
    if path and not path.startswith("/"):
        path = f"/{path}"
    return f"{scheme}://{hostname}{printed_port}{path}"


# ── generated blocks ────────────────────────────────────────────────────────


def block_device_info(device: Any, **_: Any) -> str:
    check = getattr(device, "check_method", None)
    target = getattr(device, "check_target", None)
    check_cell = f"`{check}` → `{target}`" if check and target else (f"`{check}`" if check else _EMPTY)
    vendor = getattr(device, "vendor", None)
    model = getattr(device, "model", None)
    vendor_model = " / ".join(part for part in (vendor, model) if part) or _EMPTY
    rows = [
        ("Type", device_type(device)),
        ("Vendor / Model", vendor_model),
        ("Hostname", getattr(device, "hostname", None)),
        ("IP", getattr(device, "ip", None)),
        ("MAC", getattr(device, "mac", None)),
        ("IEEE", getattr(device, "ieee_address", None)),
        ("OS", getattr(device, "os", None)),
        ("First discovered", f"{_fmt_date(getattr(device, 'discovered_at', None))} ({_sources(device)})"),
        ("Status check", check_cell),
    ]
    lines = ["| | |", "|---|---|"]
    lines += [f"| {label} | {cell(value)} |" for label, value in rows]
    return "\n".join(lines)


# What the hardware table looks for in `properties`, in order of preference.
# The scanner and the Proxmox import write these keys ("CPU Cores", "RAM",
# "Disk"); a user typing their own is likely to reach for one of the synonyms.
# Matched case-insensitively, so "ram" and "RAM" are the same key.
_HARDWARE_KEYS: dict[str, tuple[str, ...]] = {
    "cpu_model": ("cpu model", "cpu", "processor"),
    "cpu_count": ("cpu cores", "cores", "vcpu", "vcpus", "cpu count"),
    "ram": ("ram", "memory", "mem"),
    "disk": ("disk", "storage", "disk size", "capacity"),
}


def property_map(device: Any) -> dict[str, str]:
    """A device's properties as a lowercased key -> value lookup.

    The first occurrence of a key wins, matching how the tables read: a device
    carrying two "RAM" rows is showing the first one.
    """
    found: dict[str, str] = {}
    for entry in getattr(device, "properties", None) or []:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        value = entry.get("value")
        if not key or value in (None, ""):
            continue
        found.setdefault(str(key).strip().lower(), str(value).strip())
    return found


def _hardware_property(properties: dict[str, str], field: str) -> str | None:
    for candidate in _HARDWARE_KEYS[field]:
        if candidate in properties:
            return properties[candidate]
    return None


def block_hardware(device: Any, **_: Any) -> str:
    """CPU / RAM / Disk, read from `properties` first.

    The `cpu_count` / `cpu_model` / `ram_gb` / `disk_gb` columns are barely
    written any more — the scanner, the Proxmox import and the inventory modal
    all put hardware in `properties` instead — so a document generated from the
    columns alone printed an empty table beside a properties table listing the
    very same facts. Properties win; the columns are the fallback for a row that
    still carries them.

    A property value is taken verbatim: it is already formatted the way the user
    or the importer wrote it ("15.5 GB"), and guessing a unit onto a bare number
    would be inventing a fact.
    """
    properties = property_map(device)

    cpu_model = _hardware_property(properties, "cpu_model") or getattr(device, "cpu_model", None)
    cpu_count = _hardware_property(properties, "cpu_count") or getattr(device, "cpu_count", None)
    if cpu_model and cpu_count:
        cpu: Any = f"{cpu_model} ×{cpu_count}"
    else:
        cpu = cpu_model or (f"{cpu_count} cores" if cpu_count else None)

    ram_gb = getattr(device, "ram_gb", None)
    ram = _hardware_property(properties, "ram") or (f"{ram_gb:g} GB" if ram_gb else None)
    disk_gb = getattr(device, "disk_gb", None)
    disk = _hardware_property(properties, "disk") or (f"{disk_gb:g} GB" if disk_gb else None)

    return "\n".join(
        [
            "| CPU | RAM | Disk |",
            "|---|---|---|",
            f"| {cell(cpu)} | {cell(ram)} | {cell(disk)} |",
        ]
    )


def block_services(device: Any, **_: Any) -> str:
    services = getattr(device, "services", None) or []
    if not services:
        return "_No service has been fingerprinted on this device yet._"
    host = getattr(device, "ip", None) or getattr(device, "hostname", None)
    sections: list[str] = []
    for service in services:
        if not isinstance(service, dict):
            continue
        name = service.get("service_name") or "Service"
        port = service.get("port")
        protocol = service.get("protocol") or "tcp"
        heading = f"### {name}" + (f" — `{port}/{protocol}`" if port else "")
        lines = [heading, ""]
        url = service_url(service, host)
        if url:
            lines.append(f"- **URL** — <{url}>")
        if service.get("category"):
            lines.append(f"- **Category** — {service['category']}")
        lines += [
            f"- **Purpose** — {_PROMPT}",
            f"- **Credentials** — {_PROMPT} _(where they are kept — never the secret itself)_",
            f"- **Depends on** — {_PROMPT}",
        ]
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def block_properties(device: Any, **_: Any) -> str:
    properties = getattr(device, "properties", None) or []
    rows = [p for p in properties if isinstance(p, dict) and p.get("key")]
    if not rows:
        return ""
    lines = ["| Key | Value |", "|---|---|"]
    lines += [f"| {cell(p.get('key'))} | {cell(p.get('value'))} |" for p in rows]
    return "\n".join(lines)


def block_rack(device: Any, *, rack: dict[str, Any] | None = None, zone_label: str | None = None, **_: Any) -> str:
    parts: list[str] = []
    if rack and rack.get("name"):
        u_start = rack.get("u_start")
        u_height = rack.get("u_height") or 1
        span = rack.get("col_span")
        where = f"Rack **{rack['name']}**"
        if u_start:
            top = u_start + u_height - 1
            where += f", U{u_start}" + (f"–U{top}" if top != u_start else "")
        if span:
            where += ", full width" if span >= 12 else f", {span}/12 wide"
        parts.append(where + ".")
    if zone_label:
        parts.append(f"Zone **{zone_label}**.")
    return " ".join(parts)


def block_network(device: Any, *, connections: list[str] | None = None, **_: Any) -> str:
    ip = getattr(device, "ip", None)
    subnet = _guess_subnet(ip)
    peers = ", ".join(f"`{peer}`" for peer in connections) if connections else _PROMPT
    return "\n".join(
        [
            f"- **Subnet / VLAN** — {subnet or _PROMPT}",
            f"- **Connected to** — {peers}",
            f"- **DNS names** — {_PROMPT}",
            f"- **Firewall / exposure** — {_PROMPT}",
            f"- **Reverse proxy** — {_PROMPT}",
        ]
    )


def _guess_subnet(ip: str | None) -> str | None:
    """The /24 an IPv4 address sits in. Multi-IP fields keep the first token."""
    if not ip:
        return None
    first = ip.split(",")[0].strip()
    octets = first.split(".")
    if len(octets) != 4 or not all(o.isdigit() for o in octets):
        return None
    return f"{octets[0]}.{octets[1]}.{octets[2]}.0/24"


BLOCKS: dict[str, Callable[..., str]] = {
    "device-info": block_device_info,
    "hardware": block_hardware,
    "services": block_services,
    "properties": block_properties,
    "rack": block_rack,
    "network": block_network,
}


def render_block(name: str, device: Any, **context: Any) -> str:
    render = BLOCKS.get(name)
    if render is None:
        raise ValueError(f"Unknown block: {name}")
    return render(device, **context)


# ── the device document ─────────────────────────────────────────────────────


def facts_snapshot(device: Any) -> dict[str, Any]:
    """The device facts a generated document depends on.

    Compared against the live row to tell the user their document has drifted,
    so it holds the fields the template actually prints and nothing else.
    """
    services = getattr(device, "services", None) or []
    return {
        "label": device_name(device),
        "type": device_type(device),
        "hostname": getattr(device, "hostname", None),
        "ip": getattr(device, "ip", None),
        "mac": getattr(device, "mac", None),
        "ieee_address": getattr(device, "ieee_address", None),
        "os": getattr(device, "os", None),
        "vendor": getattr(device, "vendor", None),
        "model": getattr(device, "model", None),
        "cpu_count": getattr(device, "cpu_count", None),
        "cpu_model": getattr(device, "cpu_model", None),
        "ram_gb": getattr(device, "ram_gb", None),
        "disk_gb": getattr(device, "disk_gb", None),
        # The properties table prints these, and the hardware table now reads
        # CPU / RAM / Disk out of them — so an edit to one is a real change to
        # what the document says. A plain dict, because the snapshot is compared
        # against its own JSON round-trip and a tuple would come back a list.
        "properties": {
            str(entry["key"]): str(entry.get("value") or "")
            for entry in reversed(getattr(device, "properties", None) or [])
            if isinstance(entry, dict) and entry.get("key")
        },
        "check_method": getattr(device, "check_method", None),
        "check_target": getattr(device, "check_target", None),
        "services": sorted(service_key(s) for s in services if isinstance(s, dict)),
    }


def render_frontmatter(values: dict[str, Any]) -> str:
    """A minimal YAML block.

    Hand-rolled rather than `yaml.safe_dump` so key order is the order written
    here — the frontmatter is read by humans at the top of every document.
    """
    lines = ["---"]
    for key, value in values.items():
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines)


def render_device_document(
    device: Any,
    *,
    zone_label: str | None = None,
    rack: dict[str, Any] | None = None,
    connections: list[str] | None = None,
    today: date | None = None,
) -> str:
    """The full skeleton for a device, old notes appended verbatim."""
    today = today or date.today()
    name = device_name(device)
    notes = (getattr(device, "notes", None) or "").strip()

    front = render_frontmatter(
        {
            "homelable": FRONTMATTER_VERSION,
            "title": name,
            "device": getattr(device, "id", None),
            "type": device_type(device),
            "tags": [],
            "criticality": "medium",
            "owner": "",
            "review_every": "6m",
            "created": today.isoformat(),
        }
    )

    parts = [
        front,
        "",
        f"# {name}",
        "",
        "> _One line: what this device is for. Replace this quote._",
        "",
        "## Device Information",
        "",
        block_device_info(device),
        "",
        "### Hardware",
        "",
        block_hardware(device),
        "",
    ]

    location = block_rack(device, rack=rack, zone_label=zone_label)
    if location:
        parts += ["### Physical location", "", location, ""]

    properties = block_properties(device)
    if properties:
        parts += ["### Properties", "", properties, ""]

    parts += [
        "## Services",
        "",
        block_services(device),
        "",
        "## Network",
        "",
        block_network(device, connections=connections),
        "",
        "## Configuration",
        "",
        "_How it is set up, where the config lives, what is not default, and what",
        "would be needed to rebuild it from scratch._",
        "",
        "## Operations",
        "",
        "### Start / stop",
        "",
        _PROMPT,
        "",
        "### Backup",
        "",
        _PROMPT,
        "",
        "### Update procedure",
        "",
        _PROMPT,
        "",
        "### Monitoring and alerts",
        "",
        _PROMPT,
        "",
        "## Troubleshooting",
        "",
        "| Symptom | Likely cause | Fix |",
        "|---|---|---|",
        f"| {_PROMPT} | {_PROMPT} | {_PROMPT} |",
        "",
        "## Dependencies",
        "",
        f"- **Depends on** — {_PROMPT}",
        f"- **Used by** — {_PROMPT}",
        "",
        "## Changelog",
        "",
        "| Date | Change |",
        "|---|---|",
        f"| {today.isoformat()} | Document created |",
        "",
        "## Notes",
        "",
    ]

    if notes:
        parts += [
            f"<!-- Migrated verbatim from this device's Notes field on {today.isoformat()}. -->",
            "",
            notes,
            "",
        ]
    else:
        parts += ["_Anything worth remembering about this device._", ""]

    return "\n".join(parts)


# ── library templates ───────────────────────────────────────────────────────

_LIBRARY_TEMPLATES: dict[str, tuple[str, list[str]]] = {
    TEMPLATE_BLANK: ("", []),
    TEMPLATE_RUNBOOK: (
        "runbook",
        ["Trigger", "Preconditions", "Steps", "Verification", "Rollback", "Escalation"],
    ),
    TEMPLATE_SERVICE: (
        "service",
        ["What it does", "Endpoints", "Components", "Configuration", "Backup", "Failure modes"],
    ),
    TEMPLATE_NETWORK: (
        "network",
        ["Topology", "Subnets and VLANs", "DHCP and DNS", "Routing", "Firewall zones", "Remote access"],
    ),
    TEMPLATE_INCIDENT: ("incident", ["Timeline", "Impact", "Root cause", "Fix", "What to change"]),
    TEMPLATE_PROCEDURE: ("procedure", ["Goal", "Prerequisites", "Steps", "Verification"]),
    TEMPLATE_DECISION: ("decision", ["Status", "Context", "Decision", "Consequences"]),
    TEMPLATE_ZONE: ("zone", ["Purpose", "Members", "Addressing", "Access", "Notes"]),
}

TEMPLATE_IDS = frozenset({TEMPLATE_DEVICE, *_LIBRARY_TEMPLATES})


def render_library_document(template_id: str, title: str, *, today: date | None = None) -> str:
    """The skeleton for a page that is not about one device."""
    today = today or date.today()
    kind, headings = _LIBRARY_TEMPLATES.get(template_id, _LIBRARY_TEMPLATES[TEMPLATE_BLANK])
    front = render_frontmatter(
        {
            "homelable": FRONTMATTER_VERSION,
            "title": title,
            "template": kind or None,
            "tags": [],
            "created": today.isoformat(),
        }
    )
    parts = [front, "", f"# {title}", ""]
    for heading in headings:
        parts += [f"## {heading}", "", _PROMPT, ""]
    return "\n".join(parts)
