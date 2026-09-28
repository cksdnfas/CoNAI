import type { ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
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
  expandedLabel: expandedLabelProp,
  collapsedLabel: collapsedLabelProp,
  expandedContent,
  className,
  innerClassName,
  contentClassName,
}: CompactGenerationControllerActionBarProps) {
  const { t } = useI18n()
  const expandedLabel = expandedLabelProp ?? t({ ko: '접기', en: 'Collapse' })
  const collapsedLabel = collapsedLabelProp ?? t({ ko: '컨트롤 열기', en: 'Open controls' })
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[86] flex justify-start px-3', className)}>
      <div className={cn('pointer-events-auto flex w-full items-center gap-2', innerClassName)}>
        <Button
          type="button"
          size={isExpanded ? 'icon-sm' : 'sm'}
          className={cn(
            'shrink-0 rounded-sm border border-primary/70 bg-primary text-primary-foreground shadow-[0_12px_32px_rgba(0,0,0,0.28)] hover:bg-primary/90',
            isExpanded ? 'w-10 px-0' : 'min-w-0 max-w-[min(16rem,calc(100vw-1.5rem))] px-3',
          )}
          onClick={onToggle}
          aria-label={isExpanded ? expandedLabel : collapsedLabel}
          title={isExpanded ? expandedLabel : collapsedLabel}
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : (
            <>
              <SlidersHorizontal className="h-4 w-4" />
              <span className="truncate">{collapsedLabel}</span>
            </>
          )}
        </Button>

        <div className={cn('h-px flex-1 transition-opacity duration-200', isExpanded ? 'bg-border/60 opacity-100' : 'bg-border/0 opacity-0')} />

        <div
          className={cn(
            'ml-auto min-w-0 origin-right transition-all duration-200',
            isExpanded ? 'translate-x-0 scale-100 opacity-100' : 'pointer-events-none translate-x-2 scale-95 opacity-0',
            contentClassName,
          )}
        >
          {expandedContent}
        </div>
      </div>
    </div>
  )
}

type GenerationControllerFieldStackProps = {
  children: ReactNode
  className?: string
}

/** Render the shared field stack for workflow controller inputs with separated cards. */
export function GenerationControllerFieldStack({ children, className }: GenerationControllerFieldStackProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {children}
    </div>
  )
}
