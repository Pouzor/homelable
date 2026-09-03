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
| Inventory | A mount references a **Device Inventory** entry (`device_inventory`) via `deviceId`. Those rows survive approval *and* node deletion, so unracking never removes the device. Accessories (blank, shelf, cable manager) have `deviceId: null`. `label` comes from `_device_label` in `racks.py`, which mirrors `deviceLabel` in `DeviceInventoryModal.tsx` (friendly name → host → app the ports say it runs → IP → IEEE → id) so a device is named the same in both lists. |
| Rack-created gear | A device created from this canvas is a normal inventory row with `discovery_source: "rack"`, so it inherits the inventory's search, filters, hide and delete. It shows under the **Rack devices** source filter, and both `POST /scan/pending/{id}/approve` and bulk-approve refuse it — a mount is not a host to document on a logical canvas. Its `suggested_type` comes from the plate it wears (`deviceTypeForFaceplate`), since no scan is there to guess one: without it the row had no icon, no role badge and no place in the type filter. Passive gear uses the rack-only kinds `patch_panel` and `pdu` — the logical canvas has no node type for it, and `pdu` must not be `socket`, which is excluded from the rack inventory. |
| Picking one | The **Device Inventory entry** field opens the real Device Inventory modal (`DeviceInventoryModal` in picker mode: a card click returns the device, bulk/clear controls are hidden) rather than a flat `<select>`, so the user gets its search, source/type filters and per-card detail. It opens with the **Rackable** filter armed — hardware only, `UNRACKABLE_TYPES` in `utils/rackable.ts` mirroring `_UNRACKABLE_TYPES` in `racks.py`, with `test_rackable_sync.py` failing on drift. The rack side still has the last word: a device missing from its own list, or already mounted in this design, is refused with a toast. Standalone keeps the `<select>` — no backend, no inventory modal. |
| Canvas node link | `nodeId` is a second, optional link to a logical-canvas node, resolved server-side by IEEE then IP. It supplies live status and lets the network-link import match endpoints. Never required. |
| Relinking one by hand | A plate created from the rack carries a placeholder inventory row with a name and nothing else, and the IEEE/IP guess behind `nodeId` finds nothing for gear with no MAC and no address. `DevicePickerModal` — opened from the Linked device panel, listing the rack's own `/racks/inventory` copy — points the mount at another **Device Inventory** row instead: `relinkDevice` writes `deviceId`, adopts that row's `nodeId`, status and (unless the user renamed the plate) label, and recomputes the racked flags, so the panel, the Status select and the plate LED follow before the canvas is even saved. One entry, one mount: a row another plate stands for is not offered, and the store refuses it anyway. The placeholder left behind is deleted through `DELETE /scan/pending/{id}` when the rack created it (`discovery_source: "rack"`) and nothing else mounts it — that route refuses a mounted device with a 409, since `rack_devices.device_id` is `ON DELETE SET NULL` and would otherwise blank the mount. A row from discovery or from the user is never touched. |
| Linked device panel | `LinkedDevicePanel`, under the port list in `RackDeviceModal`: what is known about the box a mount stands for — name, type, hostname, IP, MAC, OS, status check, the canvas it is drawn on, last seen, and the fingerprinted services. Read-only; the inventory and the logical canvas own them. `/racks/inventory` ships the canvas side as `node_*` alongside the inventory row's own `mac` / `hostname` / `os` / `services`, and the panel prefers the node value (curated) over the inventory one (what discovery last saw), dropping any row neither side can fill. A device on no canvas still prints everything discovery found — it is the record of a real box whether or not anyone drew it — and adds *Not on a logical canvas.*, which is why `auto` resolves to `unknown` there. *Link to another device…* is always on offer for a real mount, so a placeholder or the wrong twin of two look-alikes is not a dead end. A mount with no inventory entry — an accessory — gets no panel. |
| Status | A mount stores a `MountStatus`: `online` / `offline` / `unknown` pinned by hand, or `auto` — "check device", i.e. follow the status check already configured on the matching canvas node (ping, http, ssh…). The rack runs no checker of its own; `auto` resolves through the inventory entry's `node_status` (`resolveDeviceStatus` in `deviceStatus.ts`) and falls back to `unknown` when nothing is behind it. The Status select offers `auto` only when the mount — or the entry being picked — resolves to a node, and drops back to `unknown` when that link is lost. `useAutoStatusRefresh` polls the inventory every 60 s while at least one mount is on `auto`, and only then; the refresh writes inventory only, so autosave stays quiet. |
| Faceplates | Declarative templates in `faceplates.ts`, drawn as SVG in unit coordinates so a plate scales with U height and rack width. Applying a template seeds ports; the user edits them afterwards. `suggestFaceplate()` picks one from the device's discovery type. Chosen from `FaceplatePicker` — a visual catalog, not a `<select>`: every template is drawn with the canvas renderer at its real relative width and U height, grouped, searchable, and filterable by `kind` (accessories are offered only to accessories). |
| Ports | RJ45 and SFP/SFP+ only, drawn as real jack artwork at a fixed pixel size so plates of different U heights line up. Manual list per device, positioned by hand on the plate (`portLayout.ts` + `PortPositionEditor`). Accessories carry none. Power outlets are artwork, never a cable endpoint. |
| Port ownership | The **Device Inventory row owns the rack modelisation** — faceplate, U height, column span, colour override and the port list, positions included — not the mount. A device therefore wears the same front panel in every rack. Only placement (`rackId`, `uStart`, `colStart`), pinned status and label stay per canvas. Columns `device_inventory.rack_*`; `POST /racks/save` writes them through and `GET /racks` overlays them on load. Size is applied only where it still fits the mount's rack — geometry is global, a rack is not. Standalone has no inventory row to hang this on, so ports stay per mount there. Editable from both ends: a mount in `RackDeviceModal`, or the row itself in the Device Inventory detail modal (`DeviceFaceplateEditor`, shown only for a device already modelled), which writes the same columns through `PATCH /scan/pending/{id}`. |
| Port visibility | Patch-facing gear (switches, patch panels) shows its ports permanently. Everything else reveals them on hover, on selection, or when cables are on — a cable never ends on an invisible port. |
| Plate zones | Each template reserves three non-overlapping bands: status LED (fixed left), `labelBox` (name, clipped), then artwork and ports. A test asserts no port lands on the name band. `labelBox.y` (default 0.5) moves the name band *and* the LED off mid-height — desktop NAS boxes are drive doors over a badge strip at the bottom. |
| Cables | Port-to-port, a relation of their own — not React Flow edges. One cable per port. Drawn in a `ViewportPortal` so they pan/zoom with the canvas and can cross racks. |
| Cable visibility | Hidden by default; shown on hover/selection, or all-on via patch mode / the header. Plates stay opaque in every mode — fading them to 40 % showed the rails and the U grid through the gear. Copper vs fibre follows the port the patch starts from. A selected cable is drawn whatever the mode, `hidden` included — its panel is open on the right, so hiding the run it describes would read as a bug — but `hidden` reveals nothing else, not even on hover. |
| Cable annotations | A cable carries a `label` plus `properties` — the same `NodeProperty` records the logical canvas uses (`key`, `value`, `icon`, `visible`), edited with the shared `components/common/PropertyList`. `labelVisible` and each property's `visible` decide what is printed on the canvas: `CableLayer` draws the lines on a small plate at the midpoint of the run (the cubic solved at `t = 0.5`, not `getPointAtLength`, which needs a mounted path). |
| Colours | `rackTheme.ts` derives the whole rack palette from the active app theme rather than declaring one per theme, so a new theme works here for free. Per-rack chrome (frame, rails, interior) stays user-editable; only its default comes from the theme. |

