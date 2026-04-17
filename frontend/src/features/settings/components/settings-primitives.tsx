import type { ComponentProps, ReactNode } from 'react'
import { ToggleRow } from '@/components/ui/toggle-row'
import { cn } from '@/lib/utils'

interface SettingsFieldProps extends ComponentProps<'label'> {
  label: ReactNode
  children: ReactNode
}

type SettingsSectionProps = ComponentProps<'section'> & {
  heading: ReactNode
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
  headerClassName?: string
}

/** Shared minimal settings section shell used across tabs. */
export function SettingsSection({ heading, actions, children, className, bodyClassName, headerClassName, ...props }: SettingsSectionProps) {
  return (
    <section className={cn('overflow-hidden rounded-sm border border-border/85 bg-surface-container/30', className)} {...props}>
      <div className={cn('flex items-center justify-between gap-3 border-b border-border/85 px-4 py-3', headerClassName)}>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-semibold tracking-tight text-foreground">{heading}</p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn('space-y-4 px-4 py-4', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

interface SettingsInsetBlockProps extends ComponentProps<'div'> {
  children: ReactNode
}

/** Shared light inset surface for dense notes, previews, and grouped controls. */
export function SettingsInsetBlock({ children, className, ...props }: SettingsInsetBlockProps) {
  return <div className={cn('rounded-sm border border-border/70 bg-surface-low/45 px-4 py-3', className)} {...props}>{children}</div>
}

// Shared field wrapper for settings forms.
export function SettingsField({ label, children, className, ...props }: SettingsFieldProps) {
  return (
    <label className={cn('theme-settings-field flex flex-col text-sm', className)} {...props}>
      <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</span>
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

interface SettingsValueTileProps extends ComponentProps<'div'> {
  label: ReactNode
  value: ReactNode
  valueClassName?: string
}

// Shared labeled value tile for settings summaries and metadata blocks.
export function SettingsValueTile({ label, value, className, valueClassName, ...props }: SettingsValueTileProps) {
  return (
    <div className={cn('min-w-0 rounded-sm border border-border/70 bg-surface-low/45 px-3 py-3', className)} {...props}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-sm font-semibold text-foreground', valueClassName)}>{value}</div>
    </div>
  )
}
