import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FieldInfo } from './field'

/** A hairline-separated group of fields inside an editor or modal; the overline names it, `actions` sit at its right. */
export function EditorGroup({ label, info, actions, children }: { label?: ReactNode; info?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {label || actions ? (
        <div className={cn('flex min-h-7 items-center gap-3', label ? 'justify-between' : 'justify-end')}>
          {label ? (
            <h3 className="flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
              {label}
              {info ? <FieldInfo>{info}</FieldInfo> : null}
            </h3>
          ) : null}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}
