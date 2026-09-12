"""Tests for status_checker service: each check method."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.status_checker import (
    _http_get,
    _parse_rtt_ms,
    _ping,
    _tcp_connect,
    check_node,
    check_service,
    check_services,
)


class _TransportClient:
    """
    Patch target for httpx.AsyncClient that routes through a MockTransport.

    Real client, fake network: _http_get exercises the genuine httpx request
    path (including .stream()) instead of a mock that would happily accept any
    call shape.
    """

    def __init__(self, handler):
        self._handler = handler
        # Bound before patching, so building the real client here does not
        # recurse back into this stand-in.
        self._real = httpx.AsyncClient
        self.kwargs = []

    def __call__(self, **kwargs):
        self.kwargs.append(dict(kwargs))
        kwargs.pop("verify", None)
        return self._real(transport=httpx.MockTransport(self._handler), **kwargs)


def _mock_httpx_client(status_code):
    """Build a stand-in for httpx.AsyncClient whose GET returns status_code."""
    return _TransportClient(lambda request: httpx.Response(status_code))

# --- check_node dispatcher ---

@pytest.mark.asyncio
async def test_check_node_none_always_online():
    result = await check_node("none", None, None)
    assert result["status"] == "online"
    assert result["response_time_ms"] is None


@pytest.mark.asyncio
async def test_check_node_none_always_online_ignores_host():
    """'none' returns online immediately without any network call."""
    with patch("app.services.status_checker._ping", new_callable=AsyncMock) as mock_ping:
        result = await check_node("none", None, "192.168.1.1")
    mock_ping.assert_not_called()
    assert result["status"] == "online"


@pytest.mark.asyncio
async def test_check_node_unknown_without_host():
    result = await check_node("ping", None, None)
    assert result["status"] == "unknown"
    assert result["response_time_ms"] is None


@pytest.mark.asyncio
async def test_check_node_ping_online():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=(True, 3)):
        result = await check_node("ping", None, "192.168.1.1")
    assert result["status"] == "online"
    assert result["response_time_ms"] == 3


@pytest.mark.asyncio
async def test_check_node_ping_offline():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=(False, None)):
        result = await check_node("ping", None, "192.168.1.1")
    assert result["status"] == "offline"


@pytest.mark.asyncio
async def test_check_node_http_online():
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock, return_value=True):
        result = await check_node("http", "192.168.1.1:8080", None)
    assert result["status"] == "online"


@pytest.mark.asyncio
async def test_check_node_http_prepends_scheme():
    """If target doesn't start with http, http:// is prepended."""
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_node("http", "192.168.1.1:8080", None)

    assert captured["url"].startswith("http://")


@pytest.mark.asyncio
async def test_check_node_https_uses_verify():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["verify"] = verify
        return True

    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_node("https", "https://myserver", None)

    assert captured["verify"] is True


@pytest.mark.asyncio
async def test_check_node_ssh():
    with patch("app.services.status_checker._tcp_connect", new_callable=AsyncMock, return_value=True) as mock_tcp:
        result = await check_node("ssh", None, "192.168.1.5")
    mock_tcp.assert_called_once_with("192.168.1.5", 22)
    assert result["status"] == "online"


@pytest.mark.asyncio
async def test_check_node_tcp_parses_port():
    captured = {}

    async def fake_tcp(host, port):
        captured["host"] = host
        captured["port"] = port
        return True

    with patch("app.services.status_checker._tcp_connect", side_effect=fake_tcp):
        await check_node("tcp", "192.168.1.10:9090", None)

    assert captured["host"] == "192.168.1.10"
    assert captured["port"] == 9090


@pytest.mark.asyncio
async def test_check_node_prometheus_appends_metrics():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_node("prometheus", "192.168.1.10:9090", None)

    assert "/metrics" in captured["url"]


@pytest.mark.asyncio
async def test_check_node_health_appends_health():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_node("health", "192.168.1.10:8080", None)

    assert "/health" in captured["url"]


