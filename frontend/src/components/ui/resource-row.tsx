import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

interface ResourceRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Icon, avatar, drag handle… (does not shrink). Icons take `size-4`; give a kind its colour with `text-resource-*` on the icon. */
  leading?: ReactNode
  name: ReactNode
  /** Small pieces beside the name (kind chip, mono key). */
  extra?: ReactNode
  /** One muted line under the name (counts, model, usage). Wrap a state that needs attention in `ResourceRowStatus`. */
  meta?: ReactNode
  /** Controls at the row end (switch, star…). Clicks here do not open the row. */
  trailing?: ReactNode
  /** Opens the editor: the whole row is clickable and a pencil shows on hover (always on touch screens). */
  onOpen?: () => void
  openLabel?: string
}

/**
 * One named thing in a list (preset, profile, lorebook…): leading icon, name + extras, one meta line, controls, edit.
 * Hairline between rows at content width, hover wash a little wider. Stack rows directly (no `space-y-*`) in a
 * `RowGroup`.
 */
function ResourceRow({ leading, name, extra, meta, trailing, onOpen, openLabel, className, children, onClick, ...props }: ResourceRowProps) {
  const { t } = useI18n()
  const stop = (event: MouseEvent) => event.stopPropagation()

  return (
    <div
      data-slot="resource-row"
      className={cn(
        'group relative -mx-2 flex min-h-14 items-center gap-3 rounded-sm px-2 py-2 transition-colors',
        'before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:border-t before:border-line first:before:hidden',
        onOpen && 'cursor-pointer hover:bg-fill',
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        onOpen?.()
      }}
      {...props}
    >
      {leading ? (
        <span data-slot="resource-row-leading" className="flex shrink-0 items-center text-muted-foreground [&_svg:not([class*=size-])]:size-4">
          {leading}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          {extra}
        </div>
        {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {children}
      {trailing ? (
        <span data-slot="resource-row-trailing" className="flex shrink-0 items-center gap-1" onClick={stop}>
          {trailing}
        </span>
      ) : null}
      {onOpen ? (
        <IconButton
          size="icon-sm"
          variant="ghost"
          className="shrink-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          label={openLabel ?? t({ ko: '편집', en: 'Edit' })}
        >
          <Pencil />
        </IconButton>
      ) : null}
    </div>
  )
}

/** A state in the meta line that needs attention (not linked, missing, failed): status colour with a dot. */
function ResourceRowStatus({ tone = 'warning', className, ...props }: ComponentProps<'span'> & { tone?: 'warning' | 'destructive' }) {
  return (
    <span
      data-slot="resource-row-status"
      className={cn(
        'inline-flex items-center gap-1.5 font-medium before:size-1.5 before:shrink-0 before:rounded-full before:bg-current',
        tone === 'destructive' ? 'text-destructive' : 'text-warning',
        className,
      )}
      {...props}
    />
  )
}

export { ResourceRow, ResourceRowStatus }
export type { ResourceRowProps }
