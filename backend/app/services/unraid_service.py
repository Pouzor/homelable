"""Unraid inventory service: fetch the server, its Docker containers and VMs.

Talks to the Unraid API (GraphQL at ``/graphql``, built in from Unraid 7.2, the
Unraid Connect plugin before that) with an API key in the ``x-api-key`` header,
over HTTP or HTTPS - Unraid serves its web UI over plain HTTP by default. Returns plain
homelable node dicts + host->guest edge hints; DB persistence lives in the
route layer (``app.api.routes.unraid``).

Container identity is the host UUID plus the container *name*: Unraid recreates
a container on every update, so its Docker id is not stable. A VM is keyed on
its libvirt UUID. The API reports a VM as name + state only - no NIC MAC, IP,
CPU or RAM - so a VM cannot be matched to a device a scan already found.
"""

from __future__ import annotations

import html
import logging
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.services.mac_utils import normalize_mac
from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Same NodeProperty shape + visibility-preservation rules as the other importers.
merge_unraid_properties = merge_zigbee_properties

_CONNECT_TIMEOUT = 8.0
_READ_TIMEOUT = 30.0

# Docker network drivers that give a container its own address on the LAN.
# Everything else (bridge, host, none, container:<id>) sits behind the host IP.
_LAN_DRIVERS = {"macvlan", "ipvlan"}

_INVENTORY_QUERY = """
query {
  info {
    system { uuid manufacturer model }
    cpu { brand threads }
    os { hostname }
    primaryNetwork { macAddress ipAddress }
    versions { core { unraid } }
  }
  docker {
    networks { name driver }
    containers {
      id names image state status autoStart webUiUrl labels lanIpPorts
      hostConfig { networkMode }
      networkSettings
    }
  }
}
"""

_VERSION_QUERY = "query { info { os { hostname } versions { core { unraid } } } }"

# Asked apart from the inventory query: a key without VM access, or a server
# with the VM manager off, must not cost the user the containers.
_VM_QUERY = "query { vms { domains { id name state } } }"

# libvirt states in which the guest is up. IDLE is a running guest blocked on I/O.
_VM_ONLINE_STATES = {"RUNNING", "IDLE"}


class UnraidAuthError(ConnectionError):
    """The API rejected the key (bad key, or missing permissions)."""


def _sanitize_unraid_error(exc: BaseException) -> str:
    """Return a generic, credential-free message for an Unraid/HTTP error."""
    logger.warning("Unraid error (sanitized for client): %r", exc)
    if isinstance(exc, UnraidAuthError):
        return str(exc)
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Authentication failed - check the API key and its permissions"
        if code == 404:
            return "Unraid API not found - is this Unraid 7.2+ (or has the Unraid Connect plugin)?"
        if exc.response.is_redirect and exc.response.headers.get("location", "").startswith("https://"):
            # A server with SSL on answers plain HTTP with a redirect to HTTPS.
            return "This server uses HTTPS - tick 'Use HTTPS'"
        return f"Unraid API returned HTTP {code}"
    raw = str(exc).lower()
    if "name or service not known" in raw or "getaddrinfo" in raw or "nodename nor servname" in raw:
        return "Unraid host could not be resolved"
    if "refused" in raw:
        return "Connection refused by Unraid host"
    if "wrong_version_number" in raw or "wrong version number" in raw or "record layer" in raw:
        # HTTPS spoken to a port that answers plain HTTP.
        return "This server does not answer HTTPS on that port - untick 'Use HTTPS'"
    if "certificate" in raw or "ssl" in raw or "tls" in raw:
        return "TLS verification failed - untick 'Verify TLS certificate' for self-signed certs"
    if "timed out" in raw or "timeout" in raw:
        return "Connection to Unraid host timed out"
    return "Unraid connection failed"


