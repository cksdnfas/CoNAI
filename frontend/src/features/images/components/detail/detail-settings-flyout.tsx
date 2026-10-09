import type { ReactNode } from 'react'
import { useRef } from 'react'
import { AnchoredPopup, anchoredPopupBodyClassName, anchoredPopupHeaderClassName } from '@/components/ui/anchored-popup'
import { IconButton } from '@/components/ui/icon-button'

export const detailSettingsLabelClassName = 'text-xs font-semibold tracking-overline text-muted-foreground uppercase'

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
      <IconButton ref={triggerRef} size="icon-sm" variant="ghost" onClick={onToggle} label={triggerLabel} aria-expanded={isOpen}>
        {icon}
      </IconButton>
      <AnchoredPopup open={isOpen} anchorRef={triggerRef} onClose={onToggle} align="end" side="bottom" className={panelWidthClassName} closeOnBack>
        <div className={anchoredPopupHeaderClassName}>
          <div className="text-sm font-semibold text-foreground">{triggerTitle}</div>
        </div>
        <div className={anchoredPopupBodyClassName}>{children}</div>
      </AnchoredPopup>
    </>
  )
}
