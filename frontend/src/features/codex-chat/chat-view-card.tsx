import { useState, type ReactNode } from 'react'
import type { ChatView, ChatViewRow } from '@conai/shared'
import { MediaCard } from '@/components/common/media-card'
import { Progress } from '@/components/ui/progress'
import { SettingRow } from '@/components/ui/setting-row'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useChatLibraryThumbs } from './chat-form-card'
import { ChatMediaMasonry } from './chat-media-masonry'
import { ProposalFrame } from './chat-proposal-parts'

/*
 * Display cards (a ```card block in a reply, decoded by the shared decodeChatView): read-only rows in the form card's
 * look, drawn in place of the code box. Dividers split the rows into sections, so they are drawn by the frame.
 */

type DrawnRow = Exclude<ChatViewRow, { component: 'Divider' }>

/** Library media of the card; media the reader's library does not show, or that fails to load, is left out. */
function MediaRow({ items }: { items: string[] }) {
  const { t } = useI18n()
  const viewer = useImageViewModal()
  const thumbOf = useChatLibraryThumbs(items)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const shown = items.flatMap((hash) => {
    const thumb = failed.has(hash) ? null : thumbOf(hash)
    return thumb ? [{ hash, ...thumb }] : []
  })
  if (shown.length === 0) return null
  const tiles = shown.map(({ hash, src, blurred }) => (
    <MediaCard
      key={hash}
      className="w-full"
      disabled={!viewer}
      aria-label={t({ ko: '크게 보기', en: 'View larger' })}
      onClick={() => viewer?.openImageView({ compositeHash: hash, compositeHashes: shown.map((entry) => entry.hash), sourceItems: shown.map((entry) => entry.image) })}
      media={<img src={src} alt="" loading="lazy" className={cn('block w-full', blurred && 'blur-md')} onError={() => setFailed((current) => new Set(current).add(hash))} />}
    />
  ))
  return <div className="py-2"><ChatMediaMasonry tiles={tiles} size="sm" /></div>
}

/** One renderer per drawn row: a new member of ChatViewRow fails typecheck until it has one. */
const VIEW_ROWS: { [K in DrawnRow['component']]: (row: Extract<DrawnRow, { component: K }>) => ReactNode } = {
  Text: (row) => {
    if (row.variant === 'heading') return <p className="pb-1 pt-2 text-xs font-semibold first:pt-0">{row.text}</p>
    return <p className={cn('whitespace-pre-wrap py-2', row.variant === 'caption' ? 'text-xs text-muted-foreground' : 'text-sm')}>{row.text}</p>
  },
  Stat: (row) => (
    <SettingRow label={row.label}><span className="text-right text-sm tabular-nums">{row.value}</span></SettingRow>
  ),
  Progress: (row) => (
    <SettingRow label={row.label} controlWidth="standard">
      <Progress aria-label={row.label} value={Math.min(row.value, row.max)} max={row.max} className="flex-1" />
      <span className="min-w-8 text-right font-mono text-xs tabular-nums text-muted-foreground">{row.text}</span>
    </SettingRow>
  ),
  Media: (row) => <MediaRow items={row.items} />,
}

function ViewRow({ row }: { row: DrawnRow }) {
  const render = VIEW_ROWS[row.component] as (row: DrawnRow) => ReactNode
  return render(row)
}

function sections(rows: ChatViewRow[]): DrawnRow[][] {
  const split: DrawnRow[][] = [[]]
  for (const row of rows) {
    if (row.component === 'Divider') split.push([])
    else split[split.length - 1].push(row)
  }
  return split.filter((section) => section.length > 0)
}

/** A ```card block of a reply, in place, the width of the reply text. */
export function ChatViewCard({ view }: { view: ChatView }) {
  return (
    <ProposalFrame className="my-2">
      {sections(view.rows).map((section, index) => (
        <div key={index} className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
          {section.map((row, rowIndex) => <ViewRow key={rowIndex} row={row} />)}
        </div>
      ))}
    </ProposalFrame>
  )
}
