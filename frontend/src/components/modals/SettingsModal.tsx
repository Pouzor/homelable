import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  settingsApi,
  proxmoxApi,
  zigbeeApi,
  zwaveApi,
  type ProxmoxConfigData,
  type ZigbeeConfigData,
  type ZwaveConfigData,
} from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'
import { toast } from 'sonner'
import {
  type AlignmentSettings,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '@/utils/alignmentSettings'
import {
  type AutosaveSettings,
  readAutosaveSettings,
  writeAutosaveSettings,
  subscribeAutosaveSettings,
} from '@/utils/autosaveSettings'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

interface MeshAutoSyncProps {
  title: string
  accent: string
  hostConfigured: boolean
  envHostVar: string
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  interval: number
  onIntervalChange: (v: number) => void
  description: string
  syncing: boolean
  onSyncNow: () => void
}

/**
 * Auto-sync controls for an MQTT mesh import (Zigbee / Z-Wave). Mirrors the
 * Proxmox auto-sync block: connection config is env-only, so this only toggles
 * the scheduled activation + interval and offers an immediate re-sync. When no
 * MQTT host is set in the server env, it shows how to configure one instead.
 */
function MeshAutoSync({
  title, accent, hostConfigured, envHostVar, enabled, onEnabledChange,
  interval, onIntervalChange, description, syncing, onSyncNow,
}: MeshAutoSyncProps) {
  return (
    <div className="pt-3 border-t border-border space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      {!hostConfigured ? (
        <p className="text-[10px] text-[#e3b341] leading-tight">
          No MQTT host configured. Set <span className="font-mono">{envHostVar}</span> in the server .env to enable auto-sync.
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs text-foreground">Auto-sync {title.replace(' auto-sync', '')} inventory</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="cursor-pointer"
              style={{ accentColor: accent }}
              aria-label={`Toggle ${title}`}
            />
          </label>
          <div className={enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
            <label className="text-xs text-muted-foreground">Sync interval (s)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={300}
                max={86400}
                value={interval}
                onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onIntervalChange(v) }}
                className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none"
                aria-label={`${title} interval`}
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onSyncNow}
              disabled={syncing}
              className="h-7 text-xs"
              style={{ borderColor: accent, color: accent }}
            >
              {syncing ? 'Syncing…' : 'Re-sync now'}
            </Button>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Runs one import immediately using the server .env config.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [interval, setIntervalValue] = useState(60)
  const [serviceCheckEnabled, setServiceCheckEnabled] = useState(false)
  const [serviceInterval, setServiceInterval] = useState(300)
  const [saving, setSaving] = useState(false)
  const [pmConfig, setPmConfig] = useState<ProxmoxConfigData | null>(null)
  const [pmSyncEnabled, setPmSyncEnabled] = useState(false)
  const [pmInterval, setPmInterval] = useState(3600)
  const [pmSyncing, setPmSyncing] = useState(false)
  const [zbConfig, setZbConfig] = useState<ZigbeeConfigData | null>(null)
  const [zbSyncEnabled, setZbSyncEnabled] = useState(false)
  const [zbInterval, setZbInterval] = useState(3600)
  const [zbSyncing, setZbSyncing] = useState(false)
  const [zwConfig, setZwConfig] = useState<ZwaveConfigData | null>(null)
  const [zwSyncEnabled, setZwSyncEnabled] = useState(false)
  const [zwInterval, setZwInterval] = useState(3600)
  const [zwSyncing, setZwSyncing] = useState(false)
  const [alignment, setAlignment] = useState<AlignmentSettings>(readAlignmentSettings)
  const [autosave, setAutosave] = useState<AutosaveSettings>(readAutosaveSettings)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const setHideIp = useCanvasStore((s) => s.setHideIp)

  useEffect(() => {
    if (!open || STANDALONE) return
    settingsApi.get()
      .then((res) => {
        setIntervalValue(res.data.interval_seconds)
        setServiceCheckEnabled(res.data.service_check_enabled)
        setServiceInterval(res.data.service_check_interval)
      })
      .catch(() => {/* use default */})
    proxmoxApi.getConfig()
      .then((res) => {
        setPmConfig(res.data)
        setPmSyncEnabled(res.data.sync_enabled)
        setPmInterval(res.data.sync_interval)
      })
      .catch(() => {/* proxmox not configured */})
    zigbeeApi.getConfig()
      .then((res) => {
        setZbConfig(res.data)
        setZbSyncEnabled(res.data.sync_enabled)
        setZbInterval(res.data.sync_interval)
      })
      .catch(() => {/* zigbee not configured */})
    zwaveApi.getConfig()
      .then((res) => {
        setZwConfig(res.data)
        setZwSyncEnabled(res.data.sync_enabled)
        setZwInterval(res.data.sync_interval)
      })
      .catch(() => {/* zwave not configured */})
  }, [open])

  useEffect(() => subscribeAlignmentSettings(setAlignment), [])
  useEffect(() => subscribeAutosaveSettings(setAutosave), [])

  const updateAlignment = (patch: Partial<AlignmentSettings>) => {
    const next = { ...alignment, ...patch }
    setAlignment(next)
    writeAlignmentSettings(next)
  }

  const updateAutosave = (patch: Partial<AutosaveSettings>) => {
    const next = { ...autosave, ...patch }
    setAutosave(next)
    writeAutosaveSettings(next)
  }

  const handleSyncNow = async () => {
    setPmSyncing(true)
    try {
      await proxmoxApi.syncNow()
      toast.success('Proxmox sync started')
    } catch {
      toast.error('Failed to start Proxmox sync')
    } finally {
      setPmSyncing(false)
    }
  }

  const handleZbSyncNow = async () => {
    setZbSyncing(true)
    try {
      await zigbeeApi.syncNow()
      toast.success('Zigbee sync started')
    } catch {
      toast.error('Failed to start Zigbee sync')
    } finally {
      setZbSyncing(false)
    }
  }

  const handleZwSyncNow = async () => {
    setZwSyncing(true)
    try {
      await zwaveApi.syncNow()
      toast.success('Z-Wave sync started')
    } catch {
      toast.error('Failed to start Z-Wave sync')
    } finally {
      setZwSyncing(false)
    }
  }

  const handleSave = async () => {
    // Canvas prefs (alignment, hide-IP) persist on change; only the backend
    // status-check interval needs an API round-trip.
    if (STANDALONE) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await settingsApi.save({
        interval_seconds: interval,
        service_check_enabled: serviceCheckEnabled,
        service_check_interval: serviceInterval,
      })
      if (pmConfig) {
        // Connection config (host/port/token/verify) is env-only; only the
        // auto-sync activation is persisted.
        await proxmoxApi.saveConfig({
          sync_enabled: pmSyncEnabled,
          sync_interval: pmInterval,
        })
      }
      if (zbConfig) {
        // MQTT connection config is env-only; only the activation is persisted.
        await zigbeeApi.saveConfig({
          sync_enabled: zbSyncEnabled,
          sync_interval: zbInterval,
        })
      }
      if (zwConfig) {
        await zwaveApi.saveConfig({
          sync_enabled: zwSyncEnabled,
          sync_interval: zwInterval,
        })
      }
      toast.success('Settings saved')
      onClose()
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Settings</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 py-2">
          {/* Left column */}
          <div className="space-y-5">
          {/* Status checker */}
          {!STANDALONE && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Status check interval (s)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={3600}
                value={interval}
                onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setIntervalValue(v) }}
                className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              How often node health is polled (ping, HTTP, SSH…)
            </p>

            <label className="flex items-center justify-between gap-2 cursor-pointer pt-2">
              <span className="text-xs text-foreground">Check services individually</span>
              <input
                type="checkbox"
                checked={serviceCheckEnabled}
                onChange={(e) => setServiceCheckEnabled(e.target.checked)}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle per-service status checks"
              />
            </label>

            <div className={serviceCheckEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">Service check interval (s)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={serviceInterval}
                  onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setServiceInterval(v) }}
                  className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
                  aria-label="Service check interval"
                />
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Probes each service port. Offline services turn red. Default 300s (5 min).
              </p>
            </div>
          </div>
          )}

          {/* Canvas */}
          <div className="pt-3 border-t border-border space-y-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Canvas</span>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">Snap to nodes</span>
              <input
                type="checkbox"
                checked={alignment.enabled}
                onChange={(e) => updateAlignment({ enabled: e.target.checked })}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle alignment guides"
              />
            </label>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">Hide IP addresses</span>
              <input
                type="checkbox"
                checked={hideIp}
                onChange={(e) => setHideIp(e.target.checked)}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle IP address masking"
              />
            </label>

            <div className={alignment.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">Snap distance</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={2}
                  max={16}
                  step={1}
                  value={alignment.threshold}
                  onChange={(e) => updateAlignment({ threshold: Number(e.target.value) })}
                  className="flex-1 cursor-pointer accent-[#00d4ff]"
                  aria-label="Alignment snap threshold"
                />
                <span className="font-mono text-[11px] text-foreground w-8 text-right">{alignment.threshold}px</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Distance at which dragged nodes snap to neighbours. Hold Alt while dragging to disable.
              </p>
            </div>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">Autosave canvas</span>
              <input
                type="checkbox"
                checked={autosave.enabled}
                onChange={(e) => updateAutosave({ enabled: e.target.checked })}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle autosave"
              />
            </label>

            <div className={autosave.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">Save after</label>
              <div className="flex items-center gap-2">
                <select
                  value={autosave.delay}
                  onChange={(e) => updateAutosave({ delay: Number(e.target.value) })}
                  disabled={!autosave.enabled}
                  className="px-2 py-1 rounded-md text-xs bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
                  aria-label="Autosave delay"
                >
                  <option value={3}>3 s</option>
                  <option value={5}>5 s</option>
                  <option value={10}>10 s</option>
                  <option value={30}>30 s</option>
                  <option value={60}>60 s</option>
                </select>
                <span className="text-xs text-muted-foreground">of inactivity</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Saves silently after this many seconds with no changes. Manual Ctrl+S still works.
              </p>
            </div>
          </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
          {/* Zigbee auto-sync */}
          {!STANDALONE && zbConfig && (
            <MeshAutoSync
              title="Zigbee auto-sync"
              accent="#39d353"
              hostConfigured={zbConfig.host_configured}
              envHostVar="ZIGBEE_MQTT_HOST"
              enabled={zbSyncEnabled}
              onEnabledChange={setZbSyncEnabled}
              interval={zbInterval}
              onIntervalChange={setZbInterval}
              description="Re-imports the Zigbee mesh into the pending inventory. Min 300s (5 min)."
              syncing={zbSyncing}
              onSyncNow={handleZbSyncNow}
            />
          )}

          {/* Z-Wave auto-sync */}
          {!STANDALONE && zwConfig && (
            <MeshAutoSync
              title="Z-Wave auto-sync"
              accent="#a855f7"
              hostConfigured={zwConfig.host_configured}
              envHostVar="ZWAVE_MQTT_HOST"
              enabled={zwSyncEnabled}
              onEnabledChange={setZwSyncEnabled}
              interval={zwInterval}
              onIntervalChange={setZwInterval}
              description="Re-imports the Z-Wave network into the pending inventory. Min 300s (5 min)."
              syncing={zwSyncing}
              onSyncNow={handleZwSyncNow}
            />
          )}

          {/* Proxmox auto-sync */}
          {!STANDALONE && pmConfig && (
          <div className="pt-3 border-t border-border space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proxmox auto-sync</span>
            {!pmConfig.token_configured ? (
              <p className="text-[10px] text-[#e3b341] leading-tight">
                No API token configured. Set <span className="font-mono">PROXMOX_TOKEN_ID</span> and{' '}
                <span className="font-mono">PROXMOX_TOKEN_SECRET</span> in the server .env to enable auto-sync.
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-xs text-foreground">Auto-sync Proxmox inventory</span>
                  <input
                    type="checkbox"
                    checked={pmSyncEnabled}
                    onChange={(e) => setPmSyncEnabled(e.target.checked)}
                    className="cursor-pointer accent-[#e57000]"
                    aria-label="Toggle Proxmox auto-sync"
                  />
                </label>
                <div className={pmSyncEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
                  <label className="text-xs text-muted-foreground">Sync interval (s)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={300}
                      max={86400}
                      value={pmInterval}
                      onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setPmInterval(v) }}
                      className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#e57000]"
                      aria-label="Proxmox sync interval"
                    />
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Re-imports hosts/VMs/LXC into the pending inventory. Min 300s (5 min).
                  </p>
                </div>
                {pmConfig.host ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={handleSyncNow}
                      disabled={pmSyncing}
                      className="h-7 text-xs border-[#e57000] text-[#e57000] hover:bg-[#e57000]/10"
                    >
                      {pmSyncing ? 'Syncing…' : 'Re-sync now'}
                    </Button>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      Runs one import immediately using the server .env config.
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#e3b341] leading-tight pt-1">
                    Set <span className="font-mono">PROXMOX_HOST</span> in the server .env to enable manual re-sync.
                  </p>
                )}
              </>
            )}
          </div>
          )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            style={{ background: '#00d4ff', color: '#0d1117' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
