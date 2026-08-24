# Synology DSM Import

This feature connects Homelable to your Synology NAS, reads system and storage
facts over the DSM Web API, and drops the box onto the canvas as a typed `nas`
node — with hostname, model, RAM, volume capacity and disk health. **Container
Manager / Docker containers** are imported as `docker_container` nodes linked to
the NAS the same way Proxmox LXC guests are linked to a host. It can also
**sync** on a schedule so inventory keeps up with the NAS, and it **merges**
with a device already discovered by a network scan (same IP or MAC is updated
in place, not duplicated).

> 🔒 **Server-dependent feature** — requires the Homelable backend. It is hidden
> in the no-backend standalone/demo build.

---

## Feature Overview

- **API-based discovery** — Logs into DSM (`/webapi`) with a dedicated user and
  reads `SYNO.Core.System` + `SYNO.Storage.CGI.Storage`.
- **Typed nodes** — The NAS maps to the existing Homelable `nas` type.
  Container Manager (or the older Docker package) containers map to
  `docker_container`.
- **Hierarchy** — Each container is linked to the NAS with a `virtual` edge,
  matching Proxmox host → LXC. Host-network containers keep their own identity
  (`syno-{serial}-ct-{name}`) so they are never merged into the NAS by IP.
- **Hardware specs** — RAM, total volume size, per-volume used%, disk health
  and DSM version are imported as node properties (hidden by default — toggle
  them on from the right panel).
- **Merge / sync** — Re-importing updates the existing device in place and never
  deletes anything. An IP or MAC matching a previously scanned node merges onto it.
- **Auto-sync** — Optional scheduled re-import into the pending inventory.
- **Live status** — A fresh import sets an HTTPS (or TCP, if TLS verify is off)
  check against the DSM port so Live Status works without extra setup.

Volumes, shares and Virtual Machine Manager guests are **not** imported as
extra canvas nodes in this version.

---

## Prerequisites

1. A reachable **Synology NAS** (default DSM HTTPS port `5001`).
2. A **DSM user** Homelable can log in as (see below). LAN IP or hostname — not
   QuickConnect.

### Create a limited DSM user

In DSM:

1. **Control Panel → User & Group → Create**.
2. Name it something like `homelable`. Give it a strong password.
3. Under **Applications**, grant **DSM**. If you want containers imported, also
   grant **Container Manager** (or **Docker** on older DSM). Deny File Station /
   Photo Station / etc. if you prefer.
4. Do **not** enable 2FA on this account if you want **auto-sync**. One-off
   imports in the dialog can send an OTP; the scheduled job cannot.

Homelable never needs write access.

### Where credentials are stored

Username and password are real credentials and are treated as such:

- For a **one-off import**, type them into the import dialog. They are sent with
  that request only and are **never stored**.
- For **auto-sync** (which runs with no user present), configure them on the
  **server** via environment variables (below). They are read from `.env`, kept
  in memory.

```env
# backend/.env
SYNOLOGY_USERNAME=homelable
SYNOLOGY_PASSWORD=xxxxxxxx
SYNOLOGY_HOST=192.168.1.20          # optional default for auto-sync
SYNOLOGY_PORT=5001
SYNOLOGY_VERIFY_TLS=true            # set false only for self-signed certs
```

---

## Step-by-step Usage

### 1. Open the Synology Import dialog

Click **Synology Import** in the left sidebar (below "Proxmox Import").

### 2. Configure the connection

| Field | Default | Description |
|---|---|---|
| Synology Host | — | IP or hostname of the NAS |
| Port | 5001 | DSM HTTPS port |
| Username | _(optional)_ | DSM user; leave blank to use the server credentials |
| Password | _(optional)_ | DSM password; leave blank to use the server credentials |
| OTP (2FA) | _(optional)_ | Authenticator code for a 2FA user; one-off only |
| Verify TLS | on | Uncheck for self-signed certificates |

### 3. Test the connection (optional)

Click **Test Connection**. A green indicator confirms reachability + a valid
login; red shows a sanitized error.

### 4. Choose an import target

- **Pending section** — The NAS and containers are queued in the Device Inventory
  for review (and tracked as a scan run in Scan History). Approve, hide, or delete each.
- **Canvas directly** — Devices are fetched and shown grouped (NAS / Containers)
  in the dialog so you can pick which ones to add immediately.

### 5. Fetch inventory

Click **Import to Pending** (or **Fetch Inventory** in canvas mode). Homelable will:
1. Query `SYNO.API.Info` for CGI paths
2. Log in via `SYNO.API.Auth`
3. Read system info (model, serial, RAM, DSM version)
4. Read storage (volumes + disks)
5. Resolve LAN IP/MAC best-effort
6. List Container Manager / Docker containers (skipped if the package is absent)
7. Log out

### 6. Select and add to canvas

(Canvas mode) Devices are grouped by type (NAS / Containers). Use the checkboxes
to pick which to add, then **Add N to Canvas**. NAS→container `virtual` edges
are created automatically.

---

## Node Type Mapping

| DSM (`/webapi`) | Homelable type | Notes |
|---|---|---|
| The NAS itself | `nas` | Identity `syno-{serial}` |
| `SYNO.Docker.Container` / `SYNO.Container.Container` | `docker_container` | Nested under the NAS via a `virtual` edge |
| `status` reachable | node status online | |
| `ram_size` | RAM property (GB) | hidden by default |
| volume totals | Disk property (GB) | hidden by default |
| per-volume used% | Volume N properties | hidden by default |
| disk health | Disks property | hidden by default |
| container image / ports | Image, Ports properties | hidden by default |
| serial + hostname | synthetic identity (`syno-…`) | stable across re-imports |

---

## Auto-sync configuration

1. Configure `SYNOLOGY_USERNAME` / `SYNOLOGY_PASSWORD` (and optionally
   `SYNOLOGY_HOST`) in `backend/.env` and restart the backend.
2. Open **Settings** — a **Synology auto-sync** section appears once server
   credentials are configured.
3. Toggle **Auto-sync Synology inventory** and set the interval (min 300 s).

On each run, Homelable re-imports the NAS and its containers into the pending section:
- A new NAS or container appears as **pending** for review.
- An existing device is **updated in place** (status, specs, IP).
- Nothing is ever deleted — a NAS or container removed from the network is left on your canvas.

Auto-sync cannot send an OTP. Use a DSM user **without** 2FA for the scheduled job.

---

## Supported Versions

Works with DSM 6.x / 7.x Web API (`/webapi`). Container listing uses Container
Manager or the older Docker package when installed; the NAS still imports
without it. QuickConnect hostnames are not supported — use a LAN IP or local DNS
name.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Authentication failed" | Bad username/password or the user cannot use DSM | Re-check the account; grant DSM in Applications |
| "Two-factor authentication required" | The account has 2FA | Enter the OTP in the dialog, or use a non-2FA user for auto-sync |
| "Invalid OTP code" | Wrong or expired authenticator code | Generate a fresh code and retry |
| "TLS verification failed" | Self-signed certificate | Uncheck **Verify TLS** (labs only) |
| "Synology host could not be resolved" | DNS/hostname wrong | Use the IP or a resolvable name |
| "No Synology credentials provided and none configured" | Empty form and empty `.env` | Enter a user/password or set the server env vars |
| Duplicate-looking node | Same NAS under a different identity | Re-import merges by IP/MAC/serial; report if it persists |
