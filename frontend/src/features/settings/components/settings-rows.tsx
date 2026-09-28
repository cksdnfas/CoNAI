import { Fragment, type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Width of a select / number / short text control on the right of a SettingRow. Full width once the row wraps on
 * phones, a fixed column on wider screens so the controls of one group line up.
 */
export const SETTINGS_CONTROL_CLASS = 'w-full sm:w-60'

/** Wider right-side control (paths, URLs, templates). */
export const SETTINGS_WIDE_CONTROL_CLASS = 'w-full sm:w-96'

/** Placeholder rows while a settings group loads (keeps the hairline rhythm instead of one big block). */
export function SettingsRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex min-h-13 items-center justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
          <Skeleton className="h-4 w-40 rounded-sm" />
          <Skeleton className="h-8 w-40 rounded-sm" />
        </div>
      ))}
    </div>
  )
}

export interface SettingsStatItem {
  label: ReactNode
  value: ReactNode
  /** Colour the value (errors, warnings); default is plain foreground. */
  tone?: 'default' | 'danger' | 'success' | 'muted'
}

/** A compact one-line summary, e.g. "감시 중 1 · 오류 0 · 24시간 이벤트 3". Replaces rows of stat tiles. */
export function SettingsStatLine({ items, className }: { items: SettingsStatItem[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground', className)}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? <span aria-hidden className="text-muted-foreground/50">·</span> : null}
          <span className="inline-flex min-w-0 items-baseline gap-1.5">
            <span>{item.label}</span>
            <span
              className={cn(
                'font-semibold tabular-nums',
                item.tone === 'danger'
                  ? 'text-destructive'
                  : item.tone === 'success'
                    ? 'text-success'
                    : item.tone === 'muted'
                      ? 'text-muted-foreground'
                      : 'text-foreground',
              )}
            >
              {item.value}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/** Muted one-line message in place of an empty list (no box). */
export function SettingsEmptyRow({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>
}
