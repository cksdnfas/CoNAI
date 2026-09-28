import * as React from 'react'
import { Button } from './button'
import { Tip } from './tooltip'

type IconButtonProps = Omit<React.ComponentProps<typeof Button>, 'size' | 'aria-label'> & {
  /** Accessible name, also shown as the tooltip. Required: an icon alone has no text. */
  label: string
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
  /** Set false to keep the aria-label but skip the tooltip (e.g. when a visible caption sits next to it). */
  tooltip?: boolean
  tooltipSide?: React.ComponentProps<typeof Tip>['side']
  /**
   * Toggle state. When set (true or false) the button is a toggle: `aria-pressed` is announced and `true` shows the
   * pressed look (primary tint; solid primary on `overlay`). Leave undefined for plain actions.
   */
  active?: boolean
}

/** Render a square icon-only Button whose `label` becomes its aria-label and tooltip. */
function IconButton({ label, size = 'icon', tooltip = true, tooltipSide, type = 'button', active, ...props }: IconButtonProps) {
  const button = (
    <Button
      type={type}
      size={size}
      aria-label={label}
      aria-pressed={active}
      data-pressed={active ? 'true' : undefined}
      {...props}
    />
  )

  return tooltip ? <Tip content={label} side={tooltipSide}>{button}</Tip> : button
}

export { IconButton }
