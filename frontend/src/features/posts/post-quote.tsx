import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const SIZE_CLASS = {
  sm: 'pl-3 text-sm',
  xs: 'pl-2.5 text-xs',
}

/** A quoted passage (evidence, source excerpt): hairline bar on the left, muted text, line breaks kept. */
export function PostQuote({ size = 'sm', className, children }: { size?: keyof typeof SIZE_CLASS; className?: string; children: ReactNode }) {
  return <blockquote className={cn('whitespace-pre-wrap border-l-2 border-line text-muted-foreground', SIZE_CLASS[size], className)}>{children}</blockquote>
}
