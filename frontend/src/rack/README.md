# Rack canvas — UX prototype

Front-only. No API, no persistence, no backend enum changes. Open **`/racklab`**
(`npm run dev` → http://localhost:5173/racklab).

Isolated on purpose: `main.tsx` routes `/racklab` the same way it already routes
`/view`, so nothing here touches the logical canvas. Once the UX is settled, the
model in `types.ts` is what gets lifted into `@/types` + a `design_type: 'rack'`.

## Model

| Concern | Choice |
|---|---|
| Vertical | `uStart` (1-based, **always counted from the bottom rail**) + `uHeight`. `numbering` only changes the printed labels. |
| Horizontal | 12-column grid (`RACK_COLUMNS`). Full = 12, half = 6, third = 4, quarter = 3 — so 2 or 3 machines share one U. |
| Collision | `canPlace` / `findSlot` in `layout.ts`. A drop snaps to the nearest free slot; an impossible drop shows a red preview. |
| Inventory | A mount references an inventory id. **Unmounting never deletes the inventory entry** — same rule as the network canvas. Accessories (blank, shelf, cable manager) have `nodeId: null`. |
| Faceplates | Declarative templates in `faceplates.ts`, drawn as SVG in unit coordinates so a plate scales with U height and rack width. Applying a template seeds ports; the user edits them afterwards. |
| Ports | RJ45 and SFP/SFP+ only, drawn as real jack artwork at a fixed pixel size so plates of different U heights line up. Manual list per device; position is unit coordinates on the plate. Power outlets are artwork, never a cable endpoint. |
| Port visibility | Patch-facing gear (switches, patch panels) shows its ports permanently. Everything else reveals them on hover, on selection, or when cables are on — a cable never ends on an invisible port. |
| Plate zones | Each template reserves three non-overlapping bands: status LED (fixed left), `labelBox` (name, clipped), then artwork and ports. A test asserts no port lands on the name band. |
| Cables | Port-to-port, a relation of their own — not React Flow edges. One cable per port. Drawn in a `ViewportPortal` so they pan/zoom with the canvas and can cross racks. |
| Cable visibility | Hidden by default; shown on hover/selection, or all-on via patch mode / the toolbar. Plates fade to 40 % when cables are on, which is the "transparency" ask. Copper vs fibre follows the port the patch starts from. |
| Network import | `importCablesFromNetwork()` — one shot, at creation time only, guarded by `networkImportDone`. Fed by `networkEdgeHints()` (fake here; would read the network design's edges for real). |

## Interactions

- Drag from the left tray onto a rack → snaps to a free U.
- Drag a mounted device inside the rack → same snapping, own slot ignored.
- Click a device → inspector on the right (label, faceplate, U/height/column/width, status, colour, port list).
- Click empty rack chrome → rack settings (name, location, U height, 19"/10", numbering direction, frame/rail/interior colours, U numbers, enclosed).
- **Patch mode**: click port A then port B to cable them; click a cable to remove it. Rack dragging is disabled while in patch mode.

## Known gaps (deliberate, for the UX pass)

- Front view only — no rear, no half-depth pairing.
- No 0U side-mounted PDU.
- Power draw / outlet budgeting out of scope (v1 decision).
- No export yet (PNG/SVG comes with integration).
- Demo state resets on reload; `Reset demo` restores it mid-session.
