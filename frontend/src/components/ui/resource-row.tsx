import type { ComponentProps, ComponentType, MouseEvent, ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'
import { Tip } from './tooltip'

interface ResourceRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Icon, avatar, drag handle… (does not shrink). Icons take `size-4`; give a kind its colour with `text-resource-*` on the icon. */
  leading?: ReactNode
  name: ReactNode
  /** Small pieces beside the name: kind chip, mono key, and a `ResourceRowStatus` for a state that needs attention. */
  extra?: ReactNode
  /** Small muted facts at the row end, before the controls: `ResourceRowStat` counts or a short date. Detail goes in their tooltip. */
  aside?: ReactNode
  /** Controls at the row end (switch, star…). Clicks here do not open the row. */
  trailing?: ReactNode
  /** Opens the editor: the whole row is clickable and ends in a pencil. */
  onOpen?: () => void
  openLabel?: string
}

/**
 * One named thing in a list (preset, profile, lorebook…) on one line: leading icon, name + chips, muted stats,
 * controls, edit. Hairline between rows at content width, hover wash a little wider. Stack rows directly (no
 * `space-y-*`) in a `RowGroup`.
 */
function ResourceRow({ leading, name, extra, aside, trailing, onOpen, openLabel, className, children, onClick, ...props }: ResourceRowProps) {
  const { t } = useI18n()
  const stop = (event: MouseEvent) => event.stopPropagation()

  return (
    <div
      data-slot="resource-row"
      className={cn(
        'group relative -mx-2 flex min-h-11 items-center gap-3 rounded-sm px-2 py-1.5 transition-colors',
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
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        {extra}
      </div>
      {children}
      {aside ? (
        <span data-slot="resource-row-aside" className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {aside}
        </span>
      ) : null}
      {trailing ? (
        <span data-slot="resource-row-trailing" className="flex shrink-0 items-center gap-1" onClick={stop}>
          {trailing}
        </span>
      ) : null}
      {onOpen ? (
        <IconButton
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
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

/** A state beside the name that needs attention (not linked, missing, failed): a small status chip with a dot. `tip` says what exactly. */
function ResourceRowStatus({ tone = 'warning', tip, className, ...props }: ComponentProps<'span'> & { tone?: 'warning' | 'destructive'; tip?: ReactNode }) {
  return (
    <Tip content={tip}>
      <span
        data-slot="resource-row-status"
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap before:size-1.5 before:shrink-0 before:rounded-full before:bg-current',
          tone === 'destructive' ? 'bg-destructive-soft text-destructive-soft-foreground' : 'bg-warning-soft text-warning-soft-foreground',
          className,
        )}
        {...props}
      />
    </Tip>
  )
}

type StatIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** One muted fact in `aside`: an icon and a number (or a short date) with the detail in a tooltip. */
function ResourceRowStat({ icon: Icon, tip, children, className }: { icon?: StatIcon; tip?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tip content={tip}>
      <span data-slot="resource-row-stat" className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}>
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {children}
      </span>
    </Tip>
  )
}

export { ResourceRow, ResourceRowStat, ResourceRowStatus }
export type { ResourceRowProps }
