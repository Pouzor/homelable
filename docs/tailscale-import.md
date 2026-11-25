# Tailscale Import

Reads every device on a Tailscale tailnet over the Tailscale API and brings it
into the Device Inventory with its tailnet address. It can also **sync** on a
schedule.

> **Server-dependent feature** - requires the Homelable backend. It is hidden in
> the no-backend standalone/demo build.

---

## What is imported

Each device on the tailnet becomes one pending inventory entry:

- **Address**: the tailnet IPv4 (`100.x.y.z`) goes in the device's IP field.
- **Name**: the machine name (the first label of its MagicDNS name) and the
  hostname the device reports.
- **Type**: a guess from the OS (Linux is a server, Windows and macOS are
  computers, iOS and Android are mobiles). Change it when you approve.
- **OS**: the distribution and version when Tailscale reports them, else the OS.
- **Properties**, hidden until you show them from the right panel: Tailscale
  IP, IPv6, MagicDNS name, online status, last seen, client version, user,
  tags, approved subnet routes, exit node (advertised or approved), key expiry,
  whether the device is shared in, and the endpoints the client reports.

Devices shared in from another tailnet are left out unless you ask for them.
A tag filter imports only devices carrying one of the tags you list.

---

## Prerequisites

A credential that can read the tailnet's device list. Either:

- **An OAuth client** (recommended). In the Tailscale admin console open
  *Settings > Trust credentials*, click **+ Credential** and choose **OAuth**.
  The description may only contain letters and numbers (for example
  `HomelableImport`). Under scopes tick **Devices > Core > Read**, and
  **Routes > Read** if you want each device's advertised subnet routes and
  exit-node status. Leave every write scope off. Generate the credential and
  copy the client ID and secret straight away: the secret is shown only once.
  The credential cannot change anything and does not expire.
- **An API access token**, from *Settings > Keys*. It carries its owner's full
  rights and expires after at most 90 days.

The Homelable backend needs to reach `api.tailscale.com` over HTTPS. It does
not need to be on the tailnet to import, only to ping the `100.x` addresses
afterwards.

---

## Importing

Open **Import** in the sidebar and pick **Tailscale**. Choose the credential
type, paste it (or leave it blank to use the one in the server `.env`), and
optionally set:

- **Tailnet**: blank uses the credential's own tailnet (`-`).
- **Only these tags**: a comma-separated list such as `tag:server, tag:nas`.
  `tag:` is added when you leave it out.
- **Include devices shared in from other tailnets**.

**Test Connection** reports how many devices the import would bring in.
**Import to Inventory** runs the import, records it in Scan History and opens
the Device Inventory, where you approve devices onto a canvas.

---

## Addresses and matching

Tailscale reports no MAC address, and Homelable does not match devices on
hostname (unrelated machines often share names like `ubuntu`). So a machine
that an IP scan found on the LAN and that Tailscale also reports arrives as
two entries. Merge them once from the Device Inventory:

- The merged entry keeps both addresses, LAN first, so status checks keep
  probing the LAN address.
- Later syncs find the merged entry, either by its `tailscale-…` id or by its
  tailnet address. That holds even when the merge kept another importer's id
  (a Proxmox guest's `pve-…`, say), so the duplicate does not come back.
- When Tailscale gives the device a new tailnet address, the old one is
  replaced in the merged entry.

Only the tailnet IPv4 is ever stored as an address or used for matching. The
endpoints the client reports include Docker bridge addresses such as
`172.17.0.1`, which repeat on every Docker host, so they stay a hidden
property.

An entry already keyed to another Tailscale node is never matched by
address, because Tailscale can give a deleted node's address to a new one.

Re-importing updates entries in place and never deletes anything. A hidden
entry stays hidden. An approved entry that no canvas draws any more returns to
pending.

---

## Auto-sync

The credential lives in the server `.env` only. It is never written to disk by
the app and never returned by the API. Set one of the two:

```env
TAILSCALE_OAUTH_CLIENT_ID=
TAILSCALE_OAUTH_CLIENT_SECRET=
# or
TAILSCALE_API_KEY=
# TAILSCALE_TAILNET=-
```

With a credential set, **Settings > Tailscale auto-sync** turns on a scheduled
import into the pending inventory (minimum 5 minutes), sets the tag filter and
whether shared-in devices are included, and offers **Re-sync now**.
