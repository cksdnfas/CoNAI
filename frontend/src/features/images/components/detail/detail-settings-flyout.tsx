import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export const detailSettingsLabelClassName = 'text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase'
export const detailSettingsControlClassName = 'h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary'
export const detailSettingsNestedControlClassName = 'h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary'

interface DetailSettingsFlyoutProps {
  isOpen: boolean
  onToggle: () => void
  triggerLabel: string
  triggerTitle: string
  panelWidthClassName: string
  children: ReactNode
  icon: ReactNode
}

/** Render a reusable icon-triggered flyout for image detail settings. */
export function DetailSettingsFlyout({
  isOpen,
  onToggle,
  triggerLabel,
  triggerTitle,
  panelWidthClassName,
  children,
  icon,
}: DetailSettingsFlyoutProps) {
  return (
    <div className="relative">
      <Button size="icon-sm" variant="outline" onClick={onToggle} aria-label={triggerLabel} title={triggerTitle}>
        {icon}
      </Button>

      {isOpen ? (
        <div className={`absolute right-0 top-12 z-30 rounded-2xl border border-border bg-surface-container p-4 shadow-[0_0_32px_rgba(14,14,14,0.28)] ${panelWidthClassName}`}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
