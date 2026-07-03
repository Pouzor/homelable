# Homelable Features

Here's what Homelable can do. One line on what each feature is, then how to switch it on and use it.

> **Two modes.** Same UI, two ways to run it:
> - **Full mode**, with the backend (Docker/LXC). Everything works.
> - **Standalone mode** (`VITE_STANDALONE=true`), no backend, canvas lives in your browser's `localStorage`. Great for just drawing; anything that needs a server (scanning, imports, device inventory, floor-plan upload, live view) is hidden.
>
> Features marked 🔒 need Full mode.

---

## Table of Contents

1. [Zones](#1-zones)
2. [Groups & Nesting](#2-groups--nesting)
3. [Text Annotations](#3-text-annotations)
4. [Multiple Canvases](#4-multiple-canvases)
5. [Customize Style](#5-customize-style)
6. [Floor Plan](#6-floor-plan-)
7. [Network Scanner (IP import)](#7-network-scanner-ip-import-)
8. [Zigbee Import](#8-zigbee-import-)
9. [Z-Wave Import](#9-z-wave-import-)
10. [Device Inventory](#10-device-inventory-)
11. [Live Status Monitoring](#11-live-status-monitoring-)
12. [Export (PNG / SVG / YAML / Markdown)](#12-export)
13. [Live View (read-only public canvas)](#13-live-view-)
14. [Gethomepage Widget](#14-gethomepage-widget-)
15. [MCP Server (AI integration)](#15-mcp-server-)
16. [Settings & Shortcuts](#16-settings--shortcuts)

---

## 1. Zones

**What:** Labeled boxes to group devices by area: "Living room", "Rack 1", "DMZ", whatever makes sense to you.

**Use:**
- Sidebar → **Add Zone**. Give it a title and a color, then drag it around and resize it.
- Drop nodes onto a zone and Homelable asks if you want to add them to it.
- Zones sit behind your nodes and move on their own. They're just there to keep things tidy.

---

## 2. Groups & Nesting

**What:** Some devices hold others, like a **Proxmox** host with its **VMs** and **LXCs** inside. Those show up as an expandable container.

**Use:**
- Drag a `vm` or `lxc` onto a `proxmox` node, confirm **Add to container**, and it becomes a child.
- Click the container header to fold it open or shut; it resizes itself around what's inside.
- The Zigbee and Z-Wave imports build the same kind of hierarchy for you (coordinator → routers → end devices).

---

## 3. Text Annotations

**What:** Loose text labels for notes, section titles, or anything you want to call out on the canvas.

**Use:** Sidebar → **Add Text**, type, drop it where you want, style it.

---

## 4. Multiple Canvases

**What:** More than one diagram in a single install, say "Network", "Home automation", "Rack layout", each with its own nodes, links, floor plan, and style.

**Use:**
- The **canvas switcher** is at the top of the sidebar. Click to jump between canvases, or **New Canvas** to start a fresh one.
- Hover a canvas to **Edit** it (name, icon, floor plan) or **Delete** it. You can't delete the last one.
- Each canvas saves on its own, so hit **Save Canvas** after you change something.

---

## 5. Customize Style

**What:** Repaint the whole thing with a preset theme, or roll your own node and edge colors.

**Use:**
- Toolbar → **Style**. Pick a preset: **Default**, **Dark**, **Light**, **Neon**, or **Matrix**.
- Or pick **Custom** and hit its **Edit** button to set border/background colors per node type and link colors per edge type.
- Theme and custom colors are saved **per canvas** on your next **Save Canvas**.

---

## 6. Floor Plan 🔒

**What:** Put a background image (a house plan, an office layout, a rack diagram) behind a canvas and lay your devices out on top of it.

**Use:**
- Open the **canvas switcher** → **Edit** the active canvas (or double-click the floor plan already on the canvas).
- In the **Floor Plan** section, upload an image and set its size and lock state.
- The image lives on the backend and is loaded by URL, never baked into the canvas, so your canvases stay light. *(See ADR-001; floor plans are Full mode only.)*

---

## 7. Network Scanner (IP import) 🔒

**What:** Point `nmap` at your network, fingerprint the services it finds, and turn hosts into nodes.

**Use:**
1. Sidebar → **Scan Network**. Scan History opens and keeps refreshing until it's done.
2. Set the CIDR ranges you want in `SCANNER_RANGES` (`.env`), or override them per scan in the dialog.
3. Whatever it finds shows up in the **Device Inventory** (below) to approve, hide, or ignore.

**Deep scan (custom ports):** to catch services on odd ports, add them in `.env`:
```env
SCANNER_HTTP_RANGES=["8080","9000-9100"]
SCANNER_HTTP_PROBE_ENABLED=true
SCANNER_HTTP_VERIFY_TLS=false
```

**Root note:** SYN scans and OS detection need root. If a scan trips on permissions, run `scripts/run_scan.py` with `sudo`, or on Linux give nmap the `NET_RAW` capability. Full details in the [README](./README.md#network-scanner).

---

## 8. Zigbee Import 🔒

**What:** Pull your **Zigbee2MQTT** topology in over MQTT and drop every device on the canvas as a typed node.

**Use:**
1. Sidebar → **Zigbee Import**.
2. Enter broker host/port (default `1883`), any credentials, and the base topic (default `zigbee2mqtt`).
3. **Test Connection** → **Fetch Devices** → pick from the grouped list → **Add N to Canvas**.

Nodes come in as `zigbee_coordinator` / `zigbee_router` / `zigbee_enddevice`. The hierarchy (coordinator → routers → end devices) and **LQI** are filled in automatically. More: [docs/zigbee-import.md](./docs/zigbee-import.md).

---

## 9. Z-Wave Import 🔒

**What:** Same idea for **Z-Wave JS UI**, over the same MQTT broker.

**Use:**
1. Sidebar → **Z-Wave Import**.
2. Enter broker host/port, any credentials, the MQTT prefix (default `zwave`), and the gateway name (default `zwavejs2mqtt`).
3. **Test Connection** → send them to **Pending** or straight to the **Canvas** → import → pick devices → **Add N to Canvas**.

Nodes: `zwave_coordinator` / `zwave_router` / `zwave_enddevice`. The hierarchy comes from each node's neighbor list (Z-Wave has no LQI). More: [docs/zwave-import.md](./docs/zwave-import.md).

---

## 10. Device Inventory 🔒

**What:** The holding pen for everything found by a scan or import that isn't on the canvas yet, plus a separate **Hidden Devices** list.

**Use:**
- Sidebar → **Device Inventory**. Each entry shows IP, MAC, hostname, and any OS and services detected.
- Per device: **Approve** to drop a typed node on the canvas, **Hide** to stash it (you can get it back), or **Ignore** to dismiss it.
- **Hidden Devices** is the sidebar entry where you review and restore anything you've hidden.

---

## 11. Live Status Monitoring 🔒

**What:** Keeps checking each node and shows its status (🟢 online / 🔴 offline / ⚫ unknown) right on the canvas.

**Use:**
- Pick a **check method** per node when you add or edit it:

  | Method | Checks |
  |--------|--------|
  | `ping` | ICMP reachability |
  | `http` | GET, OK if status < 500 |
  | `https` | GET with TLS verify |
  | `tcp` | TCP connect to `host:port` |
  | `ssh` | TCP connect to port 22 |
  | `prometheus` | GET `/metrics` |
  | `health` | GET `/health` |

- Checks run on a timer (`STATUS_CHECKER_INTERVAL`, 60s by default) and stream to the UI over WebSocket, no refresh. The sidebar footer keeps a running online/offline tally.

---

## 12. Export

**What:** Get your canvas out as a picture or as structured data.

**Use (toolbar):**
- **PNG**, a snapshot of the canvas, quality of your choice. Works in standalone too.
- **SVG**, vector export, keeps fonts, icons, and colors crisp. Same dialog as PNG.
- **Export (YAML)**, the whole canvas (nodes + links) as YAML you can re-import.
- **Markdown**, copies your device inventory as a Markdown table, handy for docs or a README.

---

## 13. Live View 🔒

**What:** A read-only, no-login snapshot of a canvas you can share on your LAN. Off by default.

**Use:**
1. Add `LIVEVIEW_KEY=your-secret-key` to `.env`, then `docker compose restart backend`.
2. Open `http://<your-homelab-ip>/view?key=your-secret-key`.

Pan and zoom only, no editing. Click a node with an IP and it opens in a new tab.

---

## 14. Gethomepage Widget 🔒

**What:** A tiny JSON stats endpoint for [gethomepage](https://gethomepage.dev)'s `customapi` widget. Off by default.

**Use:**
1. Add `HOMEPAGE_API_KEY=your-secret-key` to `.env`, restart the backend.
2. `GET /api/v1/stats/summary` with header `X-API-Key: your-secret-key` returns node counts, online/offline, pending, zigbee, and last scan time.

Widget snippet lives in the [README](./README.md#gethomepage-widget-read-only-stats).

---

## 15. MCP Server 🔒

**What:** A [Model Context Protocol](https://modelcontextprotocol.io) server so an MCP client (Claude Code, Claude Desktop, Open WebUI…) can read and change your topology. Optional, runs as its own service.

**Use:**
1. Add the keys to `.env`:
   ```env
   MCP_API_KEY=mcp_sk_changeme      # AI client -> MCP server
   MCP_SERVICE_KEY=svc_changeme     # MCP server -> backend (internal only)
   # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
2. `docker compose up -d mcp` (listens on `:8001`). No Docker? `sudo bash scripts/lxc-mcp-install.sh`.
3. Point your client at `http://<your-homelab-ip>:8001/mcp` with header `X-API-Key: <your key>`.

The AI can list nodes/edges/canvas/pending/scans, add/update/delete nodes and edges, kick off scans, and approve or hide devices. Keep port 8001 firewalled to your LAN. Full setup in the [README](./README.md#mcp-server-ai-integration-optional).

---

## 16. Settings & Shortcuts

**What:** App config and keyboard shortcuts.

**Use:**
- Sidebar → **Settings** for app-level config.
- **Search** to find nodes fast.
- Open the **Shortcuts** modal for the full key list (Save `Ctrl/Cmd+S`, undo/redo, and the rest).

---

*Installing (Docker, Proxmox LXC, source) is covered in [INSTALLATION.md](./INSTALLATION.md). Running Home Assistant? See [homelable-hacs](https://github.com/Pouzor/homelable-hacs).*
