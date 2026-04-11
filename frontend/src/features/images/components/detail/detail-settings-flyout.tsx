import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export const detailSettingsLabelClassName = 'text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase'

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
      <Button size="icon-sm" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onToggle} aria-label={triggerLabel} title={triggerTitle}>
        {icon}
      </Button>

      {isOpen ? (
        <div className={`absolute right-0 top-12 z-30 rounded-sm border border-border bg-background p-4 shadow-[0_18px_40px_rgba(0,0,0,0.32)] ${panelWidthClassName}`}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
