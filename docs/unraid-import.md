# Unraid Import

Connects Homelable to an Unraid server, reads the server and its Docker
containers over the Unraid API, and brings them into the Device Inventory (and,
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

**Not imported yet: VMs.** The Unraid API reports a VM's name and state only -
no NIC MAC, CPU or RAM - which is too little to match it against a device a
network scan already found.

---

## Prerequisites

1. A recent Unraid with the GraphQL API (tested on **Unraid 7.3.1**, API 4.37).
   Older releases may need the Unraid Connect plugin for the API.
2. An **API key**: *Settings > Management Access > API Keys*. Read access to
   **Docker** and **Info** is all the import needs.
3. HTTPS reachable from the Homelable backend. Unraid ships a self-signed
   certificate, so **Verify TLS certificate** is off by default. Tick it in the
   dialog (or set `UNRAID_VERIFY_TLS=true`) when the server has a trusted
   certificate, such as the `myunraid.net` address.

---

## Importing

Open **Import** in the sidebar and pick **Unraid**. Enter the host, port
(default `443`) and API key, then choose where devices go:

- **Device inventory only** - runs in the background; follow it in Scan
  History, then approve devices from the Device Inventory. Approving the
  server asks whether to bring its containers along, placed beside it and
  joined by virtual edges.
- **Inventory + canvas** - fetches immediately, lists the server and containers,
  and adds the ones you tick to the canvas. They land in the inventory too.

### Offline containers

Stopped containers can be handled three ways:

| Choice | Inventory | Canvas |
|---|---|---|
| Skip | no | no |
| Inventory only (default) | yes | no |
| Inventory + canvas | yes | yes |

In *Device inventory only* mode this is a single **Import offline containers**
checkbox.

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
UNRAID_PORT=443
UNRAID_API_KEY=xxxxxxxxxxxxxxxx
UNRAID_VERIFY_TLS=false
```

With those set, **Settings > Unraid auto-sync** turns on a scheduled import into
the pending inventory (minimum 5 minutes), chooses whether stopped containers
are included, and offers **Re-sync now**. The dialog can use the `.env` key for
the configured host and port only; any other host needs its own key.
