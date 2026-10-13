import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const countBadgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full text-2xs leading-none font-semibold tabular-nums',
  {
    variants: {
      tone: {
        primary: 'bg-primary text-primary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
      },
      size: {
        /** 14px: on a small (icon-sm) key. */
        xs: 'h-3.5 min-w-3.5 px-1',
        /** 16px: on a regular icon key. */
        sm: 'h-4 min-w-4 px-1',
        /** 18px: inline at the end of a row / menu item. */
        md: 'h-4.5 min-w-4.5 px-1.5',
      },
      /** Pin to a corner of the nearest `relative` parent (the key it counts for). */
      corner: {
        none: '',
        'top-right': 'pointer-events-none absolute -top-0.5 -right-0.5',
        'bottom-right': 'pointer-events-none absolute -right-0.5 -bottom-0.5',
      },
      /** Background-coloured ring that cuts the badge out of the icon under it. */
      ring: {
        true: 'ring-2 ring-background',
        false: '',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'sm',
      corner: 'none',
      ring: false,
    },
  },
)

type CountBadgeProps = Omit<ComponentProps<'span'>, 'children'> & VariantProps<typeof countBadgeVariants> & {
  /** Number to show. Leave undefined for a plain dot (unread / attention marker). */
  count?: number
  /** Above this the badge reads `{max}+`. */
  max?: number
  /** Accessible name (role img). Without it a dot is aria-hidden and a count is read as its number. */
  label?: string
}

/**
 * A small filled counter or dot on a key (unread replies, pending comments, active jobs). Numbers keep tabular figures;
 * without `count` it is an 8px dot.
 */
function CountBadge({ className, tone, size, corner, ring, count, max, label, ...props }: CountBadgeProps) {
  const dot = count === undefined
  const text = dot ? null : max !== undefined && count > max ? `${max}+` : count

  return (
    <span
      data-slot="count-badge"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={dot && !label ? true : undefined}
      className={cn(countBadgeVariants({ tone, size, corner, ring }), dot && 'size-2 min-w-0 p-0', className)}
      {...props}
    >
      {text}
    </span>
  )
}

export { CountBadge, countBadgeVariants }
export type { CountBadgeProps }
