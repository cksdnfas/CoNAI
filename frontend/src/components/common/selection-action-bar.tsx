import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SelectionActionBarProps {
  selectedCount: number
  summary?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onClear?: () => void
  clearLabel?: string
  className?: string
}

/** Render a shared bottom action bar for selection-based workflows. */
export function SelectionActionBar({
  selectedCount,
  summary,
  description,
  actions,
  onClear,
  clearLabel = '선택 해제',
  className,
}: SelectionActionBarProps) {
  if (selectedCount <= 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
      <div
        className={cn(
          'theme-floating-panel theme-selection-bar pointer-events-auto flex max-w-full flex-wrap items-center gap-3 text-sm text-foreground',
          className,
        )}
      >
        <div className={cn('min-w-0', description ? 'flex min-w-[10rem] flex-1 flex-col leading-tight' : 'font-semibold')}>
          <span className="font-semibold">{summary ?? `${selectedCount.toLocaleString('ko-KR')}개 선택됨`}</span>
          {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
        </div>

        {onClear ? (
          <Button size="sm" variant="secondary" onClick={onClear} data-no-select-drag="true">
            <X className="h-4 w-4" />
            {clearLabel}
          </Button>
        ) : null}

        {actions}
      </div>
    </div>
  )
}
