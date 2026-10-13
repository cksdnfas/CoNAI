import { useId, type ComponentProps, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SwitchLineProps extends Omit<ComponentProps<'div'>, 'children' | 'onChange'> {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Controls just before the switch, e.g. the value it guards (`end` placement only). */
  extra?: ReactNode
  /** Quieter label, for a sub-option under another switch. */
  muted?: boolean
  /** `end` (default): label left, switch at the line end. `start`: switch then label, sized to its content (a wrapping line of flags). */
  placement?: 'end' | 'start'
}

/**
 * An on/off line inside a form or panel: label + Switch, no hairline, no surface; the label toggles it too.
 * Use `SettingsSwitchRow` for a hairline settings row and `ToggleRow` for a field-filled box.
 * Extra props go to the wrapper, so a `Tip` can anchor to it.
 */
function SwitchLine({ label, checked, onCheckedChange, disabled, extra, muted = false, placement = 'end', id: idProp, className, ...props }: SwitchLineProps) {
  const generatedId = useId()
  const id = idProp ?? generatedId
  const control = <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
  const labelClassName = cn('cursor-pointer', muted && 'text-muted-foreground', disabled && 'cursor-not-allowed')

  if (placement === 'start') {
    return (
      <div data-slot="switch-line" className={cn('flex items-center gap-2 text-sm', className)} {...props}>
        {control}
        <label htmlFor={id} className={labelClassName}>{label}</label>
      </div>
    )
  }

  return (
    <div data-slot="switch-line" className={cn('flex min-h-8 items-center gap-3 text-sm', className)} {...props}>
      <label htmlFor={id} className={cn('flex min-w-0 flex-1 items-center self-stretch', labelClassName)}>{label}</label>
      {extra ? <div className="flex shrink-0 items-center gap-2">{extra}</div> : null}
      {control}
    </div>
  )
}

export { SwitchLine }
export type { SwitchLineProps }
