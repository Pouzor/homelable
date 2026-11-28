import { useState, useCallback, useEffect } from 'react'
import { Plus, Save, ScanLine, ChevronLeft, ChevronRight, X, LayoutDashboard, Clock, Square, Settings, LogOut, Download, Type, PlusCircle, Pencil, Trash2, ChevronUp, ChevronDown, Rows3, BookOpen, Loader2 } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCanvasStore } from '@/stores/canvasStore'
import { useDesignStore } from '@/stores/designStore'
import { useAuthStore } from '@/stores/authStore'
import { authApi, designsApi, mediaApi } from '@/api/client'
import * as standaloneStorage from '@/utils/standaloneStorage'
import { resolveDesignIcon, DEFAULT_DESIGN_ICON } from '@/utils/designIcons'
import { DesignModal, type DesignFormData } from '@/components/modals/DesignModal'
import { useUiStore } from '@/stores/uiStore'
import { useDocsStore } from '@/documentation/store'
import { AccessoryTray } from '@/rack/components/AccessoryTray'
import { useRackStore } from '@/rack/store'
import { freeUnits } from '@/rack/layout'
import type { Design } from '@/types'
import { toast } from 'sonner'
import { useLatestRelease } from '@/hooks/useLatestRelease'
import { useScanRunning } from '@/hooks/useScanRunning'
import { useIsMobile } from '@/hooks/useIsMobile'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

interface SidebarProps {
  onAddNode: () => void
  onAddGroupRect: () => void
  onAddText: () => void
  onScan: () => void
  onOpenImports: () => void
  onSave: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onOpenInventory: (deviceId?: string, status?: 'pending' | 'hidden') => void
}

