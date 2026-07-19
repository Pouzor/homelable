# Changelog

All notable changes to **Homelable** are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [3.1.1] - 2026-07-19

### Features

- Drag to reorder services in the node detail panel. Thanks @Isilla. (#302)
- Getting Started walkthrough tour with first-run canvas detection. (#300)

### Fixes

- Round-trip Show Port Numbers on YAML export/import. (#301)
- Render error toasts on a red surface. (#300)

### Docs

- Rework README header with logo, badges, and nav links. (#300)

## [3.1.0] - 2026-07-18

### Features

- Drag to reorder node properties. (#296)
- Search for nodes and properties. Thanks @Floyddotnet. (#294)
- Widen zone modal into two columns. (#293)
- Autosave canvas after a configurable inactivity delay (opt-in). Thanks @nicolabottini. (#289)
- MCP: `design_id` on approve_device + `delete_design` tool. Thanks @nicolabottini. (#281)

### Fixes

- Scanner: decouple port discovery from version detection. (#295, #277)
- Allow undo after Auto Layout and YAML import. (#290)
- Move edge waypoints when the connected node or its container is dragged. (#288)
- Keep container host height when editing an unrelated field. (#287)
- Keep container children in place when editing a host node. Thanks @nicolabottini. (#286)
- `list_pending_devices` MCP tool leaked approved/hidden inventory rows. Thanks @MikeSviblov. (#273)

### Docs

- Fix MCP client transport to http (was sse). (#275)

## [3.0.0] - 2026-07-10

### Added

- Proxmox VE import: pull hosts, VMs and LXC into inventory, with optional scheduled auto-sync and a manual re-sync button (connection config is now env-only). (#253, #259)
- Scheduled auto-sync for Zigbee & Z-Wave imports. (#270)
- Floor plan map background, LQI-based edge coloring, and Zigbee path highlighting. Thanks @pranjal-joshi. (#207)
- Customizable connection points per node side. (#249)
- Configurable edge line style + width per type and per edge, plus selectable endpoint marker shapes. (#250, #252)
- Create a new canvas by copying an existing one. (#257)
- Prompt on duplicate device instead of silently blocking/merging on approve. (#261)
- Active design synced to URL for refresh/share. (#263)
- MCP can target a specific design/canvas, create canvases, and auto-position nodes with auto-assigned edge handles. Thanks @nicolabottini. (#266)

### Fixed

- Mesh (Zigbee/Z-Wave) import: duplicate-node crash and coordinator now routed to pending. (#247)
- Keep mesh/cluster links so edges resolve onto a second canvas. (#254)
- Preserve edge connection points in YAML export/import. (#255, #208)
- Harden media path handling against path injection. (#256)
- Match scanned devices to canvas nodes by ip-token and MAC. (#262, #258)
- Record ScanRun for scheduled Proxmox auto-sync. (#269)

### Docs

- User-facing FEATURES.md. (#248)
- CHANGELOG with full release history. (#264)

## [2.6.1] - 2026-06-30

### Added

- Z-Wave nodes can be added/edited manually. A Z-Wave group (Controller / Router / End Device) is now in the Add/Edit node type selector, matching Zigbee. Mesh-radio nodes default to no status check.

### Fixed

- Standalone (frontend-only) multi-canvas (designs) support, originally merged in #244 after the 2.6.0 tag with no version bump.

## [2.6.0] - 2026-06-28

Device Pending is gone — replaced by **Device Inventory**: devices stay in an inventory, can be placed in multiple canvases, rescanned and updated. New **Z-Wave** section: scan, import and store Z-Wave devices like Zigbee.

### Added

- SVG export option in the canvas export modal, alongside PNG (#238).
- Deep-scan HTTP probe + Device Inventory: scans probe HTTP services and surface a per-device inventory (#222, closes #195).
- Z-Wave network scan via the MQTT bridge (#224).
- Inventory timestamps on nodes — nodes show when their inventory was last collected (#233).
- New nodes drop at the centre of the visible canvas instead of off-screen (#234).
- Expanded MAC OUI database: router, switch, AP, NAS and camera vendor prefixes (#220).

### Fixed

- Optional white background on export and working downloads in Firefox (#239, closes #165).
- MCP-created nodes/edges attach to the active design instead of floating (#237, closes #225).
- Stopping a scan interrupts the running nmap range immediately (#236, closes #218).
- Auto-layout orders Proxmox children by parent port number (#235).
- Copy-to-clipboard for Markdown works on non-secure HTTP origins (#219).

### Docs

- Documented the `SCANNER_HTTP_RANGES` port-spec format (#232).

## [2.5.1] - 2026-06-18

### Fixed

- Manually resized nodes — including VM/LXC nodes nested inside a Proxmox container — keep their size on reload instead of snapping back to content-fit.
- Node detail panel has a Size section for pixel-exact width/height; fields resync live when dragging a corner handle.
- Adding an LXC/VM under a non-container-mode Proxmox node no longer confines it to a tiny box — it stays a free, draggable node.

### Security

- Resolved high-severity npm audit advisories (`esbuild`, `form-data`, `vite` → 7.3.5).
- Bumped `python-multipart` to 0.0.31 (CVE-2026-53538/53539/53540).

## [2.5.0] - 2026-06-11

### Added

- Scan History modal with run duration, finished timestamp, and kind/status filters (#203).
- Container nesting: drag a node onto a container node to nest it; detach/re-parent via an editable container selector (#202).
- Editable node groups: add/remove members and edit the group description directly (#200).
- Multi-line edge labels (#199).
- Per-service status checks with offline colouring (#198).

### Fixed

- Reduce status flapping, add IPv6 ping, colour manually-added web services (#198).
- Keep non-HTTP services grey instead of red (#198).
- Idempotent WebSocket connection removal — release the slot on any error (#198).
- Persist group description with Ctrl+S, not only on blur (#200).

### Security

- Resolve Dependabot and code-scanning alerts; bump hono to 4.12.21+ (#197).
- Bump zeroconf to 0.149.12 for CVE-2026-48045 (#202).

## [2.4.0] - 2026-06-05

### Added

- Multiple designs (canvases): build and switch between separate diagrams, plus a new electrical-device node type (#177).
- Copy & paste nodes between designs (#189).
- Switch port numbers (up to 64 ports) plus a new fibre-optic link style (#172).
- Read-only Live View link in the header for sharing or wall displays (#185).
- Scans keep discovered MAC addresses when a device is approved (#178).
- Richer AI/MCP control: assistants can set the full set of node fields on create/update (#180).

### Changed

- Settings moved into a dedicated window for a cleaner sidebar (#188).
- "Hide IP" option now lives in Settings and is remembered between sessions (#189).
- Smoother link animations for flowing/snake styles (#187).

### Fixed

- "Show Port Numbers" now persists after reload (#191).
- The Save button works again (previously only Ctrl/Cmd+S) (#190).
- Zigbee re-import correctly brings back already-approved devices (#176).

### Security

- Dependency updates: zeroconf, qs, brace-expansion (#175, #182).

## [2.3.0] - 2026-05-31

### Added

- Full node schema over MCP: `create_node` / `update_node` expose the complete backend schema (`os`, `notes`, `mac`, `services`, `cpu_count`, `cpu_model`, `ram_gb`, `disk_gb`, `properties`, …); `get_canvas` round-trips the same fields (#174).
- MAC carried onto approved nodes from a scan (#168).
- Richer switch & edge modeling: switch port cap raised to 64, port numbers shown, new fibre edge type.

### Fixed

- Canvas includes the MAC property on the approved node so it shows immediately after approval (#168).
- Zigbee: revive orphaned approved devices on re-import instead of dropping them (#167).

### Security

- Bump `zeroconf` 0.131.0 → 0.149.7 for CVE fixes.

## [2.2.0] - 2026-05-29

### Added

- Laptop & mobile node types with theme-coherent styling (#166).
- Collapsible / expandable zones — `collapsed` is now a first-class `NodeData` field with edge rewiring and read-only liveview support (#158).
- LXC / bare-metal MCP install script `lxc-mcp-install.sh` with env-var overrides and repo-clone fallback; MCP image published to GHCR (#163).

## [2.1.1] - 2026-05-16

### Fixed

- LiveView: nest Docker container children under their host node; apply saved theme & custom style on load.

## [2.1.0] - 2026-05-16

### Added

- Draggable edge endpoints — reconnect either end of an edge to another node/handle; Proxmox containers gain snap points (#150).
- Docker containers can live inside VMs, Proxmox hosts or LXCs; parent auto-cleaned on type change (#153, #154).
- Group node side handles (top/right/bottom/left) for proper edge attachment (#152).
- Multiple IPs per node — paste several IPs separated by comma/space/newline, each clickable individually (#136).
- Zigbee device properties (IEEE, Vendor, Model, LQI) auto-populated on approve / re-import (#148).
- Homepage widget stats endpoint: new `/stats` API for gethomepage integration (closes #131, #149).
- Zone modal polish: centered opacity thumb, fixed font casing, full keyboard + ARIA support (#106).

### Security

- Dropped `passlib` in favour of direct `bcrypt`; status-check targets reject CLI-flag injection.

## [2.0.3] - 2026-05-13

### Changed

- Remove check method for Zigbee nodes.

## [2.0.2] - 2026-05-11

### Added

- Activated dashboardicons icons — brand-new icons selectable for nodes.

### Fixed

- Various modal fixes.

## [2.0.1] - 2026-05-11

### Added

- New Zigbee nodes available in the new/edit node modal.

## [2.0.0] - 2026-05-11

A major milestone: Zigbee2MQTT integration, a new pending-devices modal, text nodes and alignment guides.

### Added

- **Zigbee2MQTT integration** (thanks @pranjal-joshi): import a full Zigbee network map from Z2M as a background scan run; three new node types (Coordinator, Router, End Device); MQTT TLS with optional cert-verify skip; imported devices flow through the pending section with edge persistence.
- **New pending devices modal**: full-screen grid with cards, filters (IP / Zigbee / all), search, multi-select and bulk restore.
- **Text node type** for free-form annotations (#138).
- **Alignment guides + snap** while dragging nodes, built on `OnNodeDrag` (#139).
- **Per-node services toggle** to show/hide the services list on the node (thanks @findthelorax) (#107).
- Zigbee node types exposed in the Custom Style editor.

### Fixed

- Status checker: ms timeout for ping on macOS.
- Scan: default `check_method='ping'` for approved devices.
- Detail panel: handle non-Z timezone offsets in Last Seen.
- Groups: preserve children + size on edit; fix status WebSocket proxy.
- Pending: drop dangling `onNodeApproved` call; null-safe pending IP in SearchModal.
- Text node: persist text in `label` across reloads.

### Security

- Bump `fast-uri` (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc), `axios` ^1.15.2, `python-multipart`.
- Sanitize MQTT error messages to prevent credential leakage.

## [1.13.0] - 2026-05-03

### Added

- New **Firewall** node type under Add Node → Hardware, with distinct flame icon and red accent.
- Up to **48 bottom connection points** per node (slider, previously capped at 4); the node card grows wider as handles are added.

### Fixed

- Sidebar no longer freezes on Scan History after starting a scan.
- Delete confirmation respects Cancel — clicking Cancel keeps the modal open.

## [1.12.0] - 2026-04-24

### Added

- **Custom Style Editor**: per-node-type border/background/icon colour + opacity, per-edge colour/opacity/path/animation, default size per type, "Apply to existing nodes" and "Apply All to Canvas"; saved with the canvas.

### Changed

- Accessibility overhaul: consistent hover/focus borders, pointer cursors, keyboard navigation and Enter-to-apply across all modals (#108).
- IP address hint moved below the field; hover border colour toned down.

### Fixed

- Edge labels and the `+` waypoint handle stay on the routed path when waypoints are used (#94).
- Edge type select displays its full label (e.g. "IoT / Zigbee") instead of the raw value.
- Status dot overlapping IP address in node cards.
- Canvas style modal layout on smaller screens.
- MCP session manager routing.

## [1.11.0] - 2026-04-23

### Added

- **Docker Host** node type with container mode support (visual group for containers).
- **Docker Container** node type, nestable inside a Docker Host.
- Container mode now works for `docker_host`, `vm` and `lxc` (was Proxmox-only).

### Changed

- Service badges prioritise the service name; path truncates gracefully with a hover tooltip.
- Node resizer handle hit area enlarged (8px → 16px).

### Fixed

- Container mode not persisting after save/reload for non-Proxmox types.
- Container mode toggle having no visual effect on `docker_host` nodes.
- Status dot overlapping node content; consistent top-right placement.
- Missing icon/label gap in ProxmoxGroupNode container header.
- IP shown unmasked in ProxmoxGroupNode when hide-IP is enabled.

## [1.10.2] - 2026-04-21

### Added

- **Logout button** at the bottom of the sidebar (normal mode only).

### Fixed

- Pending Devices checkbox click no longer opens the approval modal.
- NaN sent to the API when the status-check interval input is cleared.
- Potential open-redirect in the update badge (release URL scheme now validated).

## [1.10.1] - 2026-04-20

### Added

- PNG export quality selector: Standard (1×), High (2×, default), Ultra (4×) (#89).
- Zone colour opacity sliders for text/border/background (#72).
- Optional service paths (e.g. `/admin`) appended to the clickable URL; port optional when a path is set (thanks @findthelorax) (#86).

### Fixed

- Bulk-approved nodes appear on canvas immediately (node IDs were null before DB flush).
- Proxmox container mode: visible properties now shown; custom icon now applied.
- `approve_device` returns 404 on missing device, 409 on double-approve (was 200).
- Node form no longer retains previous-session values when reopened in Add mode (#87).

## [1.10.0] - 2026-04-19

### Added

- Bulk approve/hide pending devices (#70).
- IPv6 support & multiple comma-separated IPs per node (#60).
- Clickable IP addresses in the detail panel (#78).
- Connection handles on zone/group rect nodes (#58).
- Automatic DB backup before schema migrations.
- Drag group from its title (#76); double-click a node to open its edit modal (#65).

### Fixed

- Node width no longer expands when long content overflows after a user resize.
- Proxmox nodes with `container_mode=false` restore their saved width on reload.
- Added curl to the backend image for the default healthcheck.

## [1.9.0] - 2026-04-09

### Added

- **Node properties system**: dynamic key/value/icon/visible properties replacing static hardware fields; visible ones shown on the node card; 20 Lucide icons; existing hardware data auto-migrated.
- **Edge waypoints**: click `+` to add, drag to move, double-click to remove; Bezier and Smooth step supported; persisted to backend.
- **Basic edge animation** mode (native moving-dash), alongside Snake and Flow.
- App version shown in sidebar with a GitHub release update check.

### Fixed

- Node height no longer overflows when properties are added to a resized node.
- Dot grid alignment with the snap grid.
- Node selection layout shift.

## [1.8.3] - 2026-04-06

### Added

- Finer canvas grid: snap reduced from 16px to 8px.

### Changed

- Updated frontend npm dependencies; upgraded lucide-react; removed unused Proxmox/LXC install scripts.

## [1.8.2] - 2026-04-05

### Fixed

- Scan no longer starts before confirmation — "Scan Network" opens the config modal first.
- Windows ping compatibility (`-n 1 -w 1000` instead of Linux/macOS flags).

## [1.8.1] - 2026-04-05

### Added

- Search now includes pending devices in both the canvas search bar (Ctrl+F) and command palette (Ctrl+K).

### Fixed

- Timestamps (scan history, discovery time, Last Seen) now show local time instead of UTC.

## [1.8.0] - 2026-04-04

### Added

- Configurable 1–4 bottom connection points per node.
- Fit view on load.
- Inline Type and Icon pickers in the node modal.

### Changed

- **Scanner rewrite**: Phase 1 concurrent asyncio ping sweep (50 parallel pings) supplemented by `/proc/net/arp`; Phase 2 explicit `-sS`/`-sT` scan type with 60s host-timeout; resilient gather so one failing host no longer aborts the batch.

### Fixed

- Root logger StreamHandler so `app.*` logs are visible in Docker.
- CIDR validation on frontend and backend to prevent nmap argument injection.
- Pre-fetch canvas/hidden IPs before the scan loop (no N+1 queries); ARP table read off the event loop.
- Hide/ignore on a missing device returns 404 instead of 500.

## [1.7.1] - 2026-04-02

### Added

- Concurrent status checks via `asyncio.gather`, ending "maximum instances reached" spam.
- Improved IoT detection: two-phase nmap scan finds Shelly, Sonoff, Tapo devices with no open TCP ports.
- mDNS/Bonjour discovery (`_shelly._tcp`, `_esphomelib._tcp`, `_hap._tcp`, `_mqtt._tcp`, …) in parallel with nmap.
- 20+ IoT vendor MAC OUIs and CoAP ports added; IoT ranked above generic server.

### Fixed

- LXC/VM container mode: attaching to a Proxmox no longer creates a spurious edge; nesting is instant.
- Scheduler reliability: DetachedInstanceError, duplicate timestamps, shutdown handling, interval validation.

### Dependencies

- Added `zeroconf==0.131.0` for mDNS discovery.

## [1.7.0] - 2026-04-01

### Added

- **Lasso / box selection** — draw a rectangle to select multiple nodes; hold Space to pan; lasso/pan toggle in the controls.
- **Named groups** — group 2+ nodes into a resizable, renamable container with hide-border option and per-member navigation; persisted across save/reload.
- **Canvas search (Ctrl+F)** — filter nodes by label, IP, hostname, service; live match count; click to fly the camera.

### Fixed

- LXC install script: `apt-get update` runs verbosely with `--fix-missing` to handle stale Debian mirrors (fixes #36).
- Group parent/child relationships restore after save + reload.
- Removed React Flow's default grey background from container node types.

## [1.6.0] - 2026-03-30

### Added

- Scan deduplication — pending devices already on canvas or hidden are skipped on rescan; stale entries purged at scan start.
- Dedicated Settings panel (status-check interval moved out of the Scan Config modal).
- Live interval update without a server restart.
- Separate `/api/v1/settings` endpoint for the check interval.

### Fixed

- DEL key deletes selected nodes (previously Backspace only).
- Node deletion via shortcut/detail panel is undoable with Ctrl+Z.
- APScheduler guards against double-start and unguarded reschedule calls.

## [1.5.0] - 2026-03-29

### Added

- Inline service editing in the detail panel (pencil icon).
- Edge animation modes: None, Snake, Flow — fully persisted.
- Zone improvements: rename Rectangle → Zone, border-width selector, label position, text-size options.

### Fixed

- Edge animation not saved on new connections.
- Backend 422 when saving canvas with string animation values.
- Snake and Flow animations rendering identically in production.
- Login returned 500 instead of 401 when a bcrypt hash had `$` stripped by the shell (#21).
- Hardcoded CORS in docker-compose; clearer login error messages.

## [1.4.0] - 2026-03-28

### Added

- **Live View** — share a read-only view of the canvas on your network, no login required.
- Resizable nodes with persisted width/height.

### Fixed

- QEMU arm64 crash during Docker image build (`npm ci` illegal instruction on ARM64).
- nginx `reload-or-start` fallback broken on fresh LXC installs.

### CI

- ShellCheck + hadolint linting; Docker smoke tests and full-stack integration tests.

## [1.3.3] - 2026-03-27

### Fixed

- Scan failures on fresh Docker installs — `service_signatures.json` moved into the app package so the volume mount no longer overwrites it.
- Missing `ping` on Docker (`iputils-ping` added).
- Thread-safe signature-file loading; clear error if the file is missing.
- CORS restricted to the HTTP methods/headers the frontend uses.

## [1.3.2] - 2026-03-27

### Fixed

- Ping check method on fresh Docker installs — `iputils-ping` added to the backend image (`python:3.13-slim` ships without `ping`).

## [1.3.1] - 2026-03-27

### Added

- **YAML import/export** of the full canvas topology (nodes, edges, hardware specs, connections); import merges without overwriting; Dagre auto-layout on import; toolbar Import/Export buttons.

### Fixed

- ESLint 10 incompatibility from `npm audit fix` — pinned back to ESLint 9.x.

### Docs

- Split installation into `INSTALLATION.md`; documented the network scanner and dev mode.

## [1.3.0] - 2026-03-21

### Added

- Hardware specs per node (CPU model, cores, RAM, Disk) with "Show on node" and GB → TB formatting.
- `Docker Host` node type (Anchor icon), themed across all 5 themes.
- Group rectangle border style: Solid, Dashed, Dotted, Double, None.
- Categorized node-type selector (Hardware / Virtualization / IoT / Generic).

## [1.2.2] - 2026-03-17

### Added

- `scripts/update.sh` for fast in-place LXC updates (never touches `.env` or DB).

### Fixed

- `crypto.randomUUID` crash on HTTP/LXC installs — polyfill fallback.
- WebSocket failure on LXC (hardcoded port 8000 bypassing Nginx); added `/api/v1/status/ws/` upgrade block.
- Production build crash on LXC (test files in `tsconfig.app.json`).

### Security

- JWT no longer exposed in the WebSocket URL — sent as the first message after connect.

## [1.2.1] - 2026-03-16

### Added

- **MCP server** with HTTP/SSE transport for AI integration (Claude Code compatible); `parent_id` exposed in `update_node`; service-key auth for MCP → backend.

### Fixed

- "Add node" appeared broken with an empty Label — native validation doesn't render in Radix Dialog portals; now shows an inline error.
- SSE streaming crash; reduced `get_canvas` token usage.

## [1.2.0] - 2026-03-13

### Added

- Edge flow animation (per-edge toggle); Proxmox cluster edges animate bidirectionally.
- Keyboard shortcuts: Undo/Redo, Ctrl+K search, copy/paste, Ctrl+S save, `?` reference.
- Canvas history (50-entry undo/redo stack) with toolbar buttons.
- Node search spotlight (Ctrl+K) with fuzzy match and fly-to.
- Copy/paste nodes (Ctrl+C / Ctrl+V) with 50px offset and fresh IDs.
- Markdown table export of the node inventory.
- Clickable hostname in the detail panel.
- Shortcuts reference modal.

## [1.1.1] - 2026-03-11

### Added

- New logo and favicon; page title updated to Homelable.
- **Hide IPs** toggle in the sidebar — masks the last two octets.

### Fixed

- Auto-layout: peer nodes placed on the same row (no staircase); correct left-to-right ordering; child nodes always below their parent.

## [1.1.0] - 2026-03-10

### Added

- **Group rectangles** — decorative resizable zones with configurable label/font/position/colours and z-order; saved with the canvas.
- Add/remove services manually in the detail panel.
- All TCP services now clickable (HTTPS auto-detected for 443/8443; non-web ports excluded).

## [1.0.0] - 2026-03-09

First stable public release of **Homelable**, a self-hosted homelab visualization tool.

### Added

- **Canvas**: interactive React Flow diagram; 11 node types; 5 edge types; Proxmox nested nodes; Dagre auto-layout; zoom/pan; snap-to-grid; PNG export.
- **Network discovery**: nmap scanner over CIDR ranges; pending-device queue (approve/hide/ignore); service fingerprinting; MAC OUI detection for QEMU/Proxmox/VMware.
- **Status monitoring**: per-node ping/http/https/tcp/ssh/prometheus/health checks; live WebSocket updates; scheduled background checks.
- **Auth & persistence**: single-user JWT auth (bcrypt in `.env`); SQLite canvas state with an explicit Save button.
- **Standalone mode**: backend-free diagram editor with localStorage persistence.
- **Install options**: Docker Compose, Proxmox LXC, manual Debian/Ubuntu script.

[2.6.1]: https://github.com/Pouzor/homelable/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/Pouzor/homelable/compare/v2.5.1...v2.6.0
[2.5.1]: https://github.com/Pouzor/homelable/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/Pouzor/homelable/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/Pouzor/homelable/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/Pouzor/homelable/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Pouzor/homelable/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/Pouzor/homelable/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/Pouzor/homelable/compare/v2.0.3...v2.1.0
[2.0.3]: https://github.com/Pouzor/homelable/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/Pouzor/homelable/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/Pouzor/homelable/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Pouzor/homelable/compare/v1.13.0...v2.0.0
[1.13.0]: https://github.com/Pouzor/homelable/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/Pouzor/homelable/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/Pouzor/homelable/compare/v1.10.2...v1.11.0
[1.10.2]: https://github.com/Pouzor/homelable/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/Pouzor/homelable/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/Pouzor/homelable/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/Pouzor/homelable/compare/v1.8.3...v1.9.0
[1.8.3]: https://github.com/Pouzor/homelable/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/Pouzor/homelable/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/Pouzor/homelable/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/Pouzor/homelable/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/Pouzor/homelable/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/Pouzor/homelable/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Pouzor/homelable/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Pouzor/homelable/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Pouzor/homelable/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/Pouzor/homelable/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/Pouzor/homelable/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/Pouzor/homelable/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Pouzor/homelable/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/Pouzor/homelable/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Pouzor/homelable/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Pouzor/homelable/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Pouzor/homelable/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Pouzor/homelable/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Pouzor/homelable/releases/tag/v1.0.0
