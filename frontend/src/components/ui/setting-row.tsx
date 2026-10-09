import type { ComponentProps, ReactNode } from 'react'
import { FieldInfo } from '@/components/ui/field'
import { cn } from '@/lib/utils'

interface SettingRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Setting name, left side. */
  label: ReactNode
  /** Explanation shown in an ⓘ tooltip after the label (no visible helper line). */
  info?: ReactNode
  /** @deprecated Same as `info`: rendered as the ⓘ tooltip, never as a visible line. */
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
  info,
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
  const infoContent = info ?? description

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
        {infoContent ? (
          <div className="flex items-center gap-1">
            <LabelElement htmlFor={htmlFor} className="min-w-0 text-sm text-foreground">{label}</LabelElement>
            <FieldInfo>{infoContent}</FieldInfo>
          </div>
        ) : (
          <LabelElement htmlFor={htmlFor} className="block text-sm text-foreground">{label}</LabelElement>
        )}
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
