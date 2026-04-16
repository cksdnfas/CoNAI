import type { ReactNode } from 'react'
import { useRef } from 'react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <>
      <Button ref={triggerRef} size="icon-sm" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onToggle} aria-label={triggerLabel} title={triggerTitle}>
        {icon}
      </Button>
      <AnchoredPopup open={isOpen} anchorRef={triggerRef} onClose={onToggle} align="end" side="bottom" className={panelWidthClassName}>
        <div className="border-b border-border/70 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">옵션</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{triggerTitle}</div>
        </div>
        <div className="p-4">
          {children}
        </div>
      </AnchoredPopup>
    </>
  )
}
