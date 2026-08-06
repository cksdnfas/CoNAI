import type { DragEvent, ReactNode } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type MediaFileDropSurfaceProps = {
  active: boolean
  ariaLabel: string
  children?: ReactNode
  actions?: ReactNode
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
  contentClassName,
  disabled = false,
  onClick,
  onDrop,
  onDragEnter,
  onDragOver,
  onDragLeave,
}: MediaFileDropSurfaceProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm border-2 border-dashed transition-colors',
        active ? 'border-primary bg-primary/6' : 'border-border bg-surface-low hover:border-primary/30 hover:bg-surface-high/60',
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
        className={cn('flex min-h-44 w-full items-center justify-center p-3 text-left', contentClassName)}
      >
        {children ?? <ImageIcon className={active ? 'h-12 w-12 text-primary' : 'h-12 w-12 text-muted-foreground'} />}
      </button>

      {actions ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-sm border border-border/70 bg-background/85 p-1 shadow-sm backdrop-blur-sm">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
