import { useEffect, useState } from 'react'
import { Compass, X } from 'lucide-react'
import './walkthrough.css'
import { Button } from '@/components/ui/button'
import { useWalkthroughStore } from '@/stores/walkthroughStore'
import {
  readWalkthrough,
  subscribeWalkthrough,
  shouldOfferWalkthrough,
  markWalkthroughSeen,
  type WalkthroughState,
} from '@/utils/walkthrough'

/**
 * First-run invite bubble (bottom-right, above the toaster).
 *
 *  - Not now         → hide for this session only (no write), reappears next load
 *  - Don't show again → persist as skipped, stops offering until the next version
 *  - Getting started  → launch the tour
 */
export function WalkthroughInvite() {
  const [state, setState] = useState<WalkthroughState>(readWalkthrough)
  useEffect(() => subscribeWalkthrough(setState), [])

  // "Not now" dismissal — session-local, not persisted.
  const [dismissedThisSession, setDismissedThisSession] = useState(false)

  const isActive = useWalkthroughStore((s) => s.isActive)
  const start = useWalkthroughStore((s) => s.start)

  if (isActive || dismissedThisSession || !shouldOfferWalkthrough(state)) return null

  return (
    <div className="fixed bottom-20 right-4 z-[90] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-2xl walkthrough-invite-enter">
      <button
        onClick={() => setDismissedThisSession(true)}
        aria-label="Not now"
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#00d4ff]/10 text-[#00d4ff]">
          <Compass size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">New here? Take the tour</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A 2-minute walkthrough of scanning, devices, and building your canvas.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => markWalkthroughSeen('skipped')}
        >
          Don't show again
        </Button>
        <Button
          size="sm"
          className="h-7 px-3 text-xs bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
          onClick={start}
        >
          Getting started
        </Button>
      </div>
    </div>
  )
}
