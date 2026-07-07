# Proxmox VE Import

This feature connects Homelable to your Proxmox VE host, reads the inventory over
the Proxmox REST API, and drops your hosts, VMs and LXC containers onto the canvas
as typed nodes — with names, run state and hardware specs. It can also **sync**
on a schedule so the canvas keeps up with your cluster, and it **merges** with
devices already discovered by a network scan (a VM whose guest IP was already
scanned is updated in place, not duplicated).

> 🔒 **Server-dependent feature** — requires the Homelable backend. It is hidden
> in the no-backend standalone/demo build.

---

## Feature Overview

- **API-based discovery** — Reads `/api2/json` from Proxmox VE using a read-only API token.
- **Typed nodes** — Devices map to existing Homelable node types:
  - `proxmox` — a Proxmox host / cluster member (becomes a parent)
  - `vm` — a QEMU/KVM virtual machine
  - `lxc` — an LXC container
- **Hierarchy** — Each host is linked to its VMs/LXC with a `virtual` edge.
- **Hardware specs** — vCPU count, RAM and disk size are imported as node properties (CPU Cores, RAM, Disk), hidden by default — toggle them on from the right panel.
- **Guest IPs** — QEMU IPs come from the guest agent (when installed); LXC IPs are parsed from the container's static `net0` config.
- **Merge / sync** — Re-importing updates existing devices in place and never deletes anything. A guest IP matching a previously scanned node merges onto it.
- **Auto-sync** — Optional scheduled re-import into the pending inventory.

---

## Prerequisites

1. A reachable **Proxmox VE** host (default API port `8006`).
2. A **Proxmox API token** with a read-only role (see below).
3. (Optional, for QEMU guest IPs) the **QEMU guest agent** installed in your VMs.

### Create an API token

In the Proxmox web UI:

1. **Datacenter → Permissions → API Tokens → Add**.
2. Pick a **User** (e.g. `root@pam`, or better a dedicated `homelable@pve` user).
3. Give the token an **ID** (e.g. `homelable`). The full token id is then
   `user@realm!tokenid` — for example `root@pam!homelable`.
4. Leave **Privilege Separation** checked (recommended) and click **Add**.
5. **Copy the secret now** — Proxmox shows it only once.

Grant the token (or its user) a **read-only** role:

1. **Datacenter → Permissions → Add → API Token Permission**.
2. Path `/`, select your token, Role **`PVEAuditor`**, enable **Propagate**.

`PVEAuditor` is read-only — Homelable never needs write access.

### Where the token is stored

The token is a real credential and is treated as one:

- For a **one-off import**, type the token into the import dialog. It is sent with
  that request only and is **never stored**.
- For **auto-sync** (which runs with no user present), configure the token on the
  **server** via environment variables (below). It is read from `.env`, kept in
  memory.

```env
# backend/.env
PROXMOX_TOKEN_ID=root@pam!homelable
PROXMOX_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PROXMOX_HOST=192.168.1.10          # optional default for auto-sync
PROXMOX_PORT=8006
PROXMOX_VERIFY_TLS=true            # set false only for self-signed certs
```

---

## Step-by-step Usage

### 1. Open the Proxmox Import dialog

Click **Proxmox Import** in the left sidebar (below "Z-Wave Import").

### 2. Configure the connection

| Field | Default | Description |
|---|---|---|
| Proxmox Host | — | IP or hostname of the Proxmox host |
| Port | 8006 | Proxmox API port |
| Token ID | _(optional)_ | `user@realm!tokenid`; leave blank to use the server token |
| Token Secret | _(optional)_ | The token secret; leave blank to use the server token |
| Verify TLS | on | Uncheck for self-signed certificates |

### 3. Test the connection (optional)

Click **Test Connection**. A green indicator confirms reachability + a valid token;
red shows a sanitized error.

### 4. Choose an import target

- **Pending section** — Devices are queued in the Device Inventory for review
  (and tracked as a scan run in Scan History). Approve, hide, or delete each.
- **Canvas directly** — Devices are fetched and shown grouped in the dialog so you
  can pick which ones to add immediately.

### 5. Fetch inventory

Click **Import to Pending** (or **Fetch Inventory** in canvas mode). Homelable will:
1. Query `/nodes` for hosts
2. Query `/qemu` and `/lxc` per host
3. Resolve guest IPs (agent for QEMU, `net0` for LXC) best-effort
4. Return hosts + guests grouped by type

### 6. Select and add to canvas

(Canvas mode) Devices are grouped by type (Hosts / Virtual Machines / LXC
Containers). Use the checkboxes to pick which to add, then **Add N to Canvas**.

### 7. Arrange on the canvas

Nodes are placed in a grid; host→guest `virtual` edges connect them. Use
**Auto Layout** or drag nodes manually.

---

## Node Type Mapping

| Proxmox (`/api2/json`) | Homelable type | Notes |
|---|---|---|
| `/nodes` (host) | `proxmox` | Becomes the parent, linked to its guests |
| `/nodes/{node}/qemu/{vmid}` | `vm` | Guest-agent IP when available |
| `/nodes/{node}/lxc/{vmid}` | `lxc` | Static `net0` IP when set |
| `status` running/stopped | node status online/offline | |
| `maxcpu` | CPU Cores property | hidden by default |
| `maxmem` | RAM property (GB) | hidden by default |
| `maxdisk` | Disk property (GB) | hidden by default |
| VMID + host | synthetic identity (`pve-{host}-{vmid}`) | stable across re-imports |

Guest hierarchy is rendered as `virtual` edges (host ↔ VM/LXC).

---

## Auto-sync configuration

1. Configure `PROXMOX_TOKEN_ID` / `PROXMOX_TOKEN_SECRET` (and optionally
   `PROXMOX_HOST`) in `backend/.env` and restart the backend.
2. Open **Settings** — a **Proxmox auto-sync** section appears once a server token
   is configured.
3. Toggle **Auto-sync Proxmox inventory** and set the interval (min 300 s).

On each run, Homelable re-imports the inventory into the pending section:
- New VMs/LXC appear as **pending** for review.
- Existing devices are **updated in place** (status, specs, IP).
- Nothing is ever deleted — a VM removed from Proxmox is left on your canvas.


---

## Supported Versions

Works with the Proxmox VE 7.x / 8.x REST API (`/api2/json`). No extra Proxmox
plugins are required.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Authentication failed" | Bad token id/secret or missing role | Re-check the token; grant `PVEAuditor` at `/` |
| "TLS verification failed" | Self-signed certificate | Uncheck **Verify TLS** (labs only) |
| "Proxmox host could not be resolved" | DNS/hostname wrong | Use the IP or a resolvable name |
| "No API token provided and none configured" | No token in the form and none in `.env` | Enter a token or set the server env vars |
| VMs have no IP | No guest agent (QEMU) / DHCP-only LXC | Install the QEMU guest agent; static IPs are read from `net0` |
| Duplicate-looking node | Same guest under a different identity | Re-import merges by IP/VMID; report if it persists |

---