@pytest.mark.asyncio
async def test_check_node_unknown_method_falls_back_to_ping():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=(True, 7)) as mock_ping:
        result = await check_node("foobar", None, "10.0.0.1")
    mock_ping.assert_called_once()
    assert result["status"] == "online"


@pytest.mark.asyncio
async def test_check_node_exception_returns_offline():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
        result = await check_node("ping", None, "10.0.0.1")
    assert result["status"] == "offline"
    assert result["response_time_ms"] is None


# --- _ping platform args ---

@pytest.mark.asyncio
async def test_ping_uses_unix_args_on_non_windows():
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "linux"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("192.168.1.1")

    assert "-c" in captured["args"]
    assert "-W" in captured["args"]
    assert "-n" not in captured["args"]
    # 2 probes so a single dropped packet doesn't flap the node offline
    c_idx = captured["args"].index("-c")
    assert captured["args"][c_idx + 1] == "2"
    # Linux: -W is in seconds; 2s is the intended timeout
    w_idx = captured["args"].index("-W")
    assert captured["args"][w_idx + 1] == "2"
    # IPv4 target → no -6 flag
    assert "-6" not in captured["args"]


@pytest.mark.asyncio
async def test_ping_uses_macos_millisecond_timeout():
    """macOS ping(8) -W is milliseconds, not seconds. 1ms would fail any RTT >1ms."""
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "darwin"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("192.168.1.1")

    assert "-c" in captured["args"]
    assert "-W" in captured["args"]
    w_idx = captured["args"].index("-W")
    assert captured["args"][w_idx + 1] == "2000"


@pytest.mark.asyncio
async def test_ping_uses_windows_args_on_win32():
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "win32"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("192.168.1.1")

    assert "-n" in captured["args"]
    assert "-w" in captured["args"]
    assert "-c" not in captured["args"]


# --- _ping IPv6 support ---

@pytest.mark.asyncio
async def test_ping_ipv6_linux_uses_dash6():
    """IPv6-only devices (e.g. Alexa) need ping -6 on Linux."""
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "linux"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("fe80::1")

    assert "-6" in captured["args"]
    assert captured["args"][-1] == "fe80::1"


@pytest.mark.asyncio
async def test_ping_ipv6_macos_uses_ping6():
    """macOS ships a separate ping6 binary for IPv6 targets."""
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "darwin"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("2001:db8::1")

    assert captured["args"][0] == "ping6"


