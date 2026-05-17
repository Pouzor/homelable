import { Globe, Router, Server, Layers, Box, Container, HardDrive, Cpu, Wifi, Circle, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Service {
  port: number
  protocol: string
  service_name: string
  icon?: string | null
  category?: string | null
}

export interface PendingDevice {
  id: string
  ip: string | null
  mac: string | null
  hostname: string | null
  os: string | null
  services: Service[]
  suggested_type: string | null
  status: string
  discovery_source: string | null
  ieee_address?: string | null
  friendly_name?: string | null
  device_subtype?: string | null
  model?: string | null
  vendor?: string | null
  lqi?: number | null
  discovered_at: string
}

interface PendingDeviceModalProps {
  device: PendingDevice | null
  onClose: () => void
  onApprove: (device: PendingDevice) => void
  onHide: (device: PendingDevice) => void
  onIgnore: (device: PendingDevice) => void
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  isp: Globe,
  router: Router,
  server: Server,
  proxmox: Layers,
  vm: Box,
  lxc: Container,
  nas: HardDrive,
  iot: Cpu,
  ap: Wifi,
  switch: Network,
  generic: Circle,
}

const CATEGORY_COLORS: Record<string, string> = {
  hypervisor: '#ff6e00',
  nas: '#39d353',
  automation: '#a855f7',
  containers: '#00d4ff',
  network: '#39d353',
  security: '#f85149',
  monitoring: '#e3b341',
  database: '#a855f7',
  web: '#00d4ff',
  media: '#ff6e00',
  iot: '#e3b341',
}

function categoryColor(category: string | null | undefined) {
  if (!category) return '#8b949e'
  return CATEGORY_COLORS[category.toLowerCase()] ?? '#8b949e'
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-mono text-foreground break-all">{value}</span>
    </div>
  )
}

export function PendingDeviceModal({ device, onClose, onApprove, onHide, onIgnore }: PendingDeviceModalProps) {
  if (!device) return null

  const TypeIcon = TYPE_ICONS[device.suggested_type ?? 'generic'] ?? Circle
  const isZigbee = device.discovery_source === 'zigbee'
  const titleLabel = device.friendly_name ?? device.hostname ?? device.ip ?? device.ieee_address ?? 'Pending device'

  const handleApprove = () => { onApprove(device) }
  const handleHide = () => { onHide(device); onClose() }
  const handleIgnore = () => { onIgnore(device); onClose() }

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <TypeIcon size={15} className="text-[#00d4ff] shrink-0" />
            {titleLabel}
            {isZigbee && (
              <span className="ml-1 text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30">
                Zigbee
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-1">
          {/* Device info */}
          <div className="flex flex-col gap-1.5 p-3 rounded-md bg-[#21262d] border border-[#30363d]">
            {device.ip && <InfoRow label="IP" value={device.ip} />}
            {device.hostname && <InfoRow label="Hostname" value={device.hostname} />}
            {device.mac && <InfoRow label="MAC" value={device.mac} />}
            {device.os && <InfoRow label="OS" value={device.os} />}
            {device.ieee_address && <InfoRow label="IEEE" value={device.ieee_address} />}
            {device.friendly_name && device.friendly_name !== device.hostname && (
              <InfoRow label="Name" value={device.friendly_name} />
            )}
            {device.vendor && <InfoRow label="Vendor" value={device.vendor} />}
            {device.model && <InfoRow label="Model" value={device.model} />}
            {device.device_subtype && <InfoRow label="Role" value={device.device_subtype} />}
            {device.lqi != null && <InfoRow label="LQI" value={String(device.lqi)} />}
            {device.suggested_type && (
              <InfoRow label="Type" value={device.suggested_type} />
            )}
            {device.discovery_source && (
              <InfoRow label="Source" value={device.discovery_source.toUpperCase()} />
            )}
            <InfoRow label="Discovered" value={new Date(device.discovered_at.endsWith('Z') ? device.discovered_at : device.discovered_at + 'Z').toLocaleString()} />
          </div>

          {/* Services (skipped for Zigbee devices — they don't have IP services) */}
          {!isZigbee && <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Services found ({device.services.length})
            </p>
            {device.services.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No services detected</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {device.services.map((svc, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: categoryColor(svc.category) }}
                    />
                    <span className="font-mono text-[#00d4ff] w-10 shrink-0">{svc.port}</span>
                    <span className="text-muted-foreground w-7 shrink-0">{svc.protocol}</span>
                    <span className="text-foreground truncate">{svc.service_name}</span>
                    {svc.category && (
                      <span className="ml-auto text-[10px] shrink-0" style={{ color: categoryColor(svc.category) }}>
                        {svc.category}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 bg-[#39d353]/15 text-[#39d353] hover:bg-[#39d353]/25 border border-[#39d353]/30"
              onClick={handleApprove}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-muted-foreground hover:text-foreground hover:bg-[#30363d]"
              onClick={handleHide}
            >
              Hide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
              onClick={handleIgnore}
            >
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
