/**
 * Rack settings — name, capacity, chrome.
 *
 * Same reasoning as `RackDeviceModal`: the rack canvas has no right rail, so the
 * settings live in a dialog. Opened by double-clicking a rack's chassis.
 */
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRackStore } from '../store'
import { freeUnits } from '../layout'
import { MAX_RACK_U, MIN_RACK_U } from '../rackDefaults'
import type { RackNumbering, RackWidthStandard } from '@/types'

const inputClass =
  'w-full rounded border border-[#30363d] bg-[#21262d] px-2 py-1 text-sm text-foreground outline-none focus:border-[#00d4ff]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function RackSettingsModal() {
  const rackId = useRackStore((s) => s.rackEditorId)
  const close = useRackStore((s) => s.closeRackEditor)
  const rack = useRackStore((s) => s.racks.find((r) => r.id === s.rackEditorId))
  const devices = useRackStore((s) => s.devices)
  const updateRack = useRackStore((s) => s.updateRack)
  const updateRackStyle = useRackStore((s) => s.updateRackStyle)
  const removeRack = useRackStore((s) => s.removeRack)

  if (!rackId || !rack) return null
  const used = rack.uHeight - freeUnits(rack, devices)

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md border-[#30363d] bg-[#161b22] text-foreground max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Rack settings</DialogTitle>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-3">
          <Field label="Name">
            <input
              className={inputClass}
              aria-label="Rack name"
              value={rack.name}
              onChange={(e) => updateRack(rack.id, { name: e.target.value })}
            />
          </Field>
          <Field label="Location">
            <input
              className={inputClass}
              aria-label="Location"
              value={rack.location ?? ''}
              onChange={(e) => updateRack(rack.id, { location: e.target.value })}
            />
          </Field>
          <Field label={`Height — ${used}U used of ${rack.uHeight}U`}>
            <input
              type="number"
              min={MIN_RACK_U}
              max={MAX_RACK_U}
              className={inputClass}
              aria-label="Rack height"
              value={rack.uHeight}
              onChange={(e) => {
                // The store clamps and relocates; it only refuses when a mount
                // the shrink pushes out has nowhere left to go.
                if (!updateRack(rack.id, { uHeight: Number(e.target.value) || MIN_RACK_U })) {
                  toast.error('Not enough room to shrink the rack — unmount something first')
                }
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Width standard">
              <select
                className={inputClass}
                aria-label="Width standard"
                value={rack.widthStandard}
                onChange={(e) =>
                  updateRack(rack.id, { widthStandard: e.target.value as RackWidthStandard })
                }
              >
                <option value="19">19 inch</option>
                <option value="10">10 inch (mini)</option>
              </select>
            </Field>
            <Field label="U numbering">
              <select
                className={inputClass}
                aria-label="U numbering"
                value={rack.numbering}
                onChange={(e) => updateRack(rack.id, { numbering: e.target.value as RackNumbering })}
              >
                <option value="bottom-up">1 at the bottom</option>
                <option value="top-down">1 at the top</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(['frame', 'rail', 'interior'] as const).map((key) => (
              <Field key={key} label={key}>
                <input
                  type="color"
                  aria-label={key}
                  className="h-8 w-full cursor-pointer rounded border border-[#30363d] bg-[#21262d]"
                  value={rack.style[key]}
                  onChange={(e) => updateRackStyle(rack.id, { [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rack.style.showNumbers}
              onChange={(e) => updateRackStyle(rack.id, { showNumbers: e.target.checked })}
            />
            Show U numbers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rack.style.enclosed}
              onChange={(e) => updateRackStyle(rack.id, { enclosed: e.target.checked })}
            />
            Enclosed cabinet
          </label>

          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                removeRack(rack.id)
                close()
              }}
              className="cursor-pointer text-[#f85149] hover:bg-[#f8514922] hover:text-[#f85149]"
            >
              Delete rack
            </Button>
            <Button type="button" onClick={close} className="ml-auto cursor-pointer">
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
