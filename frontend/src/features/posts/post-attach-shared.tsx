import { useEffect, useRef, type ReactNode } from 'react'
import { postLink } from '@conai/shared'
import { cn } from '@/lib/utils'

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
export function LoadMoreSentinel({ enabled, onVisible }: { enabled: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const callback = useRef(onVisible)
  useEffect(() => { callback.current = onVisible }, [onVisible])
  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current() }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])
  return <div ref={ref} aria-hidden className="h-px w-full shrink-0" />
}

/** The picker's two panes: a tree on the left, the list on the right, each scrolling on its own. */
export function AttachPanes({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-4 flex min-h-0 flex-1 border-y border-line md:-mx-5">
      <nav className="hidden w-60 shrink-0 overflow-y-auto border-r border-line p-2 sm:block">{side}</nav>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

/** The list pane's one-row toolbar. */
export function AttachToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5', className)}>{children}</div>
}

/** Wraps every case-insensitive occurrence of `term` in a highlight. */
export function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim()
  if (!needle) return <>{text}</>
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return <>{parts.map((part, index) => index % 2 === 1 ? <mark key={index} className="bg-transparent font-semibold text-primary">{part}</mark> : part)}</>
}

/** A file's extension in capitals (PDF, ZIP…), or null. */
export function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  return match ? match[1].toUpperCase() : null
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
  const extension = extensionOf(name)
  return (
    <span className={cn('flex shrink-0 items-end justify-center rounded-sm pb-1 text-2xs font-bold', extension ? EXTENSION_TONES[extension] ?? 'bg-surface-highest text-muted-foreground' : 'bg-surface-highest text-muted-foreground', className)}>
      {extension ?? 'FILE'}
    </span>
  )
}