@pytest.mark.asyncio
async def test_ping_ipv6_windows_uses_dash6():
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("app.services.status_checker.sys.platform", "win32"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("2001:db8::1")

    assert "-6" in captured["args"]


# --- _ping RTT parsing (issue #470) ---

LINUX_PING_OUTPUT = """PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.812 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=0.344 ms

--- 192.168.1.1 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1001ms
rtt min/avg/max/mdev = 0.344/0.578/0.812/0.234 ms
"""


def test_parse_rtt_reads_unix_probe_lines_not_the_summary():
    """The summary line's numbers must not win over the real probes."""
    # min of the two probes (0.344), rounded — not 1001 from "time 1001ms" of
    # the statistics line, and not anything from the rtt min/avg/max line.
    assert _parse_rtt_ms(LINUX_PING_OUTPUT) == 0


def test_parse_rtt_takes_the_minimum_probe():
    output = (
        "64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=42.5 ms\n"
        "64 bytes from 10.0.0.1: icmp_seq=2 ttl=64 time=12.4 ms\n"
    )
    # First probe carries ARP resolution, so the minimum is the fair reading.
    assert _parse_rtt_ms(output) == 12


def test_parse_rtt_windows_sub_millisecond():
    output = (
        "Reply from 192.168.1.1: bytes=32 time<1ms TTL=64\r\n"
        "Reply from 192.168.1.1: bytes=32 time<1ms TTL=64\r\n"
    )
    # "bytes=32" must not be read as an RTT — only "<1ms" is.
    assert _parse_rtt_ms(output) == 1


def test_parse_rtt_localized_windows_wording():
    """Translated Windows keeps the "<label><sep><number>ms" shape."""
    assert _parse_rtt_ms("Reponse de 192.168.1.1 : octets=32 temps=3ms TTL=64") == 3
    assert _parse_rtt_ms("Antwort von 192.168.1.1: Bytes=32 Zeit=5ms TTL=64") == 5


def test_parse_rtt_accepts_comma_decimal_separator():
    assert _parse_rtt_ms("64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=12,7 ms") == 13


def test_parse_rtt_returns_none_when_unparseable():
    assert _parse_rtt_ms("") is None
    assert _parse_rtt_ms("ping: unknown host nope.local") is None


@pytest.mark.asyncio
async def test_ping_returns_parsed_rtt_not_subprocess_walltime():
    """Regression for #470: 2 probes pace at ~1s, so wall-clock is not the RTT."""
    async def fake_exec(*args, **kwargs):
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(LINUX_PING_OUTPUT.encode(), b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        ok, rtt_ms = await _ping("192.168.1.1")

    assert ok is True
    assert rtt_ms == 0


@pytest.mark.asyncio
async def test_ping_captures_stdout_and_drains_it():
    """stdout must be piped (to read the RTT) and drained via communicate()."""
    captured = {}

    async def fake_exec(*args, **kwargs):
        captured["kwargs"] = kwargs
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(LINUX_PING_OUTPUT.encode(), b""))
        # wait() on a filled pipe deadlocks — it must not be what we call.
        proc.wait = AsyncMock(side_effect=AssertionError("must use communicate()"))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("192.168.1.1")

    assert captured["kwargs"]["stdout"] is asyncio.subprocess.PIPE


@pytest.mark.asyncio
async def test_ping_offline_reports_no_rtt():
    async def fake_exec(*args, **kwargs):
        proc = MagicMock()
        proc.returncode = 1
        proc.communicate = AsyncMock(return_value=(b"", b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        ok, rtt_ms = await _ping("192.168.1.99")

    assert ok is False
    assert rtt_ms is None


@pytest.mark.asyncio
async def test_ping_undecodable_output_falls_back_to_no_rtt():
    """Non-UTF8 bytes from a localized ping must not raise."""
    async def fake_exec(*args, **kwargs):
        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"\xff\xfe not utf8", b""))
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        ok, rtt_ms = await _ping("192.168.1.1")

    assert ok is True
    assert rtt_ms is None


@pytest.mark.asyncio
async def test_check_node_ping_falls_back_to_walltime_when_rtt_unparseable():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=(True, None)):
        result = await check_node("ping", None, "192.168.1.1")
    assert result["status"] == "online"
    assert isinstance(result["response_time_ms"], int)


@pytest.mark.asyncio
async def test_check_node_ping_reports_zero_rtt_not_walltime():
    """A sub-millisecond LAN reply must survive as 0, not be treated as missing."""
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=(True, 0)):
        result = await check_node("ping", None, "192.168.1.1")
    assert result["response_time_ms"] == 0


def test_is_ipv6_detection():
    from app.services.status_checker import _is_ipv6

    assert _is_ipv6("fe80::1") is True
    assert _is_ipv6("2001:db8::1") is True
    assert _is_ipv6("[2001:db8::1]") is True
    assert _is_ipv6("192.168.1.1") is False
    assert _is_ipv6("example.local") is False


# --- check_node target validation ---

@pytest.mark.asyncio
async def test_check_node_rejects_flag_like_target():
    """A target starting with '-' must never reach subprocess invocation."""
    from app.services.status_checker import check_node

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        result = await check_node("ping", "-O", None)

    mock_exec.assert_not_called()
    assert result["status"] == "unknown"


@pytest.mark.asyncio
async def test_check_node_rejects_flag_like_ip():
    from app.services.status_checker import check_node

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        result = await check_node("ping", None, "-O")

    mock_exec.assert_not_called()
    assert result["status"] == "unknown"


