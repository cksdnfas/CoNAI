import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'

/** Width from which selection bar actions show their text label next to the icon. */
const SELECTION_BAR_LABEL_MIN_WIDTH = 1024

interface SelectionBarActionProps extends Omit<ComponentProps<typeof Button>, 'children' | 'size' | 'aria-label'> {
  icon: ComponentType<{ className?: string }>
  /** Visible text on wide screens; tooltip and accessible name when the button is icon-only. */
  label: string
}

/**
 * One selection bar action: icon + text on wide screens, an icon button with a tooltip on narrow ones.
 * Marked so a drag-select never starts from it.
 */
export function SelectionBarAction({ icon: Icon, label, variant = 'secondary', ...props }: SelectionBarActionProps) {
  const showLabel = useMinWidth(SELECTION_BAR_LABEL_MIN_WIDTH)

  if (!showLabel) {
    return (
      <IconButton label={label} size="icon-sm" variant={variant} tooltipSide="top" data-no-select-drag="true" {...props}>
        <Icon className="h-4 w-4" />
      </IconButton>
    )
  }

  return (
    <Button type="button" size="sm" variant={variant} data-no-select-drag="true" {...props}>
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  )
}

interface SelectionActionBarProps {
  selectedCount: number
  summary?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onClear?: () => void
  clearLabel?: string
  /** Clear button follows SelectionBarAction: icon + text on wide screens, icon + tooltip on narrow ones. */
  responsiveActions?: boolean
  className?: string
}

/** Render a shared bottom action bar for selection-based workflows. */
export function SelectionActionBar({
  selectedCount,
  summary,
  description,
  actions,
  onClear,
  clearLabel,
  responsiveActions = false,
  className,
}: SelectionActionBarProps) {
  const { t, formatNumber } = useI18n()
  const resolvedClearLabel = clearLabel ?? t('selectionActionBar.clearSelection')

  if (selectedCount <= 0) {
    return null
  }

  let clearButton: ReactNode = null
  if (onClear) {
    if (responsiveActions) {
      clearButton = <SelectionBarAction icon={X} label={resolvedClearLabel} variant="ghost" onClick={onClear} />
    } else {
      clearButton = (
        <IconButton size="icon-sm" variant="secondary" onClick={onClear} data-no-select-drag="true" label={resolvedClearLabel}>
          <X className="h-4 w-4" />
        </IconButton>
      )
    }
  }

  return (
    // Drawer layer +6: above bottom drawers and page floating controls, below the image viewer's later portal and modals.
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[calc(var(--z-index-drawer)+6)] flex justify-center px-4">
      <div
        className={cn(
          'theme-floating-panel theme-selection-bar pointer-events-auto flex max-w-full flex-wrap items-center gap-3 text-sm text-foreground',
          className,
        )}
      >
        <div className={cn('min-w-0', description ? 'flex min-w-[10rem] flex-1 flex-col leading-tight' : 'font-semibold')}>
          <span className="font-semibold">{summary ?? t({ ko: '{count}개 선택됨', en: '{count} selected' }, { count: formatNumber(selectedCount) })}</span>
          {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
        </div>

        {clearButton}

        {actions}
      </div>
    </div>
  )
}