def _graphql_errors(payload: dict[str, Any]) -> None:
    """Raise for GraphQL-level errors. The API answers auth failures with HTTP 200."""
    errors = payload.get("errors")
    if not errors:
        return
    codes = {(e.get("extensions") or {}).get("code") for e in errors if isinstance(e, dict)}
    if "UNAUTHENTICATED" in codes:
        raise UnraidAuthError("Authentication failed - check the API key")
    if "FORBIDDEN" in codes:
        raise UnraidAuthError("The API key lacks permission - it needs read access to Docker, VMs and Info")
    first = errors[0].get("message") if isinstance(errors[0], dict) else None
    raise ValueError(f"Unraid API error: {first or 'unknown'}")


async def _query(client: httpx.AsyncClient, query: str) -> dict[str, Any]:
    resp = await client.post("/graphql", json={"query": query})
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise ValueError("Malformed Unraid API response")
    _graphql_errors(payload)
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Malformed Unraid API response")
    return data


def _client(host: str, port: int, api_key: str, verify_tls: bool, use_https: bool) -> httpx.AsyncClient:
    # Never follows redirects: an HTTP request a server bounces to HTTPS is
    # reported, not silently retried, so the key's transport stays the user's call.
    return httpx.AsyncClient(
        base_url=f"{'https' if use_https else 'http'}://{host}:{port}",
        headers={"x-api-key": api_key},
        verify=verify_tls,
        timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT),
    )


def _host_key(info: dict[str, Any]) -> str | None:
    """Stable host key: the system UUID, else the hostname."""
    key = ((info.get("system") or {}).get("uuid")) or ((info.get("os") or {}).get("hostname"))
    return str(key).lower() if key else None


def _host_node(info: dict[str, Any], host_ieee: str) -> dict[str, Any]:
    system = info.get("system") or {}
    net = info.get("primaryNetwork") or {}
    cpu = info.get("cpu") or {}
    hostname = (info.get("os") or {}).get("hostname")
    version = ((info.get("versions") or {}).get("core") or {}).get("unraid")
    model = " ".join(p for p in (system.get("manufacturer"), system.get("model")) if p) or None
    threads = cpu.get("threads")
    return {
        "id": host_ieee,
        "label": hostname or "Unraid",
        "type": "docker_host",
        "ieee_address": host_ieee,
        "hostname": hostname,
        "ip": net.get("ipAddress") or None,
        "mac": normalize_mac(net.get("macAddress")),
        "status": "online",
        "cpu_count": threads if isinstance(threads, int) else None,
        "cpu_model": cpu.get("brand") or None,
        "vendor": "Unraid",
        "model": model,
        "os_version": f"Unraid {version}" if version else None,
        "parent_ieee": None,
    }


def _container_name(raw: dict[str, Any]) -> str | None:
    names = raw.get("names") or []
    if not names or not isinstance(names[0], str):
        return None
    return names[0].lstrip("/") or None


def _lan_address(
    networks: dict[str, Any], drivers: dict[str, str | None]
) -> tuple[str | None, str | None]:
    """(ip, mac) when the container sits on a macvlan/ipvlan network, else (None, None).

    A bridge address is internal to the host and a bridge MAC changes on every
    recreate, so neither identifies the container. An ipvlan container shares
    the parent interface's MAC, so only macvlan contributes one.
    """
    for net_name, net in networks.items():
        driver = drivers.get(net_name)
        if driver not in _LAN_DRIVERS or not isinstance(net, dict):
            continue
        ip = net.get("IPAddress") or None
        if not ip:
            continue
        mac = normalize_mac(net.get("MacAddress")) if driver == "macvlan" else None
        return ip, mac
    return None, None


