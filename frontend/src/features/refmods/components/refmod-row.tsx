import type { KeyboardEvent, ReactNode } from 'react'
import { Star } from 'lucide-react'
import { MediaThumbnailButton } from '@/components/common/media-thumbnail-button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { RefModRowThumb, RefModServerStatus } from '../refmod-shared'

/** Squares shown per row; the rest is a +N count. */
const THUMB_LIMIT = 4

/**
 * One RefMod as a hairline row: member squares (up to four, then +N), the name with its concept and member counts, the
 * server status and the row's always-visible keys (`actions`). Used by the library list and the Director's picker, so it
 * holds no data hooks. From sm up the squares sit in a fixed-width column so every name starts at the same x; on a phone
 * the name gets the first line to itself (with the status and keys) and the squares lead the second line.
 */
export function RefModRow({ name, concept, counts, meta, thumbs, status, favorite = false, selected, onToggleSelected, selectLabel, onOpen, onOpenMedia, actions }: {
  name: string
  concept: string
  counts: string
  /** Last built date (hidden on phones). */
  meta?: string | null
  thumbs: readonly RefModRowThumb[]
  status: RefModServerStatus | null
  favorite?: boolean
  /** Several-select: the row's check (undefined outside select mode). */
  selected?: boolean
  onToggleSelected?: () => void
  selectLabel?: string
  /** Opens the entry (the name block is the target). */
  onOpen?: () => void
  /** Opens a member in the media viewer (image and video squares). */
  onOpenMedia?: (thumb: RefModRowThumb) => void
  actions?: ReactNode
}) {
  const shown = thumbs.slice(0, THUMB_LIMIT)
  const extra = thumbs.length - shown.length
  const activate = selected !== undefined ? onToggleSelected : onOpen
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    activate?.()
  }
  return (
    <ListRow
      size="lg"
      selected={selected}
      leading={selected !== undefined ? <Checkbox checked={selected} aria-label={selectLabel ?? name} onCheckedChange={() => onToggleSelected?.()} /> : undefined}
    >
      {/*
        Phone: row 1 is the name with the status and keys, row 2 the squares then the details.
        sm+: one line of three columns (fixed-width squares, name over details, status and keys).
      */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-y-0">
        <div
          role={activate ? 'button' : undefined}
          tabIndex={activate ? 0 : undefined}
          className={cn('col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:col-start-2', activate && 'cursor-pointer')}
          onClick={activate}
          onKeyDown={activate ? onKeyDown : undefined}
        >
          <span className="truncate font-medium">{name}</span>
          {favorite ? <Star aria-hidden="true" className="size-3.5 shrink-0 fill-current text-warning" /> : null}
        </div>
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 text-muted-foreground sm:col-start-3 sm:row-span-2">
          {status ? (
            <Tip content={status.title}>
              <Badge variant={status.tone} size="sm" className="shrink-0">{status.label}</Badge>
            </Tip>
          ) : null}
          {actions}
        </div>
        <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 sm:contents">
          <span className="flex shrink-0 items-center gap-1 max-sm:empty:hidden sm:col-start-1 sm:row-span-2 sm:row-start-1 sm:w-52">
            {shown.map((thumb) => (
              <MediaThumbnailButton
                key={thumb.key}
                kind={thumb.kind}
                label={thumb.label}
                thumbnailUrl={thumb.thumbnailUrl}
                fileUrl={thumb.fileUrl}
                audioKey={thumb.audioKey}
                onOpen={onOpenMedia && thumb.kind !== 'audio' && thumb.fileUrl ? () => onOpenMedia(thumb) : undefined}
              />
            ))}
            {extra > 0 ? <Badge variant="secondary" size="sm">+{extra}</Badge> : null}
          </span>
          <div className={cn('flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground sm:col-start-2 sm:row-start-2', activate && 'cursor-pointer')} onClick={activate}>
            <span className="shrink-0">{concept}</span>
            <span className="min-w-0 truncate">{counts}</span>
            {meta ? <span className="hidden shrink-0 tabular-nums sm:inline">{meta}</span> : null}
          </div>
        </div>
      </div>
    </ListRow>
  )
}
