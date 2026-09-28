import type { DragEvent, ReactNode } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type MediaFileDropSurfaceProps = {
  active: boolean
  ariaLabel: string
  children?: ReactNode
  actions?: ReactNode
  /** Caption under the empty-state icon; defaults to a generic drop/browse hint. */
  hint?: ReactNode
  contentClassName?: string
  disabled?: boolean
  onClick: () => void
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnter: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void
}

/** Render one reusable empty or selected media drop target with sibling actions. */
export function MediaFileDropSurface({
  active,
  ariaLabel,
  children,
  actions,
  hint,
  contentClassName,
  disabled = false,
  onClick,
  onDrop,
  onDragEnter,
  onDragOver,
  onDragLeave,
}: MediaFileDropSurfaceProps) {
  const { t } = useI18n()

  return (
    <div
      className={cn(
        // Recessed tray with a dashed outline: the dash is the drop affordance, not a section divider.
        'relative overflow-hidden rounded-sm border-2 border-dashed transition-colors',
        active ? 'border-primary bg-primary/6' : 'border-outline-input bg-surface-lowest hover:border-primary/30 hover:bg-surface-container',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onClick}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn('flex min-h-44 w-full items-center justify-center p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', contentClassName)}
      >
        {children ?? (
          <span className="flex flex-col items-center gap-3 text-center">
            <ImageIcon className={active ? 'h-10 w-10 text-primary' : 'h-10 w-10 text-muted-foreground'} />
            <span className="text-sm text-muted-foreground">{hint ?? t({ ko: '여기에 끌어다 놓거나 눌러서 골라 줘', en: 'Drop files here or click to browse' })}</span>
          </span>
        )}
      </button>

      {actions ? (
        <Panel tone="high" padding="none" className="absolute right-3 top-3 z-10 flex items-center gap-1 p-1 shadow-elevation-2">
          {actions}
        </Panel>
      ) : null}
    </div>
  )
}
