import { chatMediaHash } from './chatForm'

/*
 * Display cards inside a reply: the model writes a ```card block in a compact line format (an inference format) and the
 * chat draws it in place. decodeChatView turns the lines into one canonical model whose rows reuse the form catalog's
 * names where they exist (Text, Divider) plus display rows; the chat's renderer table is keyed by the same union.
 */

export const CHAT_VIEW_LANGUAGE = 'card'
export const CHAT_VIEW_LIMITS = { rows: 40, text: 300, label: 40, rowImages: 12, images: 24 } as const

export type ChatViewText = { component: 'Text'; text: string; variant: 'heading' | 'body' | 'caption' }
export type ChatViewDivider = { component: 'Divider' }
export type ChatViewStat = { component: 'Stat'; label: string; value: string }
/** `text` is the value as written ("72/100", "45%"). */
export type ChatViewProgress = { component: 'Progress'; label: string; value: number; max: number; text: string }
/** Library media by composite hash. */
export type ChatViewMedia = { component: 'Media'; items: string[] }
export type ChatViewRow = ChatViewText | ChatViewDivider | ChatViewStat | ChatViewProgress | ChatViewMedia
export type ChatView = { rows: ChatViewRow[] }

type Component = ChatViewRow['component']
type LineRule = { [K in Component]: {
  component: K
  /** Example lines for the reply guidance, each one valid as written (models copy them), and their place in it; rules without them are not taught. */
  guide?: { at: number; lines: string[] }
  decode(line: string, images: { left: number }): Extract<ChatViewRow, { component: K }> | null
} }[Component]

const NUMBER = String.raw`\d+(?:\.\d+)?`
// A value that starts with `n/m` or `n%`; what follows it ("72/100 (poisoned)") stays in the row's text.
const FRACTION = new RegExp(String.raw`^(${NUMBER})\s*/\s*(${NUMBER})(?=$|[\s(])`)
const PERCENT = new RegExp(String.raw`^(${NUMBER})\s*%(?=$|[\s(])`)
/** Bars a model draws itself beside the number. */
const DRAWN_BAR = /[\u2580-\u259F\u25A0-\u25A1\u25B0-\u25B1]+/g
const IMAGES_KEY = /^images?\s*[:：]\s*/i

