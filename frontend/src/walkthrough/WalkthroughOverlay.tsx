import { useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalkthroughStore } from '@/stores/walkthroughStore'
import { useWalkthroughActions } from './actions'
import { getSteps, type StepPlacement } from './steps'
import './walkthrough.css'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const CARD_W = 320
const CARD_H_EST = 210
const GAP = 16
const PAD = 6 // spotlight padding around the target

/** Coach-card position from the target rect + requested placement. */
function cardPosition(rect: DOMRect | null, placement: StepPlacement): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampL = (l: number) => Math.max(8, Math.min(l, vw - CARD_W - 8))
  const clampT = (t: number) => Math.max(8, Math.min(t, vh - CARD_H_EST - 8))
  if (!rect) return { left: clampL((vw - CARD_W) / 2), top: clampT((vh - CARD_H_EST) / 2) }

  let side = placement
  if (side === 'auto') {
    side = rect.right + GAP + CARD_W < vw ? 'right' : rect.left - GAP - CARD_W > 0 ? 'left' : 'bottom'
  }
  switch (side) {
    case 'right': return { left: clampL(rect.right + GAP), top: clampT(rect.top) }
    case 'left': return { left: clampL(rect.left - GAP - CARD_W), top: clampT(rect.top) }
    case 'top': return { left: clampL(rect.left), top: clampT(rect.top - GAP - CARD_H_EST) }
    case 'bottom': return { left: clampL(rect.left), top: clampT(rect.bottom + GAP) }
    case 'center':
    default: return { left: clampL((vw - CARD_W) / 2), top: clampT((vh - CARD_H_EST) / 2) }
  }
}

/**
 * Position the card relative to an OPEN MODAL (the step's real subject).
 * Large modals (inventory, scan history at ~90vw) leave no room beside them, so
 * the card drops into the empty bottom-right corner instead of covering content.
 * Small modals get the card beside them, on whichever side has room.
 */
function dialogCardPosition(rect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampT = (t: number) => Math.max(8, Math.min(t, vh - CARD_H_EST - 8))
  const isLarge = rect.width > vw * 0.6 || rect.height > vh * 0.7
  if (isLarge) return { left: vw - CARD_W - 16, top: vh - CARD_H_EST - 16 }
  if (rect.left >= CARD_W + GAP * 2) return { left: rect.left - GAP - CARD_W, top: clampT(rect.top) }
  if (vw - rect.right >= CARD_W + GAP * 2) return { left: rect.right + GAP, top: clampT(rect.top) }
  return { left: Math.max(8, Math.min(rect.left, vw - CARD_W - 8)), top: clampT(rect.bottom + GAP) }
}

export function WalkthroughOverlay() {
  const { isActive, stepIndex, total, setTotal, next, prev, skip } = useWalkthroughStore()
  const actions = useWalkthroughActions()
  const steps = useMemo(() => getSteps(STANDALONE), [])
  const step = steps[stepIndex]

  // anchorRect: the element the step rings (sidebar/toolbar button). dialogRect:
  // any open app modal, always kept lit so it stays readable during modal steps.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [dialogRect, setDialogRect] = useState<DOMRect | null>(null)

  // Keep the store's total in sync with the mode-filtered step list.
  useEffect(() => {
    if (isActive) setTotal(steps.length)
  }, [isActive, steps.length, setTotal])

  // Run the step's action on enter (close leftovers, open the right modal / inject
  // demo data). Close everything when the tour ends.
  useEffect(() => {
    if (!actions) return
    if (!isActive) { actions.closeAll(); return }
    actions.closeAll()
    const key = step?.action as keyof typeof actions | undefined
    if (key && typeof actions[key] === 'function') (actions[key] as () => void)()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, stepIndex, actions])

  // Track target rects. Polls each frame because modals mount asynchronously after
  // the step action fires, and layout shifts as they animate in.
  useEffect(() => {
    if (!isActive) return
    let raf = 0
    const update = () => {
      const anchorEl = step?.anchor ? document.querySelector(step.anchor) : null
      setAnchorRect(anchorEl ? anchorEl.getBoundingClientRect() : null)
      // Any open app modal, excluding our own coach card (inside the overlay).
      const dialogEl = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((el) => !el.closest('[data-walkthrough-overlay]'))
      setDialogRect(dialogEl ? dialogEl.getBoundingClientRect() : null)
      raf = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [isActive, stepIndex, step?.anchor])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    else if (e.key === 'Escape') { e.preventDefault(); skip() }
  }, [next, prev, skip])

  useEffect(() => {
    if (!isActive) return
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isActive, handleKey])

  // Flag the tour so app-modal backdrops drop their own dim/blur (see
  // walkthrough.css) — the spotlight then dims consistently everywhere.
  useEffect(() => {
    if (!isActive) return
    document.body.classList.add('walkthrough-running')
    return () => document.body.classList.remove('walkthrough-running')
  }, [isActive])

  if (!isActive || !step) return null

  const isLast = stepIndex >= total - 1
  // Ring the step's anchor (sidebar/toolbar button) if it has one, else the modal.
  const ringRect = anchorRect ?? dialogRect
  // The card follows the OPEN MODAL when there is one (that's what the user reads),
  // otherwise the step's anchor. Keeps the card off the modal's content.
  const pos = dialogRect
    ? dialogCardPosition(dialogRect)
    : cardPosition(anchorRect, step.placement ?? 'auto')
  // Cut-outs keep both the ringed control and any open modal lit.
  const holes = [anchorRect, dialogRect].filter((r): r is DOMRect => r !== null)

  return createPortal(
    <div className="fixed inset-0 z-[100]" data-walkthrough-overlay>
      {/* Backdrop: dim everything except the cut-out holes (multi-hole SVG mask so
          a ringed button AND an open modal can both stay readable). */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="wt-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {holes.map((r, i) => (
              <rect
                key={i}
                x={r.left - PAD}
                y={r.top - PAD}
                width={r.width + PAD * 2}
                height={r.height + PAD * 2}
                rx="10"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="#010409" fillOpacity="0.72" mask="url(#wt-spotlight-mask)" />
      </svg>

      {/* Pulsing ring on the primary target */}
      {ringRect && (
        <div
          className="walkthrough-spotlight--pulse pointer-events-none absolute rounded-lg border-2 border-[#00d4ff]"
          style={{
            left: ringRect.left - PAD,
            top: ringRect.top - PAD,
            width: ringRect.width + PAD * 2,
            height: ringRect.height + PAD * 2,
            transition: 'left 0.25s, top 0.25s, width 0.25s, height 0.25s',
          }}
        />
      )}

      {/* Coach card */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Getting started walkthrough"
        className="walkthrough-card-enter absolute pointer-events-auto rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-2xl"
        style={{ left: pos.left, top: pos.top, width: CARD_W, transition: 'left 0.25s, top 0.25s' }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
          <button
            onClick={skip}
            aria-label="Skip walkthrough"
            className="shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>

        {step.link && (
          <a
            href={step.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#00d4ff] hover:underline"
          >
            {step.link.label} <ArrowRight size={12} />
          </a>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'w-4 bg-[#00d4ff]' : 'w-1.5 bg-[#30363d]'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] font-mono text-muted-foreground">
              {stepIndex + 1}/{steps.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous step"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={prev}
              disabled={stepIndex === 0}
            >
              <ArrowLeft size={13} />
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
              onClick={next}
            >
              {isLast ? 'Finish' : <>Next <ArrowRight size={13} className="ml-1" /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
