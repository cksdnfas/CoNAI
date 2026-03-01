import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GroupTileBaseProps {
  ariaLabel: string
  onClick: () => void
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  preview?: ReactNode
  fallbackPreview?: ReactNode
  secondaryAction?: ReactNode
  className?: string
}

export function GroupTileBase({
  ariaLabel,
  onClick,
  title,
  subtitle,
  badges,
  preview,
  fallbackPreview,
  secondaryAction,
  className,
}: GroupTileBaseProps) {
  return (
    <div className={cn('group relative aspect-[5/7] w-full overflow-hidden rounded-md border bg-card text-left transition hover:-translate-y-1 hover:shadow-lg', className)}>
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={ariaLabel}
      />

      {preview ? (
        <div className="pointer-events-none absolute inset-0" data-testid="group-tile-preview">
          {preview}
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-b from-muted/20 to-muted/60" data-testid="group-tile-fallback">
          {fallbackPreview ?? <Folder className="h-12 w-12 text-muted-foreground" />}
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent" />

      {secondaryAction ? <div className="absolute right-2 bottom-2 z-20">{secondaryAction}</div> : null}

      <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 space-y-1 p-2">
        <div className="truncate text-sm font-medium text-white">{title}</div>

        {subtitle ? <div className="truncate text-[11px] text-white/80">{subtitle}</div> : null}

        {badges ? <div className="flex flex-wrap gap-1">{badges}</div> : null}
      </div>
    </div>
  )
}