/** Without emphasis marks (`**`, `__`, backticks, a wrapping `*…*`): inline markdown is not parsed inside a card. */
const plain = (text: string) => text.replace(/\*\*|__|`/g, '').trim().replace(/^\*(.+)\*$/, '$1').trim()
const cut = (text: string, limit: number) => (text.length > limit ? text.slice(0, limit) : text)

/**
 * `Label: value` split at the first colon (ASCII or full-width). Not a label when the colon sits between digits (a time
 * such as 12:30), starts a URL (`http://`), the label is empty or too long, or the value is empty.
 */
function labelled(line: string): { label: string; value: string } | null {
  const at = line.search(/[:：]/)
  if (at <= 0) return null
  const rest = line.slice(at + 1)
  if (rest.startsWith('//') || (/\d/.test(line[at - 1]) && /^\d/.test(rest))) return null
  const label = plain(line.slice(0, at))
  const value = plain(rest)
  return label && label.length <= CHAT_VIEW_LIMITS.label && value ? { label, value: cut(value, CHAT_VIEW_LIMITS.text) } : null
}

const text = (variant: ChatViewText['variant'], value: string): ChatViewText | null => {
  const said = cut(plain(value), CHAT_VIEW_LIMITS.text)
  return said ? { component: 'Text', text: said, variant } : null
}

/** Tried in order on each line; the last one takes any line. The decoder and the reply guidance both read this table. */
const VIEW_LINES: readonly LineRule[] = [
  { component: 'Text', guide: { at: 0, lines: ['# Status'] }, decode: (line) => (/^#{1,6}\s/.test(line) ? text('heading', plain(line.replace(/^#+/, ''))) : null) },
  { component: 'Divider', guide: { at: 3, lines: ['---'] }, decode: (line) => (/^-{3,}$/.test(line) ? { component: 'Divider' } : null) },
  { component: 'Text', decode: (line) => (line.startsWith('>') ? text('caption', line.slice(1)) : null) },
  {
    component: 'Media',
    guide: { at: 4, lines: ['images: <composite hash>, …'] },
    // Past the total limit the row comes back empty and is left out.
    decode: (line, images) => {
      const keyed = IMAGES_KEY.test(line)
      const hashes = line.replace(IMAGES_KEY, '').split(/[\s,，]+/).filter(Boolean).map((token) => chatMediaHash(plain(token)))
      // Junk tokens drop out of an `images:` line; a bare line counts only when every token is a hash.
      const found = [...new Set(hashes.filter(Boolean))]
      if (found.length === 0 || (!keyed && hashes.includes(''))) return null
      const items = found.slice(0, Math.min(CHAT_VIEW_LIMITS.rowImages, images.left))
      images.left -= items.length
      return { component: 'Media', items }
    },
  },
  {
    component: 'Progress',
    guide: { at: 2, lines: ['HP: 72/100'] },
    decode: (line) => {
      const pair = labelled(line)
      const fraction = pair && FRACTION.exec(pair.value)
      const percent = pair && !fraction ? PERCENT.exec(pair.value) : null
      const value = Number(fraction?.[1] ?? percent?.[1])
      const max = fraction ? Number(fraction[2]) : 100
      const said = pair?.value.replace(DRAWN_BAR, '').replace(/\s+/g, ' ').trim()
      return pair && said && (fraction || percent) && max > 0 ? { component: 'Progress', label: pair.label, value, max, text: said } : null
    },
  },
  {
    component: 'Stat',
    guide: { at: 1, lines: ['Place: forest'] },
    decode: (line) => {
      const pair = labelled(line)
      return pair && { component: 'Stat', ...pair }
    },
  },
  { component: 'Text', decode: (line) => text('body', line) },
]

/** The line format as the reply guidance gives it: example lines, one per line as a card is written. */
export function describeChatViewLines(): string {
  const guides = VIEW_LINES.flatMap((rule) => (rule.guide ? [rule.guide] : [])).sort((a, b) => a.at - b.at)
  return guides.flatMap((guide) => guide.lines).join('\n')
}

/**
 * Several items written on one line with `; ` between them (`# Downloads; A: 30%; B: 75%`) as separate lines, only when
 * every part is a heading, a divider or a `Label: value`; a value that merely holds semicolons stays one line.
 */
function joinedItems(line: string): string[] {
  const parts = line.split(/\s*;\s+/).filter(Boolean)
  return parts.length > 1 && parts.every((part) => /^#{1,6}\s/.test(part) || /^-{3,}$/.test(part) || labelled(part)) ? parts : [line]
}

/**
 * A ```card block as a view, or null when it holds nothing drawable (the caller shows it as a code block). Limits cut
 * rather than fail. A block still being written decodes as far as it goes and its last line is kept: it may change kind
 * as it grows (a Stat becoming a Progress), which reads better than holding the line back.
 */
export function decodeChatView(source: string): ChatView | null {
  const rows: ChatViewRow[] = []
  const images = { left: CHAT_VIEW_LIMITS.images }
  for (const raw of source.split(/\r?\n/)) {
    if (rows.length >= CHAT_VIEW_LIMITS.rows) break
    // A list marker is dropped first: models bullet their `Label: value` lines.
    const line = raw.trim().replace(/^[-*•]\s+/, '')
    if (!line) continue
    for (const item of joinedItems(line)) {
      if (rows.length >= CHAT_VIEW_LIMITS.rows) break
      for (const rule of VIEW_LINES) {
        const row = rule.decode(item, images)
        if (!row) continue
        if (row.component !== 'Media' || row.items.length > 0) rows.push(row)
        break
      }
    }
  }
  return rows.some((row) => row.component !== 'Divider') ? { rows } : null
}

/**
 * A view as canonical lines, one row per line: decodeChatView reads a decoded view back as the same rows. Nothing is
 * escaped, so a changed text (a translation) may read as another kind; callers that change texts decode and compare.
 */
export function encodeChatView(view: ChatView): string {
  return view.rows.map((row) => {
    switch (row.component) {
      case 'Text': return row.variant === 'heading' ? `# ${row.text}` : row.variant === 'caption' ? `> ${row.text}` : row.text
      case 'Divider': return '---'
      case 'Stat': return `${row.label}: ${row.value}`
      case 'Progress': return `${row.label}: ${row.text}`
      case 'Media': return `images: ${row.items.join(', ')}`
    }
  }).join('\n')
}
