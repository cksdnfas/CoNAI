import type { ReactNode } from 'react'
import { FieldInfo } from './field'

/**
 * A hairline-separated group of fields inside an editor or modal; the overline names it (the one group heading of an
 * editor), a short `description` may follow it, and `actions` sit at its right.
 */
export function EditorGroup({ label, info, description, actions, children }: { label?: ReactNode; info?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {label || actions ? (
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
          {label ? (
            <h3 className="flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
              {label}
              {info ? <FieldInfo>{info}</FieldInfo> : null}
            </h3>
          ) : null}
          {description ? <span className="min-w-0 text-xs text-muted-foreground">{description}</span> : null}
          {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
