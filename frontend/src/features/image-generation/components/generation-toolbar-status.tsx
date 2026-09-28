import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** DOM id of the generation page toolbar slot that provider panels portal their status into. */
export const GENERATION_TOOLBAR_STATUS_SLOT_ID = 'generation-toolbar-status'

type GenerationToolbarStatusTone = 'ready' | 'warning' | 'off' | 'pending'

const DOT_TONE_CLASS: Record<GenerationToolbarStatusTone, string> = {
  ready: 'bg-success',
  warning: 'bg-warning',
  off: 'bg-muted-foreground/50',
  pending: 'animate-pulse bg-muted-foreground/50',
}

/** Compact provider connection state for the page toolbar: a dot, a short label and optional trailing chips/actions. */
export function GenerationToolbarStatus({ tone, label, children }: { tone: GenerationToolbarStatusTone; label: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT_TONE_CLASS[tone])} />
        <span className="truncate">{label}</span>
      </span>
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
