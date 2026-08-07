# Rack canvas

A rack canvas is a design of `design_type: 'rack'` — the physical counterpart to
the logical network canvas. It lives in the same shell: same header, same left
rail, same right panel, same design switcher. `App` swaps the renderer when the
active design is a rack.

Create one from **New Canvas → Kind → Rack**.

## Model

| Concern | Choice |
|---|---|
| Vertical | `uStart` (1-based, **always counted from the bottom rail**) + `uHeight`. `numbering` only changes the printed labels. |
| Horizontal | 12-column grid (`RACK_COLUMNS`). Full = 12, half = 6, third = 4, quarter = 3 — so 2 or 3 machines share one U. |
| Collision | `canPlace` / `findSlot` in `layout.ts`. A drop snaps to the nearest free slot; an impossible drop shows a red preview. |
| Inventory | A mount references a **Device Inventory** entry (`pending_devices`) via `deviceId`. Those rows survive approval *and* node deletion, so unracking never removes the device. Accessories (blank, shelf, cable manager) have `deviceId: null`. `label` comes from `_device_label` in `racks.py`, which mirrors `deviceLabel` in `PendingDevicesModal.tsx` (friendly name → host → app the ports say it runs → IP → IEEE → id) so a device is named the same in both lists. |
| Rack-created gear | A device created from this canvas is a normal inventory row with `discovery_source: "rack"`, so it inherits the inventory's search, filters, hide and delete. It shows under the **Rack devices** source filter, and both `POST /scan/pending/{id}/approve` and bulk-approve refuse it — a mount is not a host to document on a logical canvas. Its `suggested_type` comes from the plate it wears (`deviceTypeForFaceplate`), since no scan is there to guess one: without it the row had no icon, no role badge and no place in the type filter. Passive gear uses the rack-only kinds `patch_panel` and `pdu` — the logical canvas has no node type for it, and `pdu` must not be `socket`, which is excluded from the rack inventory. |
| Picking one | The **Device Inventory entry** field opens the real Device Inventory modal (`PendingDevicesModal` in picker mode: a card click returns the device, bulk/clear controls are hidden) rather than a flat `<select>`, so the user gets its search, source/type filters and per-card detail. It opens with the **Rackable** filter armed — hardware only, `UNRACKABLE_TYPES` in `utils/rackable.ts` mirroring `_UNRACKABLE_TYPES` in `racks.py`, with `test_rackable_sync.py` failing on drift. The rack side still has the last word: a device missing from its own list, or already mounted in this design, is refused with a toast. Standalone keeps the `<select>` — no backend, no inventory modal. |
| Canvas node link | `nodeId` is a second, optional link to a logical-canvas node, resolved server-side by IEEE then IP. It supplies live status and lets the network-link import match endpoints. Never required. |
| Status | A mount stores a `MountStatus`: `online` / `offline` / `unknown` pinned by hand, or `auto` — "check device", i.e. follow the status check already configured on the matching canvas node (ping, http, ssh…). The rack runs no checker of its own; `auto` resolves through the inventory entry's `node_status` (`resolveDeviceStatus` in `deviceStatus.ts`) and falls back to `unknown` when nothing is behind it. The Status select offers `auto` only when the mount — or the entry being picked — resolves to a node, and drops back to `unknown` when that link is lost. `useAutoStatusRefresh` polls the inventory every 60 s while at least one mount is on `auto`, and only then; the refresh writes inventory only, so autosave stays quiet. |
| Faceplates | Declarative templates in `faceplates.ts`, drawn as SVG in unit coordinates so a plate scales with U height and rack width. Applying a template seeds ports; the user edits them afterwards. `suggestFaceplate()` picks one from the device's discovery type. Chosen from `FaceplatePicker` — a visual catalog, not a `<select>`: every template is drawn with the canvas renderer at its real relative width and U height, grouped, searchable, and filterable by `kind` (accessories are offered only to accessories). |
| Ports | RJ45 and SFP/SFP+ only, drawn as real jack artwork at a fixed pixel size so plates of different U heights line up. Manual list per device. Power outlets are artwork, never a cable endpoint. |
| Port visibility | Patch-facing gear (switches, patch panels) shows its ports permanently. Everything else reveals them on hover, on selection, or when cables are on — a cable never ends on an invisible port. |
| Plate zones | Each template reserves three non-overlapping bands: status LED (fixed left), `labelBox` (name, clipped), then artwork and ports. A test asserts no port lands on the name band. `labelBox.y` (default 0.5) moves the name band *and* the LED off mid-height — desktop NAS boxes are drive doors over a badge strip at the bottom. |
| Cables | Port-to-port, a relation of their own — not React Flow edges. One cable per port. Drawn in a `ViewportPortal` so they pan/zoom with the canvas and can cross racks. |
| Cable visibility | Hidden by default; shown on hover/selection, or all-on via patch mode / the header. Plates fade to 40 % when cables are on. Copper vs fibre follows the port the patch starts from. |
| Colours | `rackTheme.ts` derives the whole rack palette from the active app theme rather than declaring one per theme, so a new theme works here for free. Per-rack chrome (frame, rails, interior) stays user-editable; only its default comes from the theme. |

