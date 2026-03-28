import type { ComponentProps, ReactNode } from 'react'
import { SectionHeading } from '@/components/common/section-heading'
import { ToggleRow } from '@/components/ui/toggle-row'
import { cn } from '@/lib/utils'

interface SettingsFieldProps extends ComponentProps<'label'> {
  label: ReactNode
  children: ReactNode
}

// Shared field wrapper for settings forms.
export function SettingsField({ label, children, className, ...props }: SettingsFieldProps) {
  return (
    <label className={cn('theme-settings-field flex flex-col text-sm', className)} {...props}>
      <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  )
}

interface SettingsToggleRowProps extends ComponentProps<'label'> {
  children: ReactNode
}

// Shared toggle row used by checkbox-style settings.
export function SettingsToggleRow({ children, className, ...props }: SettingsToggleRowProps) {
  return (
    <ToggleRow variant="settings" className={className} {...props}>
      {children}
    </ToggleRow>
  )
}

interface SettingsSectionHeadingProps extends ComponentProps<'div'> {
  heading: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

// Shared section heading row used above settings cards.
export function SettingsSectionHeading({
  heading,
  description,
  actions,
  className,
  ...props
}: SettingsSectionHeadingProps) {
  return (
    <SectionHeading
      heading={heading}
      description={description}
      actions={actions}
      className={className}
      {...props}
    />
  )
}

interface SettingsValueTileProps extends ComponentProps<'div'> {
  label: ReactNode
  value: ReactNode
  valueClassName?: string
}

// Shared labeled value tile for settings summaries and metadata blocks.
export function SettingsValueTile({ label, value, className, valueClassName, ...props }: SettingsValueTileProps) {
  return (
    <div className={cn('theme-settings-panel min-w-0 rounded-sm bg-surface-low', className)} {...props}>
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-sm font-semibold text-foreground', valueClassName)}>{value}</div>
    </div>
  )
}