## Persistence

Explicit save, like the logical canvas — plus the same opt-in autosave, which
debounces on the store's `editSeq`.

| Where | What |
|---|---|
| `racks`, `rack_devices`, `rack_cables` | One row set per design. `rack_devices.device_id → device_inventory` and `node_id → nodes` are both `ON DELETE SET NULL`, and `label` is denormalized, so a rack keeps rendering after an inventory purge. |
| `canvas_state.viewport` | Pan/zoom, shared with the logical canvas row for that design. |
| `GET /api/v1/racks?design_id=` | Full state. |
| `POST /api/v1/racks/save` | Full state: upsert what is sent, prune the rest. Rejects a device pointing at a rack outside the payload, or a cable pointing at a device outside it. Also cross-checks geometry: a mount against the height of the rack it names, and `col_start + col_span` against the grid — each field is legal alone and the pair is not. |
| `GET /api/v1/racks/inventory?design_id=` | Rackable inventory entries, each flagged `racked` and resolved to a canvas node when one matches. |
| `POST /api/v1/scan/pending` | Manual inventory entry (`discovery_source: "manual"`), for hardware no scan can find. |
| Standalone | `homelable_rack:<designId>` in localStorage, inventory included (no `device_inventory` table to read). |

`@/utils/rackSerializer` maps the snake_case wire shapes to the camelCase domain
types in `@/types/rack`, narrowing every enum on the way in.

## Interactions

