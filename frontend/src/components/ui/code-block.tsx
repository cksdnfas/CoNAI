import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const maxHeightClassName = {
  none: '',
  xs: 'max-h-32',
  sm: 'max-h-48',
  md: 'max-h-64',
  lg: 'max-h-80',
  screen: 'max-h-[70vh]',
} as const

export type CodeBlockMaxHeight = keyof typeof maxHeightClassName

/**
 * Monospace text block (JSON, raw responses, logs, error details): field fill, wraps long lines, scrolls inside its
 * own box both ways once `maxHeight` is reached. `fill={false}` drops the fill and padding where the block already sits
 * in a modal or a framed area of its own; `wrap={false}` keeps lines and scrolls sideways.
 */
export function CodeBlock({ size = 'xs', maxHeight = 'none', fill = true, wrap = true, className, ...props }: ComponentProps<'pre'> & {
  size?: 'xs' | '2xs'
  maxHeight?: CodeBlockMaxHeight
  fill?: boolean
  wrap?: boolean
}) {
  return (
    <pre
      className={cn(
        'overflow-auto font-mono leading-relaxed text-foreground',
        size === '2xs' ? 'text-2xs' : 'text-xs',
        wrap && 'whitespace-pre-wrap break-words',
        fill && 'rounded-sm bg-field p-2.5',
        maxHeightClassName[maxHeight],
        className,
      )}
      {...props}
    />
  )
}
