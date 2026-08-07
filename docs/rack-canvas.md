# Rack Canvas

A rack canvas is the **physical** counterpart to the network diagram: real racks,
the gear mounted in them, and the patch cables between their ports. It is a
canvas kind of its own — you create it like any other canvas, and Homelable swaps
the renderer when you switch to it.

Where the diagram answers *what talks to what*, the rack answers *what is where*:
which U a machine sits in, what plate it wears, which switch port its uplink
lands on.

> Works with **and** without the backend. In the no-backend standalone/demo build
> a rack canvas persists to your browser's local storage; the Device Inventory
> picker and the live status check are backend-only (marked 🔒 below).

---

## Feature Overview

- **Racks** — any U height, 19" or 10" wide, bottom-up or top-down numbering, per-rack frame / rail / interior colours, open or enclosed.
- **Mounted gear** — a device occupies a U range and part of a 12-column width grid, so half- and third-width machines share a U.
- **Faceplates** — a visual catalog of plates (servers, switches, routers, patch panels, UPS, PDUs, desktop NAS towers, shelves, blanks, cable managers) drawn as vector artwork that scales with the rack.
- **Ports & patching** — RJ45 and SFP ports per device, cabled port-to-port by dragging from one to the other, across racks if needed.
- **Device Inventory** 🔒 — a mount points at a real inventory entry, so a rack shows the same devices your scans found, and gear you rack by hand joins that inventory.
- **Live status** 🔒 — a mount can follow the status check already configured on the matching diagram node, and light its plate LED accordingly.
- **Import links** 🔒 — derive patches from the physical links already drawn on your diagrams, as often as you like.

---

## Create a rack canvas

1. Open the **canvas switcher** at the top of the left sidebar.
2. Click **New Canvas**.
3. Under **Kind**, pick **Rack** (the other kind, *Diagram*, is the usual node/link canvas).
4. Name it, pick an icon, and create.

A canvas cannot change kind afterwards — a diagram and a rack store different
things. Deleting a rack canvas deletes its racks, mounts and cables with it;
duplicating a canvas duplicates them too.

---

## Add a rack

**Add Rack** in the header drops a new rack on the canvas. Drag it anywhere; a
canvas can hold as many as you like, and cables can run between them.

**Double-click the rack chrome** (the frame, not a device) to open its settings:

| Setting | What it does |
|---|---|
| Name / Location | Free text — "Baie salon", "Garage", … |
| U height | How many mountable U the rack has (42 by default). |
| Width | 19" or 10" — drives the drawn inner width. |
| Numbering | `bottom-up` or `top-down`. **Labels only** — gear never moves. |
| Show U numbers | Print the U scale on the rails. |
| Enclosed | Draw side panels / a closed chassis. |
| Colours | Frame, rails and interior. Defaults come from your app theme. |
| Delete | Removes the rack and everything mounted in it. |

---

## Mount a device

Click **+ Device** in the left sidebar, or drag an accessory from the sidebar
tray straight onto a rack. The device modal offers three sources:

- **Device Inventory entry** 🔒 — pick something already discovered. The field
  opens the real Device Inventory, with its search, source and type filters, and
  it opens pre-filtered to **rackable** hardware (no light bulbs, no sockets).
  A device already mounted on this canvas is refused.
- **New device** — for hardware no scan can find (a patch panel, a PDU, an
  unmanaged switch). It is created as a normal Device Inventory entry tagged
  **Rack devices**, so you can search, filter, hide and delete it like any other.
- **Accessory** — rack-only furniture: blanking plate, shelf, cable manager.
  These are not devices and never appear in the inventory.

Then set:

| Field | Notes |
|---|---|
| Label | Shown on the plate. |
| Faceplate | Opens the visual catalog — see below. |
| U position / height | `U` is counted **from the bottom rail**, whatever the numbering setting prints. |
| Column / width | Full, half, third, sixth or quarter of the rack width. |
| Status | A fixed colour, or **Check device** 🔒 — see below. |
| Colour | Overrides the plate's default tint. |
| Ports | The list of RJ45 / SFP ports, seeded by the faceplate and editable afterwards. |

