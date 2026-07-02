"""Tests for status_checker service: each check method."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.status_checker import (
    _ping,
    _tcp_connect,
    check_node,
    check_service,
    check_services,
)

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
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=True):
        result = await check_node("ping", None, "192.168.1.1")
    assert result["status"] == "online"
    assert result["response_time_ms"] is not None


@pytest.mark.asyncio
async def test_check_node_ping_offline():
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=False):
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
    with patch("app.services.status_checker._ping", new_callable=AsyncMock, return_value=True) as mock_ping:
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
        proc.wait = AsyncMock()
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
        proc.wait = AsyncMock()
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
        proc.wait = AsyncMock()
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
        proc.wait = AsyncMock()
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
        proc.wait = AsyncMock()
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
        proc.wait = AsyncMock()
        return proc

    with patch("app.services.status_checker.sys.platform", "win32"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
        await _ping("2001:db8::1")

    assert "-6" in captured["args"]


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
        {"port": 80, "protocol": "tcp", "status": "online"},
        {"port": 5432, "protocol": "tcp", "status": "unknown"},
    ]


@pytest.mark.asyncio
async def test_check_services_empty_list():
    assert await check_services("10.0.0.1", []) == []
