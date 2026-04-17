import type { ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CompactGenerationControllerActionBarProps = {
  isExpanded: boolean
  onToggle: () => void
  expandedLabel?: string
  collapsedLabel?: string
  expandedContent?: ReactNode
  className?: string
  innerClassName?: string
  contentClassName?: string
}

/** Render the shared compact controller toggle bar used below 1-column generation drawers. */
export function CompactGenerationControllerActionBar({
  isExpanded,
  onToggle,
  expandedLabel = '접기',
  collapsedLabel = '컨트롤 열기',
  expandedContent,
  className,
  innerClassName,
  contentClassName,
}: CompactGenerationControllerActionBarProps) {
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 bottom-4 z-[86] flex justify-center px-4', className)}>
      <div className={cn('pointer-events-auto mx-auto flex w-full max-w-[26rem] items-center gap-2', innerClassName)}>
        <Button
          type="button"
          size="icon-sm"
          className="w-10 shrink-0 rounded-sm px-0"
          onClick={onToggle}
          aria-label={isExpanded ? expandedLabel : collapsedLabel}
          title={isExpanded ? expandedLabel : collapsedLabel}
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
        </Button>

        <div className="h-px flex-1 bg-border/60" />

        <div
          className={cn(
            'transition-all duration-200',
            isExpanded ? 'translate-x-0 scale-100 opacity-100' : 'pointer-events-none translate-x-3 scale-95 opacity-0',
            contentClassName,
          )}
        >
          {expandedContent}
        </div>
      </div>
    </div>
  )
}

type CompactGenerationActionSurfaceProps = {
  children: ReactNode
  className?: string
}

/** Render the shared compact action surface that keeps controller controls visually grouped. */
export function CompactGenerationActionSurface({ children, className }: CompactGenerationActionSurfaceProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden rounded-sm border border-border/80 bg-surface-container/92 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

type GenerationControllerFieldStackProps = {
  children: ReactNode
  className?: string
}

/** Render the shared dense stacked field shell for workflow controller inputs. */
export function GenerationControllerFieldStack({ children, className }: GenerationControllerFieldStackProps) {
  return (
    <div className={cn('overflow-hidden rounded-sm border border-border/85 divide-y divide-border/85 bg-surface-container/30', className)}>
      {children}
    </div>
  )
}
