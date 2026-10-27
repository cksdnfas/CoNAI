import { useEffect, useState, type ReactNode } from 'react'
import { Chip } from '@/components/ui/chip'

/** DOM id of the generation page toolbar slot that provider panels portal their status into. */
export const GENERATION_TOOLBAR_STATUS_SLOT_ID = 'generation-toolbar-status'

type GenerationToolbarStatusTone = 'ready' | 'warning' | 'off' | 'pending'

const CHIP_TONE: Record<GenerationToolbarStatusTone, 'success' | 'warning' | 'muted'> = {
  ready: 'success',
  warning: 'warning',
  off: 'muted',
  pending: 'muted',
}

/** Provider connection state beside the engine tabs: a state chip and optional trailing chips/actions (same on every tab). */
export function GenerationToolbarStatus({ tone, label, children }: { tone: GenerationToolbarStatusTone; label: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Chip size="sm" tone={CHIP_TONE[tone]} className="max-w-full"><span className="truncate">{label}</span></Chip>
      {children}
    </div>
  )
}

/** Resolve a portal target by id after mount (the slot is rendered by the page, outside the panel tree). */
export function usePortalTargetById(id: string | undefined) {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!id || typeof document === 'undefined') {
      setTarget(null)
      return
    }

    setTarget(document.getElementById(id))
    const frame = window.requestAnimationFrame(() => setTarget(document.getElementById(id)))
    return () => window.cancelAnimationFrame(frame)
  }, [id])

  return target
}
