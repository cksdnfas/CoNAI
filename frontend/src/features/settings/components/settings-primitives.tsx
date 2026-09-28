import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
