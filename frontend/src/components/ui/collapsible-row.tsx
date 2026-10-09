import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FieldInfo } from './field'

/** A hairline row that folds its content: chevron + title on the left, small controls on the right. */
export function CollapsibleRow({ title, info, meta, actions, defaultOpen = false, open: controlledOpen, onOpenChange, children }: {
  title: ReactNode
  /** Explanation in a tooltip behind a small info icon right after the row text. */
  info?: ReactNode
  /** Muted text after the title (kind, count…). */
  meta?: ReactNode
  /** Controls at the row end; clicks there do not toggle the row. */
  actions?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cn('flex min-w-0 cursor-pointer items-center gap-2 rounded-sm py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', !info && 'flex-1')}
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="truncate font-medium">{title}</span>
          {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
        </button>
        {info ? (
          <>
            <FieldInfo>{info}</FieldInfo>
            {/* The rest of the row still toggles, as it does without an info icon. */}
            <div aria-hidden className="min-h-11 flex-1 cursor-pointer self-stretch" onClick={() => setOpen(!open)} />
          </>
        ) : null}
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {open ? <div className="space-y-3 pb-4 pl-6">{children}</div> : null}
    </div>
  )
}
