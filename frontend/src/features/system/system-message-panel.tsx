import type { ComponentType, ReactNode } from 'react'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

interface SystemMessagePanelProps {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** `warning` tints the icon tile with the warning status pair; `neutral` keeps it tonal. */
  iconTone?: 'neutral' | 'warning'
  /** Short code or kind above the title, e.g. "404". */
  overline?: ReactNode
  title: ReactNode
  /** Extra body such as a collapsed technical detail. */
  children?: ReactNode
  actions?: ReactNode
}

/** Centered flat message (no card) shared by the 404 and route-error screens. */
export function SystemMessagePanel({ icon: Icon, iconTone = 'neutral', overline, title, children, actions }: SystemMessagePanelProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center py-10">
      <div className="w-full space-y-5">
        <Icon className={cn('size-8', iconTone === 'warning' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
        <div className="space-y-2">
          {overline ? <Text variant="overline" className="font-semibold">{overline}</Text> : null}
          <Heading level={1}>{title}</Heading>
        </div>
        {children}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
