import type { ComponentProps, ReactNode } from 'react'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * A control over the image that shows only while the card is hovered or focused (always on touch screens), unless
 * `shown` keeps it up (a set favorite, a selected card).
 */
export function OverlayCardHoverOnly({ shown = false, children }: { shown?: boolean; children: ReactNode }) {
  return (
    <span data-shown={shown ? 'true' : undefined} className="inline-flex opacity-0 transition-opacity motion-reduce:transition-none group-hover/overlay-card:opacity-100 group-focus-within/overlay-card:opacity-100 pointer-coarse:opacity-100 data-[shown=true]:opacity-100">
      {children}
    </span>
  )
}

/**
 * The image-first card of the character library, catalog, chat profiles and group covers (DESIGN_PRESET "Overlay
 * card"): the picture fills the card, the title, subtitle and meta sit on a gradient at its bottom, controls float in
 * the top corners, and `details` + `actions` unfold under the title on hover or focus (always on touch screens).
 * The picture is the open button; text layers let clicks through to it, so only real controls take their own clicks.
 */
export function OverlayCard({ media, mediaClassName = 'aspect-[3/4]', label, title, subtitle, leading, meta, topStart, topEnd, details, actions, menu, selected, dimmed = false, onOpen, className, ...buttonProps }: {
  /** Fills the media frame (img / mosaic / fallback). */
  media: ReactNode
  /** Frame size only (aspect), e.g. `aspect-4/3`. */
  mediaClassName?: string
  /** The open button's accessible name. */
  label: string
  title: ReactNode
  subtitle?: ReactNode
  /** Before the title (avatar, colour dot). */
  leading?: ReactNode
  /** Right of the title (count, status). */
  meta?: ReactNode
  topStart?: ReactNode
  topEnd?: ReactNode
  /** Unfolds under the title: chips or a short line. */
  details?: ReactNode
  /** Unfolds under the title: overlay buttons for the frequent actions. */
  actions?: ReactNode
  /** Right-click / long-press menu, also behind a ⋯ key in the top-right corner. */
  menu?: ActionMenuEntry[]
  selected?: boolean
  dimmed?: boolean
  onOpen: () => void
  /** The card's layout in its grid only. */
  className?: string
} & Pick<ComponentProps<'button'>, 'onDoubleClick' | 'draggable' | 'onDragStart' | 'onDragEnd'>) {
  const { t } = useI18n()
  const card = (
    <div
      data-slot="overlay-card"
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group/overlay-card relative isolate min-w-0 overflow-hidden rounded-md bg-fill transition-shadow hover:shadow-elevation-2',
        'has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:outline-offset-2 has-[>button:focus-visible]:outline-ring',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        className,
      )}
    >
      <Panel asChild padding="none" tone="none" radius="none">
        <button type="button" aria-label={label} aria-pressed={selected} onClick={onOpen} className={cn('relative block w-full cursor-pointer overflow-hidden outline-none', mediaClassName, dimmed && 'opacity-60 grayscale')} {...buttonProps}>
          {media}
        </button>
      </Panel>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-backdrop via-backdrop/70 to-transparent px-2.5 pt-10 pb-2.5 text-white">
        <div className="flex items-end gap-2">
          {leading}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm leading-snug font-semibold text-shadow-sm">{title}</div>
            {subtitle ? <div className="truncate text-xs text-white/75">{subtitle}</div> : null}
          </div>
          {meta ? <div className="flex shrink-0 items-center gap-1 text-xs text-white/85 tabular-nums [&_svg]:size-3.5">{meta}</div> : null}
        </div>
        {details || actions ? (
          <div className="invisible grid grid-rows-[0fr] transition-all duration-200 motion-reduce:transition-none group-focus-within/overlay-card:visible group-focus-within/overlay-card:grid-rows-[1fr] group-hover/overlay-card:visible group-hover/overlay-card:grid-rows-[1fr] pointer-coarse:visible pointer-coarse:grid-rows-[1fr]">
            <div className="min-h-0 overflow-hidden">
              {details ? <div className="flex flex-wrap gap-1 pt-2">{details}</div> : null}
              {actions ? <div className="pointer-events-auto flex gap-1.5 pt-2">{actions}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {topStart ? <div className="absolute top-2 left-2 flex max-w-[calc(100%-5rem)] items-center gap-1.5">{topStart}</div> : null}
      {topEnd || menu ? (
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {topEnd}
          {menu ? <OverlayCardHoverOnly><ActionMenuButton entries={menu} label={t({ ko: '작업', en: 'Actions' })} variant="overlay" size="icon-sm" /></OverlayCardHoverOnly> : null}
        </div>
      ) : null}
    </div>
  )
  return menu ? <ActionContextMenu entries={menu}>{card}</ActionContextMenu> : card
}