# --- _tcp_connect ---

@pytest.mark.asyncio
async def test_tcp_connect_success():
    writer_mock = MagicMock()
    writer_mock.close = MagicMock()
    writer_mock.wait_closed = AsyncMock()
    with patch("asyncio.open_connection", new_callable=AsyncMock, return_value=(MagicMock(), writer_mock)):
        result = await _tcp_connect("192.168.1.1", 22)
    assert result is True


@pytest.mark.asyncio
async def test_tcp_connect_timeout():
    async def timeout_open(*args, **kwargs):
        raise TimeoutError()

    with patch("asyncio.open_connection", side_effect=timeout_open):
        result = await _tcp_connect("192.168.1.1", 22)
    assert result is False


@pytest.mark.asyncio
async def test_tcp_connect_os_error():
    with patch("asyncio.open_connection", new_callable=AsyncMock, side_effect=OSError("refused")):
        result = await _tcp_connect("192.168.1.1", 9999)
    assert result is False


# --- check_service ---

@pytest.mark.asyncio
async def test_check_service_no_host_is_unknown():
    assert await check_service({"port": 80, "protocol": "tcp", "service_name": "http"}, None) == "unknown"


@pytest.mark.asyncio
async def test_check_service_flag_host_is_unknown():
    assert await check_service({"port": 80, "protocol": "tcp", "service_name": "http"}, "-O") == "unknown"


@pytest.mark.asyncio
async def test_check_service_udp_is_unknown():
    assert await check_service({"port": 53, "protocol": "udp", "service_name": "dns"}, "10.0.0.1") == "unknown"


@pytest.mark.asyncio
async def test_check_service_portless_non_web_is_unknown():
    svc = {"protocol": "tcp", "service_name": "thing"}
    assert await check_service(svc, "10.0.0.1") == "unknown"


@pytest.mark.asyncio
async def test_check_service_web_uses_http_get():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    svc = {"port": 8080, "protocol": "tcp", "service_name": "http"}
    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        result = await check_service(svc, "10.0.0.1")
    assert result == "online"
    assert captured["url"] == "http://10.0.0.1:8080"


@pytest.mark.asyncio
async def test_check_service_https_port_uses_https_scheme():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    svc = {"port": 443, "protocol": "tcp", "service_name": "web"}
    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_service(svc, "10.0.0.1")
    assert captured["url"].startswith("https://")


@pytest.mark.asyncio
async def test_check_service_web_offline_when_http_fails():
    svc = {"port": 80, "protocol": "tcp", "service_name": "http"}
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock, return_value=False):
        assert await check_service(svc, "10.0.0.1") == "offline"


@pytest.mark.asyncio
async def test_check_service_non_http_port_is_unknown():
    """Non-HTTP ports (DB, mail, …) stay grey — no TCP check, no red flap."""
    svc = {"port": 5432, "protocol": "tcp", "service_name": "postgres"}
    with patch("app.services.status_checker._tcp_connect", new_callable=AsyncMock) as mock_tcp, \
         patch("app.services.status_checker._http_get", new_callable=AsyncMock) as mock_http:
        result = await check_service(svc, "10.0.0.1")
    assert result == "unknown"
    mock_tcp.assert_not_called()
    mock_http.assert_not_called()


@pytest.mark.parametrize("port", [515, 9100, 9101, 9107])
@pytest.mark.asyncio
async def test_check_service_never_touches_a_raw_printing_port(port):
    """Issue #404: a GET to JetDirect/LPD makes the printer print it.

    The status checker runs every 60 s, so a printer approved as a node used to
    print one page a minute, forever. These ports get no request at all.
    """
    svc = {"port": port, "protocol": "tcp", "service_name": "jetdirect"}
    with patch("app.services.status_checker._tcp_connect", new_callable=AsyncMock) as mock_tcp, \
         patch("app.services.status_checker._http_get", new_callable=AsyncMock) as mock_http:
        result = await check_service(svc, "10.0.0.1")
    assert result == "unknown"
    mock_tcp.assert_not_called()
    mock_http.assert_not_called()


