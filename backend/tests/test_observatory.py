from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.api.routes import observatory
from app.core.config import settings


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, 'observatory_snapshot_url', 'https://monitor.test/api/integration/snapshot')
    monkeypatch.setattr(settings, 'observatory_dashboard_url', 'https://monitor.test')
    monkeypatch.setattr(settings, 'observatory_token', 'test-secret-' * 4)


def feed(at=None):
    return {'snapshot': {'host': {'name': 'lab', 'cpu_percent': None},
                         'collected_at': (at or datetime.now(UTC)).isoformat(),
                         'guests': []}, 'insights': [], 'secret': 'must-not-forward'}


def upstream(monkeypatch, handler):
    original = httpx.AsyncClient
    def factory(**kwargs):
        assert kwargs['follow_redirects'] is False
        assert kwargs['trust_env'] is False
        return original(**kwargs, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(observatory.httpx, 'AsyncClient', factory)


async def test_auth_and_disabled(client, headers, monkeypatch):
    monkeypatch.setattr(settings, 'observatory_snapshot_url', '')
    assert (await client.get('/api/v1/observatory/snapshot')).status_code == 401
    result = await client.get('/api/v1/observatory/snapshot', headers=headers)
    assert result.json() == {'enabled': False}
    assert result.headers['cache-control'] == 'no-store'


async def test_snapshot_whitelist_unknown_and_staleness(client, headers, configured, monkeypatch):
    def handler(request):
        assert request.headers['authorization'] == 'Bearer ' + settings.observatory_token
        return httpx.Response(200, json=feed(datetime.now(UTC) - timedelta(minutes=5)))
    upstream(monkeypatch, handler)
    result = await client.get('/api/v1/observatory/snapshot', headers=headers)
    assert result.status_code == 200
    assert result.json()['stale'] is True
    assert result.json()['snapshot']['host']['cpu_percent'] is None
    assert 'must-not-forward' not in result.text
    assert settings.observatory_token not in result.text


@pytest.mark.parametrize('status,body', [(302, ''), (401, 'secret'), (200, 'invalid'),
                                      (200, '{}'),
                                      (200, 'x' * (observatory.MAX_BYTES + 1))], ids=['redirect', 'unauthorized', 'non-json', 'missing-fields', 'oversize'])
async def test_bad_upstream_sanitized(client, headers, configured, monkeypatch, status, body):
    upstream(monkeypatch, lambda _: httpx.Response(status, content=body, headers={'location': 'https://elsewhere.test'}))
    result = await client.get('/api/v1/observatory/snapshot', headers=headers)
    assert result.status_code == 502
    assert result.json()['detail'] == 'Observatory is unavailable or returned an invalid snapshot'


async def test_timeout(client, headers, configured, monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout('private details', request=request)
    upstream(monkeypatch, handler)
    result = await client.get('/api/v1/observatory/snapshot', headers=headers)
    assert result.status_code == 502
    assert 'private details' not in result.text


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'https://user:secret@host/path', 'https://host/path?token=secret'])
async def test_invalid_configuration(client, headers, configured, monkeypatch, url):
    monkeypatch.setattr(settings, 'observatory_snapshot_url', url)
    assert (await client.get('/api/v1/observatory/snapshot', headers=headers)).status_code == 503
