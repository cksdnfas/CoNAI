import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SettingRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Setting name, left side. */
  label: ReactNode
  /** Optional small line under the label. The flat UI keeps copy minimal, so leave it out unless it is essential. */
  description?: ReactNode
  /** Id of the control, so clicking the label focuses / toggles it. */
  htmlFor?: string
  /** The control (Switch, Select, SegmentedControl, chips…), right side. */
  children?: ReactNode
  /** `center` (default) for one-line controls; `start` for tall controls such as wrapping chip groups. */
  align?: 'center' | 'start'
  /** Put the control under the label at full width (textarea, long path input). */
  stacked?: boolean
  controlClassName?: string
}

/**
 * One setting as a flat row: label on the left, control on the right, min 52px, hairline below (none on the last row).
 * On narrow screens the control wraps under the label. Put rows in a `RowGroup` (or any plain container without
 * `space-y-*`) so the hairlines touch.
 */
function SettingRow({
  label,
  description,
  htmlFor,
  children,
  align = 'center',
  stacked = false,
  className,
  controlClassName,
  ...props
}: SettingRowProps) {
  const LabelElement = htmlFor ? 'label' : 'div'

  return (
    <div
      data-slot="setting-row"
      className={cn(
        'flex min-h-13 gap-x-6 gap-y-2 border-b border-line py-2.5 last:border-b-0',
        stacked ? 'flex-col items-stretch' : cn('flex-wrap', align === 'start' ? 'items-start' : 'items-center'),
        className,
      )}
      {...props}
    >
      <div className={cn('min-w-0', !stacked && 'flex-[1_1_14rem]', !stacked && align === 'start' && 'pt-1.5')}>
        <LabelElement htmlFor={htmlFor} className="block text-sm text-foreground">{label}</LabelElement>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {children ? (
        <div
          data-slot="setting-row-control"
          className={cn(
            'flex min-w-0 max-w-full items-center gap-2',
            stacked ? 'w-full' : 'ml-auto shrink-0 flex-wrap justify-end',
            controlClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export { SettingRow }
export type { SettingRowProps }