## Persistence

Explicit save, like the logical canvas — plus the same opt-in autosave, which
debounces on the store's `editSeq`.

| Where | What |
|---|---|
| `racks`, `rack_devices`, `rack_cables` | One row set per design. `rack_devices.device_id → pending_devices` and `node_id → nodes` are both `ON DELETE SET NULL`, and `label` is denormalized, so a rack keeps rendering after an inventory purge. |
| `canvas_state.viewport` | Pan/zoom, shared with the logical canvas row for that design. |
| `GET /api/v1/racks?design_id=` | Full state. |
| `POST /api/v1/racks/save` | Full state: upsert what is sent, prune the rest. Rejects a device pointing at a rack outside the payload, or a cable pointing at a device outside it. |
| `GET /api/v1/racks/inventory?design_id=` | Rackable inventory entries, each flagged `racked` and resolved to a canvas node when one matches. |
| `POST /api/v1/scan/pending` | Manual inventory entry (`discovery_source: "manual"`), for hardware no scan can find. |
| Standalone | `homelable_rack:<designId>` in localStorage, inventory included (no `pending_devices` table to read). |

`@/utils/rackSerializer` maps the snake_case wire shapes to the camelCase domain
types in `@/types/rack`, narrowing every enum on the way in.

## Interactions

- **+ Device** (left rail) → `RackDeviceModal`. Source is either an existing **Device Inventory** entry, a new device created here (which lands in the inventory too), or a rack-only accessory. Nothing is preselected: the entry is picked in the Device Inventory modal, which the field opens.
- Drag from the sidebar tray onto a rack → snaps to a free U.
- Drag a mounted device inside the rack → same snapping, own slot ignored.
- The **Faceplate** field previews the current plate; clicking it opens `FaceplatePicker`. Switching the source between device and accessory swaps the plate to a sane default of the other kind.
- Double-click a plate → the same modal in edit mode: label, faceplate, U/height/column/width, status, colour, port list, Unmount. Single click only selects.
- Double-click empty rack chrome → `RackSettingsModal` (name, location, U height, 19"/10", numbering direction, frame/rail/interior colours, U numbers, enclosed, delete).
- Growing a device — by hand or by picking a taller plate — relocates it to the nearest slot that takes the new size. Only a rack with no such slot rejects the edit, and says so.
- **Patch mode**: drag from port A to port B to cable them — a dashed rubber band follows the pointer, exactly like dragging an edge on the logical canvas. Clicking A then B still works; Escape drops a half-drawn patch. Click a cable to select it (it gets an accent halo), then press Delete/Backspace — or the header's Unplug button — to remove it; Escape or a pane click deselects. Rack dragging is disabled while in patch mode.
- **Import links**: one shot per canvas, guarded by `networkImportDone`. Reads the physical edges (ethernet/fibre/vlan/cluster) of every non-rack design and matches them on `nodeId`.
- **New device**: the modal's *New device* source adds a Device Inventory entry (tagged `rack`), for gear no scan will ever discover. The left-rail tray only carries accessories, as a drag source.

## Panel behaviour in rack mode

- **Header**: undo/redo, auto layout, YAML import/export, MD and live View are hidden. Add Rack, Patch, cable visibility and Import links replace them. PNG export and Save stay.
- **Left rail**: the design switcher, Device Inventory, Scan History, Settings and Logout stay. The node/zone/text/scan/import block becomes the accessory tray plus **+ Device**. Devices themselves are not listed there — they live in the Device Inventory modal. The footer counts racks, mounts, cables and free U instead of online/offline nodes.
- **Right rail**: none. A mount is edited in `RackDeviceModal`, a rack in `RackSettingsModal`, so the canvas keeps the full width.

## Known gaps

- Front view only — no rear, no half-depth pairing.
- No 0U side-mounted PDU.
- Power draw / outlet budgeting out of scope (v1 decision).
- No undo/redo on the rack canvas.
- No read-only live view for rack designs.