**Double-click a plate** to reopen this modal on an existing mount; a single
click only selects it. **Unmount** takes the device out of the rack — it stays in
the Device Inventory.

### Placement rules

- A drop **snaps to the nearest free slot**; a placement that cannot work
  previews in red.
- Drag a mounted device inside its rack to move it — same snapping.
- **Growing** a device, by hand or by picking a taller plate, relocates it to the
  nearest slot that takes the new size. Only a rack with no such slot refuses the
  edit, and it tells you so.

---

## Faceplates

The **Faceplate** field opens a catalog, not a dropdown of names: every plate is
drawn with the real renderer, at its real relative width and U height, grouped by
family and searchable.

| Family | Examples |
|---|---|
| Servers | 1U, 1U with drive bays, 2U with bays, 4U storage, half-width SFF, third-width mini PC |
| Network | 8 / 24 / 48-port switches, 1U router |
| Patch | 24-port copper panel, 12-port fibre panel |
| Storage | 2U NAS, desktop NAS towers in 2, 4 and 5 bays |
| Power | 2U UPS, 1U PDU |
| Accessories | Blanking plate, shelf, cable manager |

Picking a plate **reseeds the ports** it comes with; your own port edits are kept
until you change plate again. Plates are drawn as vector artwork in relative
coordinates, so they stay correct at any rack width and U height, and their
colours follow the active app theme.

---

## Ports and patching

Ports are **RJ45** or **SFP/SFP+**, drawn as real jack artwork at a fixed size so
plates of different heights line up. Power outlets are artwork only — they are
never a cable endpoint.

Patch-facing gear (switches, patch panels) shows its ports permanently;
everything else reveals them on hover, on selection, or when cables are shown.

To cable:

1. Click **Patch** in the header.
2. **Drag from one port to another** — a dashed rubber band follows the pointer.
   Clicking the two ports in turn works just as well. **Escape** drops a
   half-drawn patch.
3. Repeat. One cable per port; copper or fibre follows the port you start from.
4. Click **Exit patching** when done — the canvas returns to the cable visibility
   it had before.

To unplug: **click the cable** (it gets an accent halo), then press
**Delete/Backspace** or click **Unplug** in the header. A stray click never
destroys a patch.

A header select controls what you see: cables **on hover**, **always**, or
**hidden**. With cables shown, plates fade so the patching reads clearly. Cables
pan and zoom with the canvas and may run from one rack to another.

### Import links 🔒

**Import links** derives patches from the physical links (ethernet, fibre, vlan,
cluster) already drawn on your diagrams, matching both ends to mounts that point
at those nodes. Run it as often as you like: a pair of devices already cabled
is left alone, so a second run after racking more gear only adds what is
missing.

---

## Status 🔒

A mount's **Status** is either pinned by hand (online / offline / unknown) or set
to **Check device**: the plate then follows the status check already configured
on the matching diagram node (ping, HTTP, SSH, …) and its LED lights accordingly.

The rack runs no checker of its own — it reads the result of the one your diagram
already performs. So:

- **Check device** is only offered when the mount resolves to a diagram node.
- Losing that link drops the mount back to `unknown`, rather than leaving it on a
  status nothing answers for.
- The refresh polls every 60 s, and only while at least one mount is on
  **Check device**.

---

## Saving

Like the diagram canvas, a rack canvas is **saved explicitly** — **Save Rack** in
the left sidebar, or the header's save button. Nothing is written behind your
back unless you turn on **Autosave** in Settings.

The sidebar footer counts racks, mounts, cables and free U instead of the
diagram's online/offline tally. **PNG export** works here too.

---

## Known limits

- **Front view only** — no rear view, no half-depth pairing.
- No 0U side-mounted PDU.
- No power draw or outlet budgeting.
- No undo/redo on a rack canvas (the diagram canvas keeps its own).
- Rack canvases are not shown by the read-only [Live View](../README.md#live-view-read-only-public-canvas).
- The MCP server exposes diagram nodes and links only, not racks.

---

## See also

- [FEATURES.md](../FEATURES.md) — every feature, one page.
- [Device Inventory](../FEATURES.md#12-device-inventory-) — where racked devices live.
- `frontend/src/rack/README.md` — the developer reference for this canvas.