@pytest.mark.asyncio
async def test_check_service_printer_port_named_http_is_still_skipped():
    """A service_name saying "http" must not talk the checker onto 9100.

    Fingerprinting labels 9100 "Node Exporter", and an override can put any
    name there — the port decides, not the label.
    """
    svc = {"port": 9100, "protocol": "tcp", "service_name": "http-node-exporter"}
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock) as mock_http:
        result = await check_service(svc, "10.0.0.1")
    assert result == "unknown"
    mock_http.assert_not_called()


@pytest.mark.asyncio
async def test_check_service_ssh_port_22_is_unknown():
    """SSH (port 22) is never checked — keep it grey, not red/green."""
    svc = {"port": 22, "protocol": "tcp", "service_name": "ssh"}
    with patch("app.services.status_checker._tcp_connect", new_callable=AsyncMock) as mock_tcp:
        result = await check_service(svc, "10.0.0.1")
    assert result == "unknown"
    mock_tcp.assert_not_called()


@pytest.mark.asyncio
async def test_check_service_ipv6_brackets_url_host():
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    svc = {"port": 80, "protocol": "tcp", "service_name": "http"}
    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_service(svc, "2001:db8::1")
    assert captured["url"] == "http://[2001:db8::1]:80"


@pytest.mark.asyncio
async def test_check_services_returns_status_per_service():
    services = [
        {"port": 80, "protocol": "tcp", "service_name": "http"},
        {"port": 5432, "protocol": "tcp", "service_name": "postgres"},
    ]
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock, return_value=True):
        results = await check_services("10.0.0.1", services)
    assert results == [
        {"port": 80, "protocol": "tcp", "host": None, "status": "online"},
        {"port": 5432, "protocol": "tcp", "host": None, "status": "unknown"},
    ]


@pytest.mark.asyncio
async def test_check_services_echoes_the_host_override():
    services = [{"port": 443, "protocol": "tcp", "service_name": "blog", "host": "blog.example.com"}]
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock, return_value=True):
        results = await check_services("10.0.0.1", services)
    assert results == [
        {"port": 443, "protocol": "tcp", "host": "blog.example.com", "status": "online"},
    ]


# --- Per-service host override ---


async def _captured_url(svc, host):
    captured = {}

    async def fake_http_get(url, verify=False):
        captured["url"] = url
        return True

    with patch("app.services.status_checker._http_get", side_effect=fake_http_get):
        await check_service(svc, host)
    return captured.get("url")


@pytest.mark.asyncio
async def test_check_service_uses_the_host_override():
    svc = {"port": 8080, "protocol": "tcp", "service_name": "blog", "host": "blog.example.com"}
    assert await _captured_url(svc, "10.0.0.1") == "http://blog.example.com"


@pytest.mark.asyncio
async def test_check_service_drops_the_scanned_port_behind_a_reverse_proxy():
    """Issue #382 — an override points at a proxy; the internal port breaks it."""
    svc = {"port": 8083, "protocol": "tcp", "service_name": "blog", "host": "https://mywebserver.mydomain.com"}
    assert await _captured_url(svc, "192.168.100.100") == "https://mywebserver.mydomain.com"


@pytest.mark.asyncio
async def test_check_service_falls_back_to_the_node_host_when_override_is_blank():
    svc = {"port": 8080, "protocol": "tcp", "service_name": "blog", "host": "   "}
    assert await _captured_url(svc, "10.0.0.1") == "http://10.0.0.1:8080"


@pytest.mark.asyncio
async def test_check_service_honours_a_scheme_in_the_override():
    svc = {"protocol": "tcp", "service_name": "blog", "host": "https://blog.example.com"}
    assert await _captured_url(svc, "10.0.0.1") == "https://blog.example.com"