export function Sidebar({ onAddNode, onAddGroupRect, onAddText, onScan, onOpenImports, onSave, onOpenSettings, onOpenHistory, onOpenInventory }: SidebarProps) {
  const [collapsedPref, setCollapsed] = useState(false)
  // Below `md` the sidebar is a drawer behind the hamburger: always full width,
  // never the icon rail.
  const isMobile = useIsMobile()
  const collapsed = collapsedPref && !isMobile
  const navOpen = useUiStore((s) => s.navOpen)
  const setNavOpen = useUiStore((s) => s.setNavOpen)
  const drawerHidden = isMobile && !navOpen
  const logout = useAuthStore((s) => s.logout)
  const { designs, activeDesignId, activeDesignType, setActiveDesign, addDesign, updateDesign, removeDesign, reorderDesigns } = useDesignStore()
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const isRack = activeDesignType === 'rack'
  const [designSwitcherOpen, setDesignSwitcherOpen] = useState(false)
  const [designModal, setDesignModal] = useState<{ mode: 'create' | 'edit'; design?: Design } | null>(null)
  // Bumped on every open so the modal remounts and re-seeds its local state from
  // the current floor plan — otherwise a reopen keeps stale width/height/lock
  // and Save would clobber canvas-side resize/move.
  const [openSeq, setOpenSeq] = useState(0)
  const { nodes, hasUnsavedChanges: canvasDirty, floorMap, setFloorMap } = useCanvasStore()
  const floorMapEditNonce = useCanvasStore((s) => s.floorMapEditNonce)
  const rackDirty = useRackStore((s) => s.hasUnsavedChanges)
  // Drives the Scan History spinner: a run is visible without opening the modal.
  const scanRunning = useScanRunning()
  const openDeviceEditor = useRackStore((s) => s.openDeviceEditor)
  const hasUnsavedChanges = isRack ? rackDirty : canvasDirty

  const handleLogout = useCallback(async () => {
    try {
      await authApi.logout()
      logout()
    } catch {
      toast.error('Could not end the current session')
    }
  }, [logout])

  const openDesignModal = useCallback((m: { mode: 'create' | 'edit'; design?: Design }) => {
    setOpenSeq((s) => s + 1)
    setDesignModal(m)
  }, [])

  const handleDesignSubmit = useCallback(async (data: DesignFormData) => {
    if (!designModal) return
    try {
      if (designModal.mode === 'create') {
        let created: Design
        if (data.sourceId) {
          // Copy from an existing canvas (nodes, edges, viewport, floor plan).
          created = STANDALONE
            ? standaloneStorage.copyDesign(data.sourceId, data.name, data.icon)
            : (await designsApi.copy(data.sourceId, { name: data.name, icon: data.icon })).data
        } else {
          const designType = data.designType ?? 'network'
          created = STANDALONE
            ? standaloneStorage.createDesign(data.name, data.icon, designType)
            : (await designsApi.create({ name: data.name, icon: data.icon, design_type: designType })).data
        }
        addDesign(created)
      } else if (designModal.design) {
        const updated = STANDALONE
          ? standaloneStorage.updateDesign(designModal.design.id, { name: data.name, icon: data.icon })
          : (await designsApi.update(designModal.design.id, { name: data.name, icon: data.icon })).data
        if (updated) updateDesign(updated.id, { name: updated.name, icon: updated.icon })
      }
      // Floor plan is canvas data attached to the active design. `undefined`
      // means the section wasn't shown → leave it untouched. Applied to the
      // store and persisted on the next explicit canvas Save. Not pushed to
      // undo history (floorMap isn't part of HistoryEntry).
      if (data.floorMap !== undefined) {
        setFloorMap(data.floorMap)
      }
      setDesignModal(null)
    } catch {
      toast.error(designModal.mode === 'create' ? 'Failed to create canvas' : 'Failed to update canvas')
    }
  }, [designModal, addDesign, updateDesign, setFloorMap])

  const handleDesignDelete = useCallback(async (d: Design) => {
    if (designs.length <= 1) { toast.error('Cannot delete the only canvas'); return }
    if (!window.confirm(`Delete canvas "${d.name}"? Its nodes and links will be removed.`)) return
    try {
      if (STANDALONE) {
        standaloneStorage.deleteDesign(d.id)
      } else {
        await designsApi.delete(d.id)
      }
      removeDesign(d.id)
      toast.success('Canvas deleted')
    } catch {
      toast.error('Failed to delete canvas')
    }
  }, [designs.length, removeDesign])

  // Swap a canvas with its neighbour. Applied at once, rolled back if the save fails.
  const handleDesignMove = useCallback(async (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= designs.length) return
    const previous = designs.map((d) => d.id)
    const ids = [...previous]
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorderDesigns(ids)
    try {
      if (STANDALONE) {
        standaloneStorage.reorderDesigns(ids)
      } else {
        await designsApi.reorder(ids)
      }
    } catch {
      reorderDesigns(previous)
      toast.error('Failed to reorder canvases')
    }
  }, [designs, reorderDesigns])

  const handleUploadImage = useCallback(async (file: File): Promise<string> => {
    try {
      const { url } = await mediaApi.upload(file)
      return url
    } catch {
      toast.error('Image upload failed')
      throw new Error('upload failed')
    }
  }, [])

  const isActiveEdit = designModal?.mode === 'edit' && designModal.design?.id === activeDesignId

  // Double-click on the floor plan (canvas) asks to edit the active canvas.
  useEffect(() => {
    if (floorMapEditNonce === 0) return
    const active = designs.find((d) => d.id === activeDesignId)
    if (active) openDesignModal({ mode: 'edit', design: active })
    // Only react to the nonce bump, not to design/active changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorMapEditNonce])

  const networkNodes = nodes.filter((n) => n.data.type !== 'groupRect' && n.data.type !== 'text')
  const onlineCount = networkNodes.filter((n) => n.data.status === 'online').length
  const offlineCount = networkNodes.filter((n) => n.data.status === 'offline').length

  // Escape closes the drawer, like any other overlay.
  useEffect(() => {
    if (!isMobile || !navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, navOpen, setNavOpen])

  const handleScan = useCallback(() => {
    onScan()
  }, [onScan])

  return (
    <>
    {isMobile && navOpen && (
      <div
        data-testid="nav-backdrop"
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/50 md:hidden"
        onClick={() => setNavOpen(false)}
      />
    )}
    <aside
      id="app-navigation"
      aria-label="Navigation"
      inert={drawerHidden}
      className={`fixed inset-y-0 left-0 z-50 flex w-[min(85vw,300px)] flex-col overflow-y-auto border-r border-border bg-popover shadow-2xl transition-transform duration-200 ${navOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:inset-auto md:z-auto md:w-(--rail-width) md:translate-x-0 md:overflow-visible md:shadow-none md:transition-all shrink-0`}
      style={{ '--rail-width': collapsed ? '48px' : '220px' } as React.CSSProperties}
      data-collapsed={collapsed}
    >
      {/* Toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-6 z-10 hidden md:flex items-center justify-center w-6 h-6 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Logo */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-border overflow-hidden">
        <Logo size={28} showText={!collapsed} />
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="md:hidden flex items-center justify-center w-9 h-9 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Design Switcher */}
      {!collapsed && designs.length > 0 && (
        <div className="px-2 pt-2 pb-1 border-b border-border relative">
          <button
            onClick={() => setDesignSwitcherOpen((o) => !o)}
            data-tour="canvas-switcher"
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-medium bg-secondary border border-border hover:border-border transition-colors cursor-pointer"
          >
            {activeDesignId ? (() => {
              const active = designs.find((d) => d.id === activeDesignId)
              const Icon = resolveDesignIcon(active?.icon)
              return <><Icon size={14} className="shrink-0 text-primary" /><span className="truncate text-foreground">{active?.name ?? 'Select Canvas'}</span></>
            })() : <span className="text-muted-foreground">Select Canvas</span>}
          </button>
          {designSwitcherOpen && (
            <>
              {/* Overlay to close */}
              <div className="fixed inset-0 z-40" onClick={() => setDesignSwitcherOpen(false)} />
              <div className="absolute left-2 right-2 top-full mt-1 z-50 bg-secondary border border-border rounded-md shadow-xl overflow-hidden">
                {designs.map((d, index) => {
                  const Icon = resolveDesignIcon(d.icon)
                  const isActive = d.id === activeDesignId
                  return (
                    <div
                      key={d.id}
                      className={`group relative flex items-center transition-colors ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-border'
                      }`}
                    >
                      <button
                        onClick={() => { setActiveDesign(d.id); setDesignSwitcherOpen(false); setNavOpen(false) }}
                        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2.5 md:py-2 text-sm md:text-xs cursor-pointer hover:text-foreground"
                      >
                        <Icon size={14} className="shrink-0" />
                        <span className="truncate">{d.name}</span>
                      </button>
                      {/* Overlaid, not in the flow: hidden actions must not eat the name's width. */}
                      <div
                        data-testid="design-row-actions"
                        className="absolute inset-y-0 right-0 flex items-center bg-border pl-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity"
                      >
                        <button
                          aria-label={`Move ${d.name} up`}
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => handleDesignMove(index, -1)}
                          className="shrink-0 p-1 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-0 disabled:cursor-default"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          aria-label={`Move ${d.name} down`}
                          title="Move down"
                          disabled={index === designs.length - 1}
                          onClick={() => handleDesignMove(index, 1)}
                          className="shrink-0 p-1 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-0 disabled:cursor-default"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          aria-label={`Edit ${d.name}`}
                          title="Edit canvas"
                          onClick={() => { openDesignModal({ mode: 'edit', design: d }); setDesignSwitcherOpen(false) }}
                          className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          aria-label={`Delete ${d.name}`}
                          title="Delete canvas"
                          disabled={designs.length <= 1}
                          onClick={() => handleDesignDelete(d)}
                          className="shrink-0 p-1.5 pr-2 text-muted-foreground hover:text-destructive cursor-pointer disabled:opacity-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="border-t border-border" />
                <button
                  onClick={() => { openDesignModal({ mode: 'create' }); setDesignSwitcherOpen(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <PlusCircle size={14} />
                  <span>New Canvas</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Views */}
      <nav className="flex flex-col gap-0.5 p-2">
        <SidebarItem
          icon={isRack ? Rows3 : LayoutDashboard}
          label={isRack ? 'Rack view' : 'Canvas'}
          collapsed={collapsed}
          active={view === 'canvas'}
          onClick={() => setView('canvas')}
        />
        {!STANDALONE && (
          <SidebarItem
            icon={BookOpen}
            label="Documentation"
            collapsed={collapsed}
            active={view === 'documentation'}
            onClick={() => {
              setView('documentation')
              // Lands on the homepage, unless the open document has unsaved edits.
              void useDocsStore.getState().openHome()
            }}
            dataTour="documentation"
          />
        )}
        {/* The hidden devices are a filter of this same modal, reached from
            inside it — the sidebar carries the one entry point. */}
        {!STANDALONE && (
          <SidebarItem
            icon={ScanLine}
            label="Device Inventory"
            collapsed={collapsed}
            onClick={() => onOpenInventory(undefined, 'pending')}
          />
        )}
        {!STANDALONE && (
          <SidebarItem
            icon={scanRunning ? Loader2 : Clock}
            iconClassName={scanRunning ? 'animate-spin text-warning' : undefined}
            label="Scan History"
            collapsed={collapsed}
            onClick={onOpenHistory}
          />
        )}
      </nav>

      {/* The rack inventory is the sidebar's body: it scrolls, everything else
          stays pinned. On a logical canvas the space is just a spacer. */}
      {isRack && !collapsed ? <AccessoryTray /> : !collapsed && <div className="flex-1" />}

      {/* Stats footer — hidden in standalone (no scan / live status to count) */}
      {!collapsed && isRack && <RackStats />}
      {!collapsed && !isRack && !STANDALONE && (
        <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Total</span>
            <span className="text-foreground font-mono">{networkNodes.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-success">Online</span>
            <span className="font-mono text-success">{onlineCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-destructive">Offline</span>
            <span className="font-mono text-destructive">{offlineCount}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-0.5 p-2 border-t border-border">
        {isRack ? (
          <SidebarItem icon={Plus} label="Add Device" collapsed={collapsed} onClick={() => openDeviceEditor()} />
        ) : (
          <>
            <SidebarItem icon={Plus} label="Add Node" collapsed={collapsed} onClick={onAddNode} dataTour="add-node" />
            <SidebarItem icon={Square} label="Add Zone" collapsed={collapsed} onClick={onAddGroupRect} dataTour="add-zone" />
            <SidebarItem icon={Type} label="Add Text" collapsed={collapsed} onClick={onAddText} dataTour="add-text" />
          </>
        )}
        {!STANDALONE && !isRack && <SidebarItem icon={ScanLine} label="Scan Network" collapsed={collapsed} onClick={handleScan} dataTour="scan-network" />}
        {/* One entry for every import source — the list grows with each new
            integration and four near-identical links crowded the rail. */}
        {!STANDALONE && !isRack && <SidebarItem icon={Download} label="Import from…" collapsed={collapsed} onClick={onOpenImports} dataTour="imports" />}
        <SidebarItem
          icon={Save}
          label={isRack ? 'Save Rack' : 'Save Canvas'}
          collapsed={collapsed}
          onClick={() => onSave()}
          badge={hasUnsavedChanges}
          accent
        />
        <SidebarItem
          icon={Settings}
          label="Settings"
          collapsed={collapsed}
          onClick={onOpenSettings}
        />
        {!STANDALONE && (
          <SidebarItem
            icon={LogOut}
            label="Logout"
            collapsed={collapsed}
            onClick={() => void handleLogout()}
          />
        )}
      </div>

      {!collapsed && <VersionBadge />}

      <DesignModal
        key={`${designModal?.mode === 'edit' ? designModal.design?.id : 'create'}-${openSeq}`}
        open={!!designModal}
        onClose={() => setDesignModal(null)}
        onSubmit={handleDesignSubmit}
        initial={designModal?.mode === 'edit' && designModal.design
          ? { name: designModal.design.name, icon: designModal.design.icon ?? DEFAULT_DESIGN_ICON }
          : undefined}
        title={designModal?.mode === 'edit' ? 'Edit Canvas' : 'New Canvas'}
        submitLabel={designModal?.mode === 'edit' ? 'Save' : 'Create'}
        showFloorMap={!STANDALONE && isActiveEdit}
        initialFloorMap={!STANDALONE && isActiveEdit ? floorMap : null}
        onUploadImage={handleUploadImage}
        sourceDesigns={
          designModal?.mode === 'create'
            ? (STANDALONE ? standaloneStorage.listDesignsWithCounts() : designs)
            : []
        }
      />
    </aside>
    </>
  )
}

/** Rack equivalent of the node stats footer: capacity rather than reachability. */
function RackStats() {
  const racks = useRackStore((s) => s.racks)
  const devices = useRackStore((s) => s.devices)
  const cables = useRackStore((s) => s.cables)

  const free = racks.reduce((sum, rack) => sum + freeUnits(rack, devices), 0)
  const total = racks.reduce((sum, rack) => sum + rack.uHeight, 0)

  return (
    <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
      <div className="flex justify-between">
        <span>Racks</span>
        <span className="text-foreground font-mono">{racks.length}</span>
      </div>
      <div className="flex justify-between">
        <span>Mounted</span>
        <span className="text-foreground font-mono">{devices.length}</span>
      </div>
      <div className="flex justify-between">
        <span>Cables</span>
        <span className="text-foreground font-mono">{cables.length}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-success">Free</span>
        <span className="font-mono text-success">{free}U / {total}U</span>
      </div>
    </div>
  )
}

function VersionBadge() {
  const current = __APP_VERSION__
  const { latest, hasUpdate } = useLatestRelease(current)

  return (
    <div className="px-3 py-2 border-t border-border flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <a
          href={`https://github.com/Pouzor/homelable/releases/tag/v${current}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          v{current}
        </a>
        <span className="text-[11px] text-muted-foreground">-</span>
        <a
          href="https://homelable.net/changelog/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary hover:text-primary/80 transition-colors"
        >
          Changelog
        </a>
      </div>
      {hasUpdate && latest && (
        <a
          href={latest.url.startsWith('https://') ? latest.url : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors self-start"
        >
          ↑ v{latest.version} available
        </a>
      )}
    </div>
  )
}

interface SidebarItemProps {
  icon: React.ElementType
  /** Extra classes on the icon only (e.g. a spin while a scan runs). */
  iconClassName?: string
  label: string
  collapsed: boolean
  active?: boolean
  badge?: boolean
  accent?: boolean
  onClick?: () => void
  /** Stable anchor for the Getting Started walkthrough spotlight. */
  dataTour?: string
}

function SidebarItem({ icon: Icon, iconClassName, label, collapsed, active, badge, accent, onClick, dataTour }: SidebarItemProps) {
  // Every item either navigates or opens a modal, so on a phone the drawer
  // gets out of the way of what was just opened.
  const setNavOpen = useUiStore((s) => s.setNavOpen)
  const btn = (
    <button
      onClick={() => { onClick?.(); setNavOpen(false) }}
      data-tour={dataTour}
      className={`relative flex items-center gap-2 w-full px-2 py-2.5 md:py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
        active
          ? 'bg-primary/10 text-primary'
          : accent
          ? 'text-primary hover:bg-primary/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      <Icon size={16} className={`shrink-0${iconClassName ? ` ${iconClassName}` : ''}`} />
      {!collapsed && <span className="truncate">{label}</span>}
      {badge && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-warning" />
      )}
    </button>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger>{btn}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return btn
}
