import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface SelectionBarActionProps extends Omit<ComponentProps<typeof Button>, 'children' | 'size' | 'aria-label'> {
  icon: ComponentType<{ className?: string }>
  active?: boolean
  /** Tooltip and accessible name (the button shows only its icon). */
  label: string
}

/** One selection bar action: an icon button with a tooltip, marked so a drag-select never starts from it. */
export function SelectionBarAction({ icon: Icon, label, variant = 'secondary', ...props }: SelectionBarActionProps) {
  return (
    <IconButton label={label} size="icon-sm" variant={variant} tooltipSide="top" data-no-select-drag="true" {...props}>
      <Icon className="h-4 w-4" />
    </IconButton>
  )
}

interface SelectionActionBarProps {
  selectedCount: number
  summary?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onClear?: () => void
  clearLabel?: string
  /** Clear button is a ghost SelectionBarAction (sits with the other actions) instead of a secondary icon button. */
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
    // Above header/floating page controls, below modal bottom drawers (z-drawer = 84) and clear of the docked chat panel.
    <div className="pointer-events-none fixed left-0 right-[var(--chat-dock-width,0px)] bottom-[max(1.5rem,env(safe-area-inset-bottom),calc(var(--shell-bottom-inset)+1rem))] z-[calc(var(--z-index-header)+20)] flex justify-center px-4">
      <div
        className={cn(
          'theme-floating-panel theme-selection-bar pointer-events-auto flex max-w-full flex-wrap items-center gap-3 text-sm text-foreground',
          className,
        )}
      >
        <div className={cn('min-w-0', description ? 'flex min-w-[10rem] flex-1 flex-col leading-tight' : 'font-semibold')}>
          <span className="inline-block min-w-24 font-semibold tabular-nums">{summary ?? t({ ko: '{count}개 선택됨', en: '{count} selected' }, { count: formatNumber(selectedCount) })}</span>
          {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
        </div>

        {clearButton}

        {actions}
      </div>
    </div>
  )
}