- **+ Device** (left rail) → `RackDeviceModal`. Source is either an existing **Device Inventory** entry, a new device created here (which lands in the inventory too), or a rack-only accessory. Nothing is preselected: the entry is picked in the Device Inventory modal, which the field opens.
- Drag from the sidebar tray onto a rack → snaps to a free U.
- Drag a mounted device inside the rack → same snapping, own slot ignored.
- The **Faceplate** field names the current plate and opens `FaceplatePicker`; the plate itself is drawn full size at the bottom of the modal (`PortPositionEditor`, `interactive={false}`) — the old 160×18px thumbnail lost its label and stacked its ports. Switching the source between device and accessory swaps the plate to a sane default of the other kind.
- **Position** (port list header) turns that plate into the port editor: drag a handle to place a port, arrow keys nudge by 0.01, and each axis snaps to the nearest peer within 6px so banks stay in line. A new port continues the last row instead of landing on the middle of the plate. Editing a port's name highlights it on the plate. Positions are unit coordinates, so the blow-up never reaches the data.
- Double-click a plate → the same modal in edit mode: label, faceplate, U/height/column/width, status, colour, port list, the **Linked device** panel, Unmount. Single click only selects.
- Double-click empty rack chrome → `RackSettingsModal` (name, location, U height, 19"/10", numbering direction, frame/rail/interior colours, U numbers, enclosed, delete).
- Growing a device — by hand or by picking a taller plate — relocates it to the nearest slot that takes the new size. Only a rack with no such slot rejects the edit, and says so.
- Shrinking a **rack** follows the same rule: `updateRack` clamps `uHeight` to `[MIN_RACK_U, MAX_RACK_U]` (1–48; the backend tolerates 100) and relocates every mount the new height would push above the top rail, one at a time so two never land on the same slot. It returns false and changes nothing when one has nowhere to go. The number input's `min`/`max` are hints the browser does not enforce on typed input — a raw 999 used to make every save fail the backend's `1..100` check with no cause shown, and a shrink left plates drawn outside the chassis that nothing could drag back.
- The height field commits on **blur or Enter**, never per keystroke: backspacing `24` walks through `2`, and the relocation that would trigger is not undone when the digits come back — the rack canvas has no undo. The colour hex field in `RackCablePanel` commits the same way, falling back to the cable type's default when the value does not parse, rather than feeding the SVG `stroke` a half-typed `#39d`.
- **Delete rack** asks first, naming how many mounts it unmounts. It takes every mount and every cable touching them; only the Device Inventory survives.
- **Patch mode**: drag from port A to port B to cable them — a dashed rubber band follows the pointer, exactly like dragging an edge on the logical canvas. Clicking A then B still works; Escape drops a half-drawn patch. Rack dragging is disabled while in patch mode.
- **Click a cable** — in patch mode or out of it — to select it: it gets an accent halo and opens `RackCablePanel` on the right (endpoints, type, colour, label, properties, Unplug). Delete/Backspace unplugs the selection; Escape or a pane click deselects. Selecting a cable drops any mount/rack selection and vice versa — one rail, one occupant.
- **Import links**: reads the physical edges (ethernet/fibre/vlan/cluster) of every non-rack design and matches them on `nodeId`. Idempotent — a device pair already cabled is skipped, whichever ports carry it, so a re-run after racking more gear adds only what is missing. There is no "done" flag: one lived in memory only, and a reload re-armed the import onto the next free ports.
- **New device**: the modal's *New device* source adds a Device Inventory entry (tagged `rack`), for gear no scan will ever discover. The left-rail tray only carries accessories, as a drag source.

## Panel behaviour in rack mode

- **Header**: undo/redo, auto layout, YAML import/export, MD and live View are hidden. Add Rack, Patch, cable visibility and Import links replace them. PNG export and Save stay.
- **Left rail**: the design switcher, Device Inventory, Scan History, Settings and Logout stay. The node/zone/text/scan/import block becomes the accessory tray plus **+ Device**. Devices themselves are not listed there — they live in the Device Inventory modal. The footer counts racks, mounts, cables and free U instead of online/offline nodes.
- **Right rail**: only for a selected cable (`RackCablePanel`). A mount is edited in `RackDeviceModal` and a rack in `RackSettingsModal` — a cable has no plate to double-click, so it gets the rail instead. With nothing selected the canvas keeps the full width.

## Known gaps

- Front view only — no rear, no half-depth pairing.
- No 0U side-mounted PDU.
- Power draw / outlet budgeting out of scope (v1 decision).
- No undo/redo on the rack canvas.
- No read-only live view for rack designs.
