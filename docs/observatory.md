# Optional Observatory monitoring integration (draft)

This opt-in bridge displays an existing Homelab Observatory collector's CPU,
memory, guest state and health findings alongside Homelable's infrastructure map.
Resource history, storage, network, activity and operations remain in Observatory
and open through detail links. It does not migrate databases, import devices,
scan a network, provision guests or replace Homelable status checks.

## Server configuration

```env
OBSERVATORY_SNAPSHOT_URL=https://monitor.example.com/api/integration/snapshot
OBSERVATORY_DASHBOARD_URL=https://monitor.example.com
OBSERVATORY_TOKEN=<dedicated read-only integration token, at least 32 characters>
```

Leave the snapshot URL empty to disable the integration (default). The full-mode
sidebar's Observatory entry then shows setup guidance and makes no outbound
request. Standalone builds have no integration entry.

The snapshot endpoint must implement the contract below. This draft depends on
the companion Observatory snapshot-feed change; it is not an endpoint supplied
by every Observatory version. Do not put a Proxmox token, dashboard password or
Cloudflare login token in `OBSERVATORY_TOKEN`.

Use a trusted HTTPS certificate between hosts. A loopback HTTP feed is suitable
only when both processes share the same trusted host. Container loopback refers
to the container itself. The browser-facing dashboard URL can differ from the
internal feed URL. Existing dashboard authentication still applies to detail
links. Cloudflare-only sign-in for Homelable itself is a separate integration;
this PR does not change Homelable's authentication.

All settings are server environment variables. Only the dashboard URL is sent
to the browser. The backend requires a normal Homelable authenticated request,
sends the dedicated token in an Authorization Bearer header, verifies TLS,
ignores proxy environment variables and refuses redirects. Requests have an
eight-second total deadline and a 2 MiB decoded-body limit. Invalid or failed
responses produce a sanitized unavailable state, never zero usage or demo data.

## Feed contract

`GET` the configured URL with `Authorization: Bearer <token>`:

```json
{
  "snapshot": {
    "host": {"name": "lab", "cpu_percent": 12.5,
             "memory_used_gib": 4.0, "memory_total_gib": 16.0},
    "collected_at": "2026-01-01T12:00:00+00:00",
    "collection_state": "complete",
    "stale_after_seconds": 60,
    "guests": [{"id": 100, "kind": "VM", "name": "web", "state": "running"}]
  },
  "insights": [{"level": "ok", "title": "CPU within threshold",
                "explanation": "This is a snapshot, not evidence of sustained health."}]
}
```

Unknown measurements are null. Timestamps must include a timezone. The view
uses device-local display time, marks stale/future-dated measurements, and
refreshes only on open or explicit Refresh. Extra upstream fields are discarded.
The feed must deny missing/incorrect tokens and expose no configuration, secrets,
raw logs, write actions or authentication-management endpoints. The token must
be independent of browser sign-in and revocable without changing that sign-in.

## Rollout

Review this draft with upstream before broadening its scope. Test with a synthetic
feed first, then a private collector. Keep existing Observatory history and
backups in place; disabling this integration simply removes the connection.

## Try with fictional data

Set the same dedicated test `OBSERVATORY_TOKEN` in the backend environment and
in the terminal running `python scripts/observatory-demo-feed.py` (Python 3.11+).
Set `OBSERVATORY_SNAPSHOT_URL=http://127.0.0.1:8061/api/integration/snapshot`
and a dashboard URL pointing at your own Observatory demo. Start Homelable's
backend on the same host, sign in, and open **Observatory** from the sidebar.
The fixture binds only to loopback and never contacts infrastructure. Stop it
with Ctrl+C. Its detail links require a separate demo deployment; the fixture
itself supplies only the JSON contract, not the linked pages.