@pytest.mark.asyncio
async def test_check_service_takes_the_port_from_the_override():
    svc = {"protocol": "tcp", "service_name": "blog", "host": "blog.example.com:8443"}
    assert await _captured_url(svc, "10.0.0.1") == "https://blog.example.com:8443"


@pytest.mark.asyncio
async def test_check_service_keeps_the_port_typed_into_the_override():
    svc = {"port": 3000, "protocol": "tcp", "service_name": "blog", "host": "blog.example.com:8443"}
    assert await _captured_url(svc, "10.0.0.1") == "http://blog.example.com:8443"


@pytest.mark.asyncio
async def test_check_service_uses_the_first_host_of_a_comma_list_override():
    svc = {"port": 8080, "protocol": "tcp", "service_name": "blog", "host": "blog.example.com, alt.example.com"}
    assert await _captured_url(svc, "10.0.0.1") == "http://blog.example.com"


@pytest.mark.asyncio
async def test_check_service_brackets_an_ipv6_override():
    svc = {"port": 80, "protocol": "tcp", "service_name": "http", "host": "[2001:db8::1]:8080"}
    assert await _captured_url(svc, "10.0.0.1") == "http://[2001:db8::1]:8080"


@pytest.mark.asyncio
async def test_check_service_skips_a_non_http_port_behind_an_override():
    svc = {"port": 5432, "protocol": "tcp", "service_name": "postgres", "host": "db.example.com"}
    with patch("app.services.status_checker._http_get", new_callable=AsyncMock) as mock_get:
        assert await check_service(svc, "10.0.0.1") == "unknown"
    mock_get.assert_not_called()


@pytest.mark.asyncio
async def test_check_services_empty_list():
    assert await check_services("10.0.0.1", []) == []


# --- _http_get status-code interpretation (real primitive, mocked transport) ---

# --- Regression: an endless response body must not be buffered (issue #375) ---

_CHUNK = b"\0" * 65536


def _endless_body(counter: dict):
    """
    A body that never ends and declares no Content-Length — the Freebox
    bandwidth-test endpoint from issue #375. Bounded at 512 chunks (32 MiB) so
    a regression fails the test instead of hanging the suite forever.
    """

    async def gen():
        for _ in range(512):
            counter["chunks"] += 1
            yield _CHUNK

    return gen()


@pytest.mark.asyncio
async def test_http_get_does_not_read_the_body():
    # _http_get only needs the status line. Buffering the body of an endless
    # stream is what OOM-killed the backend, so assert not one byte is pulled.
    counter = {"chunks": 0}
    factory = _TransportClient(
        lambda request: httpx.Response(
            200,
            headers={"Content-Type": "application/octet-stream"},
            content=_endless_body(counter),
        )
    )
    with patch("app.services.status_checker.httpx.AsyncClient", factory):
        assert await _http_get("http://192.168.1.254:8095/") is True
    assert counter["chunks"] == 0


@pytest.mark.asyncio
async def test_http_get_true_on_2xx():
    with patch("app.services.status_checker.httpx.AsyncClient", _mock_httpx_client(200)):
        assert await _http_get("http://host") is True


@pytest.mark.asyncio
async def test_http_get_true_on_4xx():
    # A 4xx means the server is up and answering — still "online".
    with patch("app.services.status_checker.httpx.AsyncClient", _mock_httpx_client(404)):
        assert await _http_get("http://host") is True


@pytest.mark.asyncio
async def test_http_get_false_on_5xx():
    with patch("app.services.status_checker.httpx.AsyncClient", _mock_httpx_client(503)):
        assert await _http_get("http://host") is False


@pytest.mark.asyncio
async def test_check_service_http_exception_returns_offline():
    svc = {"port": 80, "protocol": "tcp", "service_name": "http"}
    with patch(
        "app.services.status_checker._http_get",
        new_callable=AsyncMock,
        side_effect=RuntimeError("connection refused"),
    ):
        assert await check_service(svc, "10.0.0.1") == "offline"
