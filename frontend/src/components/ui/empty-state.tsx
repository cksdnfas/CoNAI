import { isValidElement, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Text } from './text'

// Tonal fill instead of the old dashed outline (DESIGN_PRESET D1). Recesses to surface-lowest inside a raised
// surface (Section, Card, Panel, drawer), so it stays visible without a className override.
const emptyStateVariants = cva('ui-tone-plinth rounded-sm', {
  variants: {
    size: {
      default: 'flex w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
      compact: 'flex w-full items-start gap-2.5 px-3 py-2.5 text-left',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

type EmptyStateIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof emptyStateVariants> {
  /** Lucide icon component (preferred) or a prebuilt node. */
  icon?: EmptyStateIcon | ReactNode
  title: ReactNode
  description?: ReactNode
  /** Usually one Button; rendered below (default) or at the row end (compact). */
  action?: ReactNode
}

function renderIcon(icon: EmptyStateProps['icon'], className: string) {
  if (icon === null || icon === undefined || icon === false) {
    return null
  }

  // Lucide icons are forwardRef objects, so "component" means function or a non-element exotic object.
  const isComponent = typeof icon === 'function' || (typeof icon === 'object' && !isValidElement(icon) && '$$typeof' in icon)
  if (isComponent) {
    const Icon = icon as EmptyStateIcon
    return <Icon className={className} aria-hidden />
  }

  return <span className={cn('inline-flex items-center justify-center', className)} aria-hidden>{icon as ReactNode}</span>
}

/** Render a quiet "nothing here yet" block, optionally with a next-step action. */
function EmptyState({ icon, title, description, action, size, className, ...props }: EmptyStateProps) {
  if (size === 'compact') {
    return (
      <div data-slot="empty-state" data-size="compact" className={cn(emptyStateVariants({ size }), className)} {...props}>
        {renderIcon(icon, 'mt-0.5 size-4 shrink-0 text-muted-foreground')}
        <div className="min-w-0 flex-1 space-y-0.5">
          <Text as="div" variant="muted">{title}</Text>
          {description ? <Text as="div" variant="caption">{description}</Text> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    )
  }

  const iconNode = renderIcon(icon, 'size-5')

  return (
    <div data-slot="empty-state" data-size="default" className={cn(emptyStateVariants({ size }), className)} {...props}>
      {iconNode ? (
        <div className="flex size-10 items-center justify-center rounded-sm bg-surface-high text-muted-foreground">{iconNode}</div>
      ) : null}
      <div className="max-w-md space-y-1">
        <Text as="div" variant="label">{title}</Text>
        {description ? <Text as="div" variant="muted">{description}</Text> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState, emptyStateVariants }
export type { EmptyStateProps }
