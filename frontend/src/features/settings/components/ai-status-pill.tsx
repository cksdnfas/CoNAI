import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type AiStatusTone = 'ok' | 'busy' | 'warn' | 'error' | 'muted'

const TONE_CLASS: Record<AiStatusTone, { text: string; dot: string }> = {
  ok: { text: 'text-success', dot: 'bg-success' },
  busy: { text: 'text-primary', dot: 'bg-primary animate-pulse motion-reduce:animate-none' },
  warn: { text: 'text-warning', dot: 'bg-warning' },
  error: { text: 'text-destructive', dot: 'bg-destructive' },
  muted: { text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
}

/** A short state with a coloured dot (준비됨 · 설치 중 · 대기 …), for AI runtime and model rows. */
export function AiStatusPill({ tone, children, className }: { tone: AiStatusTone; children: ReactNode; className?: string }) {
  const toneClass = TONE_CLASS[tone]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-surface-high px-2.5 py-0.5 text-xs font-semibold', toneClass.text, className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', toneClass.dot)} />
      {children}
    </span>
  )
}
