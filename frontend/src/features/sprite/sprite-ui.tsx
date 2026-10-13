import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One settings section: a heading row and its controls, separated from the next by a hairline. */
export function SpriteSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0', className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A compact labelled number input used inside rows (start/end, sizes, grid). */
export function MiniField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** The sticky run bar at the bottom of a tab: a short summary on the left, the download / save keys on the right. */
export function SpriteActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky bottom-3 z-sticky mt-2 flex items-center gap-2 rounded-md bg-surface-container/95 p-1.5 pl-3 shadow-elevation-3 backdrop-blur-md', className)}>
      {children}
    </div>
  )
}

/** Checkerboard stage that previews a sheet, frame or animation (transparent pixels show as the checker). */
export function SpriteCheckerStage({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('bg-checker flex h-[min(48vh,380px)] items-center justify-center overflow-hidden rounded-sm', className)}>
      {children}
    </div>
  )
}
