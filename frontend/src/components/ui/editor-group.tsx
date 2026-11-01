import type { ReactNode } from 'react'
import { FieldInfo } from './field'

/**
 * A hairline-separated group of fields inside an editor or modal; its bold label names it (the one group heading of
 * an editor), `info` is the ⓘ tooltip for a label that needs one, `count` follows the label and `actions` sit at its
 * right. There is no visible description line.
 */
export function EditorGroup({ label, info, count, actions, children }: { label?: ReactNode; info?: ReactNode; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {label || actions ? (
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
          {label ? (
            <h3 className="flex items-center gap-1 text-sm font-bold text-foreground">
              {label}
              {count !== undefined ? <span className="ml-1 font-medium text-muted-foreground tabular-nums">{count}</span> : null}
              {info ? <FieldInfo>{info}</FieldInfo> : null}
            </h3>
          ) : null}
          {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
