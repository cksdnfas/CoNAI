import type { ComponentType, ReactNode } from 'react'
import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

interface SystemMessagePanelProps {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** `warning` tints the icon tile with the warning status pair; `neutral` keeps it tonal. */
  iconTone?: 'neutral' | 'warning'
  /** Short code or kind above the title, e.g. "404". */
  overline?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Extra body such as a collapsed technical detail. */
  children?: ReactNode
  actions?: ReactNode
}

/** Centered tonal card shared by the 404 and route-error screens. */
export function SystemMessagePanel({ icon: Icon, iconTone = 'neutral', overline, title, description, children, actions }: SystemMessagePanelProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center py-10">
      <Panel tone="low" padding="lg" className="w-full space-y-5">
        <div
          className={cn(
            'flex size-10 items-center justify-center rounded-sm',
            iconTone === 'warning' ? 'bg-warning-soft text-warning-soft-foreground' : 'bg-surface-high text-muted-foreground',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="space-y-2">
          {overline ? <Text variant="overline" className="font-semibold">{overline}</Text> : null}
          <Heading level={1}>{title}</Heading>
          {description ? <div className="space-y-2 text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {children}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </Panel>
    </div>
  )
}