def _web_ui_service(
    url: str | None, own_ip: str | None = None, server_ip: str | None = None
) -> dict[str, Any] | None:
    """A "Web UI" service for the URL Unraid resolved from the template, or None.

    The address goes in ``host`` because most containers sit behind the server's
    IP on a published port, not on an address of their own. The URL comes
    HTML-escaped from the template (``&amp;`` in a query string).

    Unraid resolves the template's ``[IP]`` to the server even for a container
    with its own LAN address, where nothing answers on the server IP. Such a
    container gets its own address instead.
    """
    if not url:
        return None
    parts = urlsplit(html.unescape(url).strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return None
    netloc = parts.netloc
    if own_ip and server_ip and parts.hostname == server_ip:
        netloc = f"{own_ip}:{parts.port}" if parts.port else own_ip
    path = parts.path + (f"?{parts.query}" if parts.query else "")
    return {
        "port": port,
        "protocol": "tcp",
        "service_name": "Web UI",
        "host": f"{parts.scheme}://{netloc}",
        "path": path,
    }


def _container_node(
    raw: dict[str, Any],
    host_key: str,
    drivers: dict[str, str | None],
    names_by_id: dict[str, str],
    server_ip: str | None = None,
) -> dict[str, Any] | None:
    name = _container_name(raw)
    if not name:
        return None
    ieee = f"unraid-{host_key}-ct-{name}"
    settings_json = raw.get("networkSettings") or {}
    networks = settings_json.get("Networks") if isinstance(settings_json, dict) else None
    ip, mac = _lan_address(networks or {}, drivers)

    network_mode = (raw.get("hostConfig") or {}).get("networkMode") or None
    if network_mode and network_mode.startswith("container:"):
        # Shares another container's network namespace (a VPN sidecar, usually).
        target = network_mode.split(":", 1)[1]
        network_mode = f"container:{names_by_id.get(target, target[:12])}"

    labels = raw.get("labels") or {}
    ports = sorted(set(raw.get("lanIpPorts") or []))
    web_ui = _web_ui_service(raw.get("webUiUrl"), ip, server_ip)
    return {
        "id": ieee,
        "label": name,
        "type": "docker_container",
        "ieee_address": ieee,
        "hostname": name,
        "ip": ip,
        "mac": mac,
        "status": "online" if raw.get("state") == "RUNNING" else "offline",
        "vendor": "Docker",
        "model": raw.get("image") or None,
        "network": network_mode,
        "ports": ports,
        "services": [web_ui] if web_ui else [],
        "compose_project": labels.get("com.docker.compose.project") if isinstance(labels, dict) else None,
        "parent_ieee": f"unraid-host-{host_key}",
    }


def _vm_node(raw: dict[str, Any], host_key: str) -> dict[str, Any] | None:
    # PrefixedID is "<server>:<libvirt uuid>".
    uuid = str(raw.get("id") or "").split(":")[-1].lower()
    if not uuid:
        return None
    ieee = f"unraid-{host_key}-vm-{uuid}"
    name = raw.get("name") or f"vm-{uuid[:8]}"
    return {
        "id": ieee,
        "label": name,
        "type": "vm",
        "ieee_address": ieee,
        "hostname": name,
        "ip": None,
        "mac": None,
        "status": "online" if raw.get("state") in _VM_ONLINE_STATES else "offline",
        "vendor": "Unraid",
        "model": "KVM",
        "uuid": uuid,
        "services": [],
        "parent_ieee": f"unraid-host-{host_key}",
    }


def _parse_inventory(
    data: dict[str, Any], vms: list[dict[str, Any]] | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    info = data.get("info")
    docker = data.get("docker")
    if not isinstance(info, dict) or not isinstance(docker, dict):
        raise ValueError("Malformed Unraid API response")
    host_key = _host_key(info)
    if host_key is None:
        raise ValueError("Unraid API returned no system UUID or hostname")
    host_ieee = f"unraid-host-{host_key}"

    drivers = {
        n["name"]: n.get("driver")
        for n in docker.get("networks") or []
        if isinstance(n, dict) and n.get("name")
    }
    containers = [c for c in docker.get("containers") or [] if isinstance(c, dict)]
    # PrefixedID is "<server>:<docker id>"; networkMode references the bare id.
    names_by_id = {
        str(c.get("id", "")).split(":")[-1]: name
        for c in containers
        if (name := _container_name(c))
    }

    host = _host_node(info, host_ieee)
    nodes = [host]
    edges: list[dict[str, Any]] = []
    seen = {host_ieee}
    for raw in containers:
        node = _container_node(raw, host_key, drivers, names_by_id, host["ip"])
        if node is None or node["id"] in seen:
            continue
        seen.add(node["id"])
        nodes.append(node)
        edges.append({"source": host_ieee, "target": node["id"]})
    for raw in vms or []:
        node = _vm_node(raw, host_key)
        if node is None or node["id"] in seen:
            continue
        seen.add(node["id"])
        nodes.append(node)
        edges.append({"source": host_ieee, "target": node["id"]})
    return nodes, edges


def build_unraid_properties(node: dict[str, Any]) -> list[dict[str, Any]]:
    """NodeProperty list for an Unraid host or container. All hidden by default."""
    props: list[dict[str, Any]] = []

    def add(key: str, value: Any, icon: str | None = None) -> None:
        if value:
            props.append({"key": key, "value": str(value), "icon": icon, "visible": False})

    if node.get("type") == "docker_host":
        add("OS", node.get("os_version"))
        add("CPU Model", node.get("cpu_model"), "Cpu")
        if node.get("cpu_count") is not None:
            add("CPU Threads", node["cpu_count"], "Cpu")
    elif node.get("type") == "vm":
        add("UUID", node.get("uuid"))
        add("Kind", node.get("model"))
    else:
        add("Image", node.get("model"))
        add("Network", node.get("network"))
        add("Ports", ", ".join(node.get("ports") or []))
        add("Compose Project", node.get("compose_project"))
    props.append({"key": "Source", "value": "Unraid", "icon": None, "visible": False})
    return props


async def _fetch_vms(client: httpx.AsyncClient) -> tuple[list[dict[str, Any]], str | None]:
    """The server's VM list, or ([], why it could not be read). Never raises on a
    GraphQL error: missing VM access must not fail the container import."""
    try:
        data = await _query(client, _VM_QUERY)
    except UnraidAuthError:
        return [], "VMs were not imported: the API key has no read access to VMs"
    except ValueError as exc:
        logger.warning("Unraid VM list unavailable: %s", exc)
        return [], "VMs were not imported: the server did not return its VM list"
    domains = (data.get("vms") or {}).get("domains")
    return [d for d in domains or [] if isinstance(d, dict)], None


async def fetch_unraid_inventory(
    host: str,
    port: int,
    api_key: str,
    verify_tls: bool = True,
    use_https: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """Fetch the Unraid host, its containers and VMs: (nodes, edges, notice).

    ``notice`` says why VMs were left out, when they were; None otherwise.

    Raises:
        ConnectionError: transport/TLS/auth failures (sanitized message).
        ValueError: malformed API response or a GraphQL error.
    """
    try:
        async with _client(host, port, api_key, verify_tls, use_https) as client:
            data = await _query(client, _INVENTORY_QUERY)
            vms, notice = await _fetch_vms(client)
    except UnraidAuthError:
        raise
    except httpx.HTTPError as exc:
        raise ConnectionError(_sanitize_unraid_error(exc)) from exc
    nodes, edges = _parse_inventory(data, vms)
    return nodes, edges, notice


async def test_unraid_connection(
    host: str,
    port: int,
    api_key: str,
    verify_tls: bool = True,
    use_https: bool = False,
) -> tuple[bool, str]:
    """Quick reachability + auth check. Returns (connected, message)."""
    try:
        async with _client(host, port, api_key, verify_tls, use_https) as client:
            data = await _query(client, _VERSION_QUERY)
            _, notice = await _fetch_vms(client)
    except (httpx.HTTPError, UnraidAuthError) as exc:
        return False, _sanitize_unraid_error(exc)
    except Exception as exc:  # noqa: BLE001 - surface a safe message, log the rest
        logger.exception("Unexpected error during Unraid connection test")
        return False, _sanitize_unraid_error(exc)
    info = data.get("info") or {}
    hostname = (info.get("os") or {}).get("hostname") or "Unraid"
    version = ((info.get("versions") or {}).get("core") or {}).get("unraid") or "?"
    message = f"Connected to {hostname} (Unraid {version})"
    return True, f"{message}. {notice}" if notice else message
