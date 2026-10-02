import { useState, useEffect, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  settingsApi,
  proxmoxApi,
  zigbeeApi,
  zwaveApi,
  unifiApi,
  type ProxmoxConfigData,
  type ZigbeeConfigData,
  type ZwaveConfigData,
  type UnifiConfigData,
  type UnifiImportModes,
} from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'
import { useWalkthroughStore } from '@/stores/walkthroughStore'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'
import { t, useLocale } from '@/i18n'
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
  /** The bare source name ("Zigbee"), already translated — `title` reads
   *  "Zigbee auto-sync" and cannot be sliced back out of a translated string. */
  what: string
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
  /** Source-specific import options, applied to auto-sync and Re-sync now alike. */
  options?: ReactNode
}

/**
 * Auto-sync controls for an MQTT mesh import (Zigbee / Z-Wave). Mirrors the
 * Proxmox auto-sync block: connection config is env-only, so this only toggles
 * the scheduled activation + interval and offers an immediate re-sync. When no
 * MQTT host is set in the server env, it shows how to configure one instead.
 */
function MeshAutoSync({
  title, what, accent, hostConfigured, envHostVar, enabled, onEnabledChange,
  interval, onIntervalChange, description, syncing, onSyncNow, options,
}: MeshAutoSyncProps) {
  useLocale()
  return (
    <div className="pt-3 border-t border-border space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      {!hostConfigured ? (
        <p className="text-[10px] text-[#e3b341] leading-tight">
          {t('No MQTT host configured. Set')} <span className="font-mono">{envHostVar}</span> {t('in the server .env to enable auto-sync.')}
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs text-foreground">{t('Auto-sync {what} inventory', { what })}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="cursor-pointer"
              style={{ accentColor: accent }}
              aria-label={t('Toggle {what}', { what: title })}
            />
          </label>
          <div className={enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
            <label className="text-xs text-muted-foreground">{t('Sync interval (s)')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={300}
                max={86400}
                value={interval}
                onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onIntervalChange(v) }}
                className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none"
                aria-label={t('{what} interval', { what: title })}
              />
              <span className="text-xs text-muted-foreground">{t('seconds')}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
          </div>
          {options}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onSyncNow}
              disabled={syncing}
              className="h-7 text-xs"
              style={{ borderColor: accent, color: accent }}
            >
              {syncing ? t('Syncing…') : t('Re-sync now')}
            </Button>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {t('Runs one import immediately using the server .env config.')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/** The controller's three inventories, described where the user ticks them. */
// Mirrors UnifiSyncConfig.sync_interval (ge=300, le=86400) on the backend.
const UNIFI_MIN_INTERVAL = 300
const UNIFI_MAX_INTERVAL = 86400

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
  const [zbMeshLinks, setZbMeshLinks] = useState(false)
  const [zbSyncing, setZbSyncing] = useState(false)
  const [zwConfig, setZwConfig] = useState<ZwaveConfigData | null>(null)
  const [zwSyncEnabled, setZwSyncEnabled] = useState(false)
  const [zwInterval, setZwInterval] = useState(3600)
  const [zwSyncing, setZwSyncing] = useState(false)
  const [unConfig, setUnConfig] = useState<UnifiConfigData | null>(null)
  const [unSyncEnabled, setUnSyncEnabled] = useState(false)
  const [unInterval, setUnInterval] = useState(3600)
  const [unModes, setUnModes] = useState<UnifiImportModes>({
    infrastructure: true,
    known_clients: false,
    active_clients: false,
  })
  const [unSyncing, setUnSyncing] = useState(false)
  const [alignment, setAlignment] = useState<AlignmentSettings>(readAlignmentSettings)
  const [autosave, setAutosave] = useState<AutosaveSettings>(readAutosaveSettings)
  useLocale()
  // Built inside the component so the labels go through `t`; a module-level
  // table would be created once at import, before the locale is known.
  const unifiSources: { key: keyof UnifiImportModes; label: string; hint: string }[] = [
    { key: 'infrastructure', label: t('Infrastructure'), hint: t('stat/device — adopted APs, switches, gateways.') },
    { key: 'known_clients', label: t('Known clients'), hint: t('list/user — every client ever recorded. No IP, and long on a busy site.') },
    { key: 'active_clients', label: t('Active clients'), hint: t('stat/sta — connected right now, with IP and switch port.') },
  ]
  const anyUnifiSource = unModes.infrastructure || unModes.known_clients || unModes.active_clients
  // Saving with every source unticked 422s on the backend, aborting the save
  // after the other configs already persisted — refuse it up front instead.
  const unifiBlocksSave = !STANDALONE && unConfig !== null && !anyUnifiSource
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
        setZbMeshLinks(res.data.include_mesh_links)
      })
      .catch(() => {/* zigbee not configured */})
    zwaveApi.getConfig()
      .then((res) => {
        setZwConfig(res.data)
        setZwSyncEnabled(res.data.sync_enabled)
        setZwInterval(res.data.sync_interval)
      })
      .catch(() => {/* zwave not configured */})
    unifiApi.getConfig()
      .then((res) => {
        setUnConfig(res.data)
        setUnSyncEnabled(res.data.sync_enabled)
        setUnInterval(res.data.sync_interval)
        setUnModes(res.data.modes)
      })
      .catch(() => {/* unifi not configured */})
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
      toast.success(t('Proxmox sync started'))
    } catch {
      toast.error(t('Failed to start Proxmox sync'))
    } finally {
      setPmSyncing(false)
    }
  }

  const handleUnSyncNow = async () => {
    setUnSyncing(true)
    try {
      const res = await unifiApi.syncNow()
      const { infra_count, client_count } = res.data
      toast.success(t('UniFi sync done — {infra} device(s), {clients} client(s)', { infra: infra_count, clients: client_count }))
    } catch {
      toast.error(t('Failed to run UniFi sync'))
    } finally {
      setUnSyncing(false)
    }
  }

  const handleZbSyncNow = async () => {
    setZbSyncing(true)
    try {
      await zigbeeApi.syncNow()
      toast.success(t('Zigbee sync started'))
    } catch {
      toast.error(t('Failed to start Zigbee sync'))
    } finally {
      setZbSyncing(false)
    }
  }

  const handleZwSyncNow = async () => {
    setZwSyncing(true)
    try {
      await zwaveApi.syncNow()
      toast.success(t('Z-Wave sync started'))
    } catch {
      toast.error(t('Failed to start Z-Wave sync'))
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
          include_mesh_links: zbMeshLinks,
        })
      }
      if (zwConfig) {
        await zwaveApi.saveConfig({
          sync_enabled: zwSyncEnabled,
          sync_interval: zwInterval,
        })
      }
      if (unConfig) {
        // Connection config is env-only; the activation and which of the
        // controller's three inventories to pull are what persist.
        // Clamp: the input's min/max never stopped a typed value, and a
        // sync_interval outside the range 422s — which would abort the save
        // after the configs above already persisted.
        const clamped = Math.min(UNIFI_MAX_INTERVAL, Math.max(UNIFI_MIN_INTERVAL, Math.round(unInterval)))
        if (clamped !== unInterval) setUnInterval(clamped)
        await unifiApi.saveConfig({
          sync_enabled: unSyncEnabled,
          sync_interval: clamped,
          modes: unModes,
        })
      }
      toast.success(t('Settings saved'))
      onClose()
    } catch {
      toast.error(t('Failed to save settings'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('Settings')}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 py-2">
          {/* Left column */}
          <div className="space-y-5">
          {/* Language. Applies immediately and is remembered in this browser, so
              it lives outside the save button on purpose. */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('Language')}</span>
            <LanguageSwitcher showLabel label={t('Interface language')} />
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('Applies to this browser only, right away.')}
            </p>
          </div>
          {/* Status checker */}
          {!STANDALONE && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t('Status check interval (s)')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={3600}
                value={interval}
                onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setIntervalValue(v) }}
                className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
              />
              <span className="text-xs text-muted-foreground">{t('seconds')}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('How often node health is polled (ping, HTTP, SSH…)')}
            </p>

            <label className="flex items-center justify-between gap-2 cursor-pointer pt-2">
              <span className="text-xs text-foreground">{t('Check services individually')}</span>
              <input
                type="checkbox"
                checked={serviceCheckEnabled}
                onChange={(e) => setServiceCheckEnabled(e.target.checked)}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label={t('Toggle per-service status checks')}
              />
            </label>

            <div className={serviceCheckEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">{t('Service check interval (s)')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={serviceInterval}
                  onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setServiceInterval(v) }}
                  className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
                  aria-label={t('Service check interval')}
                />
                <span className="text-xs text-muted-foreground">{t('seconds')}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {t('Probes each service port. Offline services turn red. Default 300s (5 min).')}
              </p>
            </div>
          </div>
          )}

          {/* Canvas */}
          <div className="pt-3 border-t border-border space-y-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('Canvas')}</span>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">{t('Snap to nodes')}</span>
              <input
                type="checkbox"
                checked={alignment.enabled}
                onChange={(e) => updateAlignment({ enabled: e.target.checked })}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label={t('Toggle alignment guides')}
              />
            </label>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">{t('Hide IP addresses')}</span>
              <input
                type="checkbox"
                checked={hideIp}
                onChange={(e) => setHideIp(e.target.checked)}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label={t('Toggle IP address masking')}
              />
            </label>

            <div className={alignment.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">{t('Snap distance')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={2}
                  max={16}
                  step={1}
                  value={alignment.threshold}
                  onChange={(e) => updateAlignment({ threshold: Number(e.target.value) })}
                  className="flex-1 cursor-pointer accent-[#00d4ff]"
                  aria-label={t('Alignment snap threshold')}
                />
                <span className="font-mono text-[11px] text-foreground w-8 text-right">{alignment.threshold}px</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {t('Distance at which dragged nodes snap to neighbours. Hold Alt while dragging to disable.')}
              </p>
            </div>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">{t('Autosave canvas')}</span>
              <input
                type="checkbox"
                checked={autosave.enabled}
                onChange={(e) => updateAutosave({ enabled: e.target.checked })}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label={t('Toggle autosave')}
              />
            </label>

            <div className={autosave.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">{t('Save after')}</label>
              <div className="flex items-center gap-2">
                <select
                  value={autosave.delay}
                  onChange={(e) => updateAutosave({ delay: Number(e.target.value) })}
                  disabled={!autosave.enabled}
                  className="px-2 py-1 rounded-md text-xs bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
                  aria-label={t('Autosave delay')}
                >
                  <option value={3}>3 s</option>
                  <option value={5}>5 s</option>
                  <option value={10}>10 s</option>
                  <option value={30}>30 s</option>
                  <option value={60}>60 s</option>
                </select>
                <span className="text-xs text-muted-foreground">{t('of inactivity')}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {t('Saves silently after this many seconds with no changes. Manual Ctrl+S still works.')}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground">{t('Getting started tour')}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { useWalkthroughStore.getState().start(); onClose() }}
              >
                {t('Restart walkthrough')}
              </Button>
            </div>
          </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
          {/* Zigbee auto-sync */}
          {!STANDALONE && zbConfig && (
            <MeshAutoSync
              title={t('Zigbee auto-sync')}
              what={t('Zigbee')}
              accent="#39d353"
              hostConfigured={zbConfig.host_configured}
              envHostVar="ZIGBEE_MQTT_HOST"
              enabled={zbSyncEnabled}
              onEnabledChange={setZbSyncEnabled}
              interval={zbInterval}
              onIntervalChange={setZbInterval}
              description={t('Re-imports the Zigbee mesh into the pending inventory. Min 300s (5 min).')}
              syncing={zbSyncing}
              onSyncNow={handleZbSyncNow}
              options={
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-xs text-foreground">
                    {t('Import mesh links')}
                    <span className="block text-[10px] text-muted-foreground leading-tight">
                      {t('Neighbour links too, not only the parent tree — many more edges.')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={zbMeshLinks}
                    onChange={(e) => setZbMeshLinks(e.target.checked)}
                    className="cursor-pointer"
                    style={{ accentColor: '#39d353' }}
                    aria-label={t('Import Zigbee mesh links')}
                  />
                </label>
              }
            />
          )}

          {/* Z-Wave auto-sync */}
          {!STANDALONE && zwConfig && (
            <MeshAutoSync
              title={t('Z-Wave auto-sync')}
              what={t('Z-Wave')}
              accent="#a855f7"
              hostConfigured={zwConfig.host_configured}
              envHostVar="ZWAVE_MQTT_HOST"
              enabled={zwSyncEnabled}
              onEnabledChange={setZwSyncEnabled}
              interval={zwInterval}
              onIntervalChange={setZwInterval}
              description={t('Re-imports the Z-Wave network into the pending inventory. Min 300s (5 min).')}
              syncing={zwSyncing}
              onSyncNow={handleZwSyncNow}
            />
          )}

          {/* Proxmox auto-sync */}
          {!STANDALONE && pmConfig && (
          <div className="pt-3 border-t border-border space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('Proxmox auto-sync')}</span>
            {!pmConfig.token_configured ? (
              <p className="text-[10px] text-[#e3b341] leading-tight">
                {t('No API token configured. Set')} <span className="font-mono">PROXMOX_TOKEN_ID</span> {t('and')}{' '}
                <span className="font-mono">PROXMOX_TOKEN_SECRET</span> {t('in the server .env to enable auto-sync.')}
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-xs text-foreground">{t('Auto-sync Proxmox inventory')}</span>
                  <input
                    type="checkbox"
                    checked={pmSyncEnabled}
                    onChange={(e) => setPmSyncEnabled(e.target.checked)}
                    className="cursor-pointer accent-[#e57000]"
                    aria-label={t('Toggle Proxmox auto-sync')}
                  />
                </label>
                <div className={pmSyncEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
                  <label className="text-xs text-muted-foreground">{t('Sync interval (s)')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={300}
                      max={86400}
                      value={pmInterval}
                      onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setPmInterval(v) }}
                      className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#e57000]"
                      aria-label={t('Proxmox sync interval')}
                    />
                    <span className="text-xs text-muted-foreground">{t('seconds')}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {t('Re-imports hosts/VMs/LXC into the pending inventory. Min 300s (5 min).')}
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
                      {pmSyncing ? t('Syncing…') : t('Re-sync now')}
                    </Button>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {t('Runs one import immediately using the server .env config.')}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#e3b341] leading-tight pt-1">
                    {t('Set')} <span className="font-mono">PROXMOX_HOST</span> {t('in the server .env to enable manual re-sync.')}
                  </p>
                )}
              </>
            )}
          </div>
          )}
          {/* UniFi auto-sync */}
          {!STANDALONE && unConfig && (
          <div className="pt-3 border-t border-border space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('UniFi auto-sync')}</span>
            {!unConfig.credentials_configured ? (
              <p className="text-[10px] text-[#e3b341] leading-tight">
                {t('No controller credentials configured. Set')} <span className="font-mono">UNIFI_USER</span> {t('and')}{' '}
                <span className="font-mono">UNIFI_PASS</span> {t('in the server .env to enable auto-sync.')}
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-xs text-foreground">{t('Auto-sync UniFi inventory')}</span>
                  <input
                    type="checkbox"
                    checked={unSyncEnabled}
                    onChange={(e) => setUnSyncEnabled(e.target.checked)}
                    className="cursor-pointer accent-[#0559c9]"
                    aria-label={t('Toggle UniFi auto-sync')}
                  />
                </label>
                <div className={unSyncEnabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
                  <label className="text-xs text-muted-foreground">{t('Sync interval (s)')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={300}
                      max={86400}
                      value={unInterval}
                      onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setUnInterval(v) }}
                      className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#0559c9]"
                      aria-label={t('UniFi sync interval')}
                    />
                    <span className="text-xs text-muted-foreground">{t('seconds')}</span>
                  </div>
                </div>
                {/* Which of the controller's three inventories to pull. Applies
                    to auto-sync and to Re-sync now, not to the import modal,
                    which asks each time. */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">{t('Import from')}</span>
                  {unifiSources.map((src) => (
                    <label key={src.key} className="flex items-start justify-between gap-2 cursor-pointer">
                      <span className="min-w-0">
                        <span className="text-xs text-foreground">{src.label}</span>
                        <span className="block text-[10px] text-muted-foreground leading-tight">{src.hint}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={unModes[src.key]}
                        onChange={(e) => setUnModes((m) => ({ ...m, [src.key]: e.target.checked }))}
                        className="mt-0.5 cursor-pointer accent-[#0559c9]"
                        aria-label={t('Import {what}', { what: src.label })}
                      />
                    </label>
                  ))}
                  {!anyUnifiSource && (
                    <p className="text-[10px] text-[#e3b341] leading-tight">
                      {t('Select at least one source, or the sync has nothing to import.')}
                    </p>
                  )}
                </div>
                {unConfig.host ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={handleUnSyncNow}
                      disabled={unSyncing || !anyUnifiSource}
                      className="h-7 text-xs border-[#0559c9] text-[#0559c9] hover:bg-[#0559c9]/10"
                    >
                      {unSyncing ? t('Syncing…') : t('Re-sync now')}
                    </Button>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {t('Runs one import immediately using the server .env config.')}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#e3b341] leading-tight pt-1">
                    {t('Set')} <span className="font-mono">UNIFI_HOST</span> {t('in the server .env to enable manual re-sync.')}
                  </p>
                )}
              </>
            )}
          </div>
          )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving || unifiBlocksSave}
            title={unifiBlocksSave ? t('Select at least one UniFi source to import.') : undefined}
            style={{ background: '#00d4ff', color: '#0d1117' }}
          >
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
