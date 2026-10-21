import type { ComponentProps, ReactNode } from 'react'
import { Panel } from '@/components/ui/panel'
import { cn } from '@/lib/utils'

interface MediaCardSlots {
  /**
   * `flat`: media + caption on the page tone; never gets a background (hover dims the media, selection and focus are a
   * ring on the media), caption flush with the media edge. `boxed`: a surface card whose caption sits in one padded body.
   */
  variant?: 'flat' | 'boxed'
  /** The picture: img / mosaic / preview that fills the media frame. */
  media: ReactNode
  /** Media frame size only (aspect or fixed size), e.g. `aspect-4/3 w-full`, `h-37.5 w-28`. */
  mediaClassName?: string
  /** Badges over the media (position them yourself; the frame is `relative`). */
  overlay?: ReactNode
  /** Before the title on the caption row (colour dot, icon). */
  leading?: ReactNode
  title?: ReactNode
  /** Right side of the caption row: count, status icon… */
  meta?: ReactNode
  /** Selected state: ring on the media (flat) or primary tint (boxed); also sets `data-selected`. */
  selected?: boolean
  /** Flat only: media beside the caption instead of above it (compact chips in a scrolling strip). */
  inline?: boolean
}

type MediaCardProps = MediaCardSlots & (
  | (Omit<ComponentProps<'button'>, 'title'> & { href?: undefined })
  | (Omit<ComponentProps<'a'>, 'title'> & { href: string })
)

/**
 * The one clickable media card (DESIGN_PRESET "Media card"): a real `<button>` (or `<a>` with `href`) with media,
 * caption (leading · title · meta) and overlay slots. `className` is for the card's layout in its grid only.
 */
export function MediaCard({ variant = 'flat', media, mediaClassName, overlay, leading, title, meta, selected, inline = false, className, ...props }: MediaCardProps) {
  const flat = variant === 'flat'
  const row = flat && inline
  const hasCaption = leading !== undefined || title !== undefined || meta !== undefined
  const content = (
    <>
      <span
        data-slot="media-card-media"
        className={cn(
          'relative block overflow-hidden',
          flat && 'rounded-sm bg-fill transition group-hover/media-card:opacity-90',
          flat && selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          // Focus is an outline outside the selection ring, so a focused selected card shows both.
          flat && 'group-focus-visible/media-card:outline-2 group-focus-visible/media-card:outline-offset-4 group-focus-visible/media-card:outline-ring',
          mediaClassName,
        )}
      >
        {media}
        {overlay}
      </span>
      {hasCaption ? (
        <span data-slot="media-card-caption" className={cn('flex min-w-0 items-center gap-2', row ? 'flex-1' : flat ? 'pt-2' : 'px-(--theme-panel-padding-x) py-(--theme-panel-padding-y)')}>
          {leading}
          {title !== undefined ? <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span> : null}
          {meta !== undefined ? <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
        </span>
      ) : null}
    </>
  )
  const cardClassName = cn(
    'group/media-card flex min-w-0 text-left outline-none disabled:cursor-default',
    row ? 'flex-row items-center gap-2.5' : 'flex-col',
    flat ? 'cursor-pointer' : 'overflow-hidden',
    className,
  )

  // Flat: a surface-less Panel that adds no hover wash or selected tint (it keeps the [ds/button] guard satisfied).
  // Boxed: the interactive Panel gives the surface, hover lift, focus ring and selected tint.
  const tone = flat ? 'none' : 'low'
  const radius = flat ? 'none' : 'sm'
  if (props.href !== undefined) {
    return (
      <Panel asChild padding="none" tone={tone} radius={radius} interactive={!flat}>
        <a data-slot="media-card" data-selected={selected ? 'true' : undefined} className={cardClassName} {...(props as ComponentProps<'a'>)}>{content}</a>
      </Panel>
    )
  }
  return (
    <Panel asChild padding="none" tone={tone} radius={radius} interactive={!flat}>
      <button type="button" data-slot="media-card" data-selected={selected ? 'true' : undefined} className={cardClassName} {...(props as ComponentProps<'button'>)}>{content}</button>
    </Panel>
  )
}
