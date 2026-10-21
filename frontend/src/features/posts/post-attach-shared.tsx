import { useEffect, useRef } from 'react'
import { postLink } from '@conai/shared'
import { cn } from '@/lib/utils'
import { fileExtension } from '@/lib/file-extension'
import { useInView } from '@/lib/use-in-view'

export type AttachTab = 'media' | 'audio' | 'post' | 'file'
/** How a picked post goes into the body: a small card (`![t](post:1)`) or an inline link (`[t](post:1)`). */
export type PostInsertStyle = 'card' | 'link'

/** One picked thing; `key` keeps picks unique across tabs and orders the tray. */
export type AttachItem =
  | { kind: 'media'; key: string; hash: string; mimeType: string | null }
  | { kind: 'group'; key: string; id: number; name: string }
  | { kind: 'audio'; key: string; id: string; name: string }
  | { kind: 'post'; key: string; id: number; title: string; cover: AttachCover | null }
  | { kind: 'file'; key: string; id: string; name: string; mimeType: string | null }

/** A thumbnail source for a picked post: a library item or a group. */
export type AttachCover = { kind: 'media' | 'group'; ref: string }

export const attachKey = {
  media: (hash: string) => `media:${hash}`,
  group: (id: number) => `group:${id}`,
  audio: (id: string) => `audio:${id}`,
  post: (id: number) => `post:${id}`,
  file: (id: string) => `file:${id}`,
}

/** Captions may not hold brackets (they would end the embed early). */
const caption = (text: string) => text.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()

/** The body line for one pick: the same Markdown the editor has always written. */
export function attachMarkdown(item: AttachItem, postStyle: PostInsertStyle) {
  switch (item.kind) {
    case 'media': return `![](media:${item.hash})`
    case 'group': return `![${caption(item.name)}](group:${item.id})`
    case 'audio': return `![${caption(item.name)}](audio:${item.id})`
    case 'file': return `![${caption(item.name)}](file:${item.id})`
    case 'post': return postStyle === 'card'
      ? `![${caption(item.title)}](${postLink(item.id)})`
      : `[${item.title.replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ')}](${postLink(item.id)})`
  }
}

/** Calls `onVisible` when the sentinel scrolls into its scroll container: infinite lists without a "more" button. */
export function LoadMoreSentinel({ enabled, onVisible, rootMargin = '240px' }: { enabled: boolean; onVisible: () => void; rootMargin?: string }) {
  const [ref, view] = useInView<HTMLDivElement>(rootMargin)
  const callback = useRef(onVisible)
  useEffect(() => { callback.current = onVisible }, [onVisible])
  // Re-enabling after a page lands while the sentinel is still in view asks for the next one.
  useEffect(() => { if (enabled && view.visible) callback.current() }, [enabled, view.visible])
  return <div ref={ref} aria-hidden className="h-px w-full shrink-0" />
}

/** A list row's pick slot: an empty ring, or the pick's order number once picked. */
export function PickOrderMark({ position }: { position: number | undefined }) {
  return (
    <span className={cn('flex size-5 items-center justify-center rounded-full text-2xs font-bold tabular-nums', position ? 'bg-primary text-primary-foreground' : 'border-2 border-outline-input')}>
      {position ?? null}
    </span>
  )
}

const TONE = {
  red: 'bg-destructive-soft text-destructive-soft-foreground',
  blue: 'bg-info-soft text-info-soft-foreground',
  green: 'bg-success-soft text-success-soft-foreground',
  amber: 'bg-warning-soft text-warning-soft-foreground',
  accent: 'bg-primary/14 text-secondary-text',
}
const EXTENSION_TONES: Record<string, string> = {
  PDF: TONE.red, PPTX: TONE.red,
  MD: TONE.blue, TXT: TONE.blue, DOCX: TONE.blue, HTML: TONE.blue,
  CSV: TONE.green, TSV: TONE.green, XLSX: TONE.green,
  JSON: TONE.amber, YAML: TONE.amber, YML: TONE.amber, XML: TONE.amber,
  ZIP: TONE.accent, '7Z': TONE.accent, RAR: TONE.accent, MP3: TONE.accent, WAV: TONE.accent, MP4: TONE.accent,
}

/** A colored extension tile: PDF / MD / ZIP read at a glance. */
export function ExtensionTile({ name, className }: { name: string; className?: string }) {
  const extension = fileExtension(name)
  return (
    <span className={cn('flex shrink-0 items-end justify-center rounded-sm pb-1 text-2xs font-bold', extension ? EXTENSION_TONES[extension] ?? 'bg-surface-highest text-muted-foreground' : 'bg-surface-highest text-muted-foreground', className)}>
      {extension ?? 'FILE'}
    </span>
  )
}
