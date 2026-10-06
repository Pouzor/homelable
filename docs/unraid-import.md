# Unraid Import

Connects Homelable to an Unraid server, reads the server, its Docker
containers and its VMs over the Unraid API, and brings them into the Device Inventory (and,
optionally, onto the canvas) as typed nodes. It can also **sync** on a schedule.

> **Server-dependent feature** - requires the Homelable backend. It is hidden in
> the no-backend standalone/demo build.

---

## What is imported

- **The server** as a `docker_host` node: hostname, LAN IP, NIC MAC, board
  maker/model, CPU model and thread count, Unraid version.
- **Every Docker container** as a `docker_container` node, linked to the server
  with a `virtual` edge. Each container carries hidden-by-default properties:
  Image, Network, Ports and, for containers started by a Compose plugin,
  Compose Project.
- **The container's web UI** (the WebUI address from its Unraid template) as a
  **Web UI** service on the node, so it shows up as a link and, with service
  checks on, gets checked. Unraid resolves the address to the server IP; a
  container with its own LAN IP gets that IP instead, since that is where it
  answers. Re-imports refresh the address but keep a name or icon you gave it.

Containers managed by Unraid's own Docker page and containers started by a
Docker Compose plugin are both listed by the API and imported the same way.

- **Every VM** as a `vm` node, linked to the server with a `virtual` edge and
  keyed on its libvirt UUID (a hidden **UUID** property). The Unraid API reports
  a VM's name and run state only - no NIC MAC, IP, vCPUs or RAM - so a VM is
  never matched to a device a network scan already found. If a scan found the
  VM first, merge the two rows from the Device Inventory.

If the API key cannot read VMs, the containers still import and the dialog
(or the Scan History entry) says why VMs were left out.

---

## Prerequisites

1. A recent Unraid with the GraphQL API (tested on **Unraid 7.3.1**, API 4.37).
   Older releases may need the Unraid Connect plugin for the API.
2. An **API key**: *Settings > Management Access > API Keys*. Read access to
   **Docker**, **VMs** and **Info** is all the import needs.
3. The server reachable from the Homelable backend over HTTP or HTTPS. Unraid
   serves plain HTTP unless *Settings > Management Access > Use SSL/TLS* is on,
   so **Use HTTPS** is off by default; over HTTP the API key travels
   unencrypted. With HTTPS, Unraid's own certificate is self-signed, so
   **Verify TLS certificate** is off too; tick it when the server has a trusted
   certificate, such as the `myunraid.net` address. Picking the wrong scheme
   gets a message saying which one the server wants.

---

## Importing

Open **Import** in the sidebar and pick **Unraid**. Enter the host, port
(blank for 80, or 443 with **Use HTTPS**) and API key, then choose where devices go:

- **Device inventory only** - runs in the background; follow it in Scan
  History, then approve devices from the Device Inventory. Approving the
  server asks whether to bring its containers and VMs along, placed beside it and
  joined by virtual edges.
- **Inventory + canvas** - fetches immediately, lists the server, containers and VMs,
  and adds the ones you tick to the canvas. They land in the inventory too.

### Stopped containers and VMs

**Include stopped containers and VMs** (on by default) means the same in both
modes: stopped devices are imported like running ones and, in *Inventory +
canvas* mode, listed for the canvas. Untick it to leave them out of both.

As with the Proxmox import, *Inventory + canvas* adds everything it lists to
the Device Inventory when you fetch, including devices you then untick before
adding to the canvas.

---

## Addresses and matching

Docker networking decides what address a container has:

- **Bridge / custom networks** (the default): the container's `172.x` address is
  internal to the server and its MAC changes every time Unraid recreates it, so
  neither is stored. Reach it through the server IP and the published ports in
  the **Ports** property.
- **`br0` / custom macvlan or ipvlan networks**: the container has its own LAN
  IP, which is stored. With **ipvlan** (Unraid's default for `br0`) every
  container shares the server's MAC, so the MAC is never used for these.
- **`host`**: no address of its own; it is the server.
- **`container:<name>`**: shares another container's network (e.g. a VPN
  sidecar); the **Network** property names that container.

A container is identified by the server's UUID plus the container *name*, since
Unraid gives a container a new Docker id on every update. Re-importing updates
devices in place and never deletes anything; a hidden device stays hidden.

An existing inventory row is reused, in this order, when it has the same
identity, the same IP and MAC, the same IP (rows no other importer claimed), or
the same MAC - so a server or `br0` container an IP scan found first is merged,
not duplicated.

---

## Auto-sync

Connection settings live in the server `.env` only. The API key is never
written to disk by the app and never returned by the API.

```env
UNRAID_HOST=192.168.1.20
UNRAID_API_KEY=xxxxxxxxxxxxxxxx
UNRAID_USE_HTTPS=false
# UNRAID_PORT=80        # defaults to 80, or 443 with UNRAID_USE_HTTPS=true
UNRAID_VERIFY_TLS=false
```

With those set, **Settings > Unraid auto-sync** turns on a scheduled import into
the pending inventory (minimum 5 minutes), chooses whether stopped containers
and VMs are included, and offers **Re-sync now**. The dialog can use the `.env` key for
the configured host and port only, and never over HTTP when
`UNRAID_USE_HTTPS=true`; any other host needs its own key.
