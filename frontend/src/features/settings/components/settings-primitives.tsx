import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SettingsFieldProps extends ComponentProps<'label'> {
  label: ReactNode
  children: ReactNode
}

// Shared field wrapper for settings forms.
export function SettingsField({ label, children, className, ...props }: SettingsFieldProps) {
  return (
    <label className={cn('space-y-2 text-sm', className)} {...props}>
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
    <label className={cn('flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground', className)} {...props}>
      {children}
    </label>
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
    <div className={cn('min-w-0 rounded-sm bg-surface-low px-4 py-3', className)} {...props}>
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-sm font-semibold text-foreground', valueClassName)}>{value}</div>
    </div>
  )
}
