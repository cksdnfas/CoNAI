import { useMemo, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe, ImageDown, ImageOff, Maximize2, Plus, RefreshCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { useI18n } from '@/i18n'
import { chatAssetUrl, chatMediaThumbnailUrl, chatMediaUrl, getChatMediaInfo, localizeChatImages, type ChatMediaInfo } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { Draft, PatchDraft } from './chat-profile-editor-fields'
import { CollapsibleRow } from './chat-profile-sections'

type Translate = ReturnType<typeof useI18n>['t']

// Same link shapes the server copies (chatMediaLinks.ts): Markdown images, HTML <img>/<source>, whole <video> elements.
const MARKDOWN_IMAGE = /!\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const HTML_VIDEO = /<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi
const HTML_MEDIA = /<(?:img|video|source)\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi
const SRC_ATTRIBUTE = /\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/i
const MEDIA_LINK = /^media:([a-f0-9]{48}|[a-f0-9]{32})\.([a-z0-9]{2,5})$/
const LEGACY_LINK = /^chat-asset:([a-f0-9]{64}\.(?:png|jpg|webp|gif))$/
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov'])
const VIDEO_URL = /\.(?:mp4|webm|mov)(?:[?#]|$)/i
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
}

type TextField = { label: string; text: string }

/** Every prompt text of the draft, labelled the way the editor names it. */
function draftTextFields(draft: Draft, t: Translate): TextField[] {
  return [
    { label: t({ ko: '시스템 프롬프트', en: 'System prompt' }), text: draft.systemPrompt },
    ...draft.promptSections.map((section) => ({ label: section.title.trim() || t({ ko: '제목 없는 섹션', en: 'Untitled section' }), text: section.content })),
    { label: t({ ko: '첫 인사말', en: 'Greeting' }), text: draft.greeting },
    ...draft.alternateGreetings.map((text, index) => ({ label: t({ ko: '추가 인사말 {n}', en: 'Alternate greeting {n}' }, { n: index + 1 }), text })),
  ]
}

/** The draft with `rewrite` applied to every prompt text. */
function mapDraftTexts(draft: Draft, rewrite: (text: string) => string): Partial<Draft> {
  return {
    systemPrompt: rewrite(draft.systemPrompt),
    greeting: rewrite(draft.greeting),
    alternateGreetings: draft.alternateGreetings.map(rewrite),
    promptSections: draft.promptSections.map((section) => ({ ...section, content: rewrite(section.content) })),
  }
}

/** Texts in the order the localize route rewrites them: system prompt, greeting, alternates, sections. */
const localizeTexts = (draft: Draft) => [draft.systemPrompt, draft.greeting, ...draft.alternateGreetings, ...draft.promptSections.map((section) => section.content)]

type MediaEntry = {
  /** The link as written in the text (web URL, `media:` or `chat-asset:` link). */
  link: string
  kind: 'web' | 'media' | 'legacy'
  compositeHash?: string
  extension?: string
  /** A video: by its library extension, or for a web link by its tag (<video>/<source>) or file name. */
  video: boolean
  usedIn: string[]
}

function findEntries(fields: TextField[]): MediaEntry[] {
  const entries = new Map<string, MediaEntry>()
  const add = (link: string, label: string, videoTag: boolean) => {
    const media = MEDIA_LINK.exec(link)
    const kind = media ? 'media' : LEGACY_LINK.test(link) ? 'legacy' : /^https?:\/\//.test(link) ? 'web' : null
    if (!kind) return
    const video = media ? VIDEO_EXTENSIONS.has(media[2]) : kind === 'web' && (videoTag || VIDEO_URL.test(link))
    const entry = entries.get(link) ?? { link, kind, compositeHash: media?.[1], extension: media?.[2], video, usedIn: [] }
    if (!entry.usedIn.includes(label)) entry.usedIn.push(label)
    entries.set(link, entry)
  }
  for (const field of fields) {
    const found: Array<[number, string, boolean]> = []
    for (const match of field.text.matchAll(MARKDOWN_IMAGE)) found.push([match.index ?? 0, match[2], false])
    for (const match of field.text.matchAll(HTML_VIDEO)) {
      const url = SRC_ATTRIBUTE.exec(match[1])?.[1] ?? SRC_ATTRIBUTE.exec(match[2])?.[1]
      if (url) found.push([match.index ?? 0, url, true])
    }
    for (const match of field.text.matchAll(HTML_MEDIA)) found.push([match.index ?? 0, match[1], !/^<img/i.test(match[0])])
    found.sort((a, b) => a[0] - b[0]).forEach(([, link, videoTag]) => add(link, field.label, videoTag))
  }
  return [...entries.values()]
}

/** Drop every image/video of `link` from a text (and the blank lines it leaves). */
function removeLink(text: string, link: string) {
  const next = text
    .replace(MARKDOWN_IMAGE, (whole, _alt: string, url: string) => url === link ? '' : whole)
    .replace(HTML_VIDEO, (whole, attributes: string, body: string) => (SRC_ATTRIBUTE.exec(attributes)?.[1] ?? SRC_ATTRIBUTE.exec(body)?.[1]) === link ? '' : whole)
    .replace(HTML_MEDIA, (whole, url: string) => url === link ? '' : whole)
  return next === text ? text : next.replace(/\n{3,}/g, '\n\n').trim()
}

const replaceAll = (text: string, from: string, to: string) => text.split(from).join(to)

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function reasonLabel(reason: string, t: Translate) {
  const status = /^HTTP (\d+)/.exec(reason)?.[1]
  if (status === '403' || status === '401') return { short: status, long: t({ ko: '접속 거부 (HTTP {status})', en: 'Access denied (HTTP {status})' }, { status }) }
  if (status === '404' || status === '410') return { short: status, long: t({ ko: '링크 만료 (HTTP {status})', en: 'Link expired (HTTP {status})' }, { status }) }
  if (status) return { short: status, long: `HTTP ${status}` }
  const labels: Record<string, string> = {
    'timed out': t({ ko: '시간 초과', en: 'Timed out' }),
    'too large': t({ ko: '50MB 넘음', en: 'Over 50MB' }),
    'not an image': t({ ko: '이미지·영상이 아님', en: 'Not an image or video' }),
    'host not found': t({ ko: '호스트 없음', en: 'Host not found' }),
    'private address': t({ ko: '내부 주소', en: 'Private address' }),
    'too many redirects': t({ ko: '리다이렉트가 너무 많음', en: 'Too many redirects' }),
  }
  const label = labels[reason] ?? reason
  return { short: label, long: label }
}

/** A copy that came through but is probably not the picture the card meant. */
function suspectReason(info: ChatMediaInfo | undefined, t: Translate) {
  if (!info?.available) return null
  if (info.finalUrl && /\/removed\.(?:png|jpe?g)$/i.test(info.finalUrl)) return t({ ko: '삭제 안내 그림으로 리다이렉트됐어', en: 'Redirected to a "removed" placeholder' })
  if (info.width === 161 && info.height === 81) return t({ ko: 'imgur 삭제 안내 그림이랑 크기가 같아', en: 'Same size as imgur’s “removed” placeholder' })
  if (info.width !== null && info.height !== null && Math.min(info.width, info.height) <= 64) return t({ ko: '너무 작아', en: 'Very small' })
  return null
}

function formatBytes(bytes: number | null) {
  if (!bytes) return null
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

type MediaState = 'ok' | 'web' | 'suspect' | 'fail' | 'broken'

/** Copies the draft's web images into the library and remembers what failed; shared by the header button and the row. */
export function useChatMediaLocalize(draft: Draft, patch: PatchDraft) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [failures, setFailures] = useState<Map<string, string>>(() => new Map())
  const mutation = useMutation({
    mutationFn: ({ source, only }: { source: Draft; only?: string[] }) => localizeChatImages(localizeTexts(source), { name: source.name, only }),
    onSuccess: (result, { source }) => {
      const [systemPrompt, greeting, ...rest] = result.texts
      patch({
        systemPrompt,
        greeting,
        alternateGreetings: rest.slice(0, source.alternateGreetings.length),
        promptSections: source.promptSections.map((section, index) => ({ ...section, content: rest[source.alternateGreetings.length + index] ?? section.content })),
      })
      setFailures((current) => {
        const next = new Map(current)
        result.items.forEach((item) => next.delete(item.url))
        result.failed.forEach((item) => next.set(item.url, item.reason))
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['chat-media-info'] })
      const nothing = result.saved === 0 && result.failed.length === 0 && result.remaining === 0
      showSnackbar({
        message: nothing
          ? t({ ko: '저장할 외부 이미지가 없어.', en: 'No web images to save.' })
          : [
              t({ ko: '{saved}개를 라이브러리에 넣었어.', en: 'Added {saved} to the library.' }, { saved: result.saved }),
              result.failed.length ? t({ ko: '못 받은 것 {failed}개.', en: '{failed} failed.' }, { failed: result.failed.length }) : '',
              result.remaining ? t({ ko: '남은 {remaining}개는 한 번 더 눌러.', en: 'Run again for the other {remaining}.' }, { remaining: result.remaining }) : '',
              t({ ko: '프로필을 저장하면 반영돼.', en: 'Save the profile to keep them.' }),
            ].filter(Boolean).join(' '),
        tone: result.failed.length > 0 && result.saved === 0 ? 'error' : 'info',
      })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 저장하지 못했어.', en: 'Could not save the images.' })), tone: 'error' }),
  })
  return {
    failures,
    pending: mutation.isPending,
    run: (only?: string[], source: Draft = draft) => mutation.mutate({ source, only }),
  }
}

function MediaPreview({ entry, onClose }: { entry: MediaEntry; onClose: () => void }) {
  const { t } = useI18n()
  const src = entry.kind === 'media' ? chatMediaUrl(entry.compositeHash!, entry.extension!) : entry.kind === 'legacy' ? chatAssetUrl(entry.link.slice('chat-asset:'.length)) : entry.link
  return (
    <Modal open onClose={onClose} title={t({ ko: '크게 보기', en: 'Preview' })} widthClassName="max-w-4xl">
      <ModalBody className="flex justify-center">
        {entry.video
          ? <video src={src} controls autoPlay loop muted playsInline className="max-h-[70vh] max-w-full rounded-sm" />
          : <img src={src} alt="" referrerPolicy="no-referrer" className="max-h-[70vh] max-w-full rounded-sm object-contain" />}
      </ModalBody>
    </Modal>
  )
}

/**
 * The images and videos the prompt texts show, with what became of each copy: in the library, still a web link, failed,
 * suspicious, or gone from the library. Library media can be added at the caret of the prompt field last edited.
 */
export function ChatProfileMediaRow({ draft, patch, localize, lastTextarea, open, onOpenChange }: {
  draft: Draft
  patch: PatchDraft
  localize: ReturnType<typeof useChatMediaLocalize>
  /** The prompt textarea the user edited last; picked media goes in at its caret. */
  lastTextarea: RefObject<HTMLTextAreaElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const fields = useMemo(() => draftTextFields(draft, t), [draft, t])
  const entries = useMemo(() => findEntries(fields), [fields])
  const hashes = useMemo(() => [...new Set(entries.flatMap((entry) => entry.compositeHash ? [entry.compositeHash] : []))].sort(), [entries])
  const infoQuery = useQuery({ queryKey: ['chat-media-info', hashes.join(',')], queryFn: () => getChatMediaInfo(hashes), enabled: hashes.length > 0, staleTime: 60_000 })
  const infoByHash = useMemo(() => new Map((infoQuery.data ?? []).map((info) => [info.compositeHash, info])), [infoQuery.data])
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<MediaEntry | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const stateOf = (entry: MediaEntry): MediaState => {
    // A web link the browser cannot show (hotlink blocks) is still just a web link: the server may fetch it fine.
    if (entry.kind === 'web') return localize.failures.has(entry.link) ? 'fail' : 'web'
    if (broken.has(entry.link)) return 'broken'
    if (entry.kind === 'legacy') return 'ok'
    const info = infoByHash.get(entry.compositeHash!)
    if (info && !info.available) return 'broken'
    return suspectReason(info, t) ? 'suspect' : 'ok'
  }
  const counts = entries.reduce<Record<MediaState, number>>((sum, entry) => ({ ...sum, [stateOf(entry)]: sum[stateOf(entry)] + 1 }), { ok: 0, web: 0, suspect: 0, fail: 0, broken: 0 })
  const current = entries.find((entry) => entry.link === selected) ?? null

  const markBroken = (link: string) => setBroken((set) => set.has(link) ? set : new Set(set).add(link))
  const sourceOf = (entry: MediaEntry) => entry.kind === 'media' ? infoByHash.get(entry.compositeHash!)?.sourceUrl ?? null : entry.kind === 'web' ? entry.link : null
  const revert = (entry: MediaEntry) => {
    const source = sourceOf(entry)
    if (!source) return
    patch(mapDraftTexts(draft, (text) => replaceAll(text, entry.link, source)))
    setSelected(source)
  }
  const refetch = (entry: MediaEntry) => {
    const source = sourceOf(entry)
    if (!source) return
    if (entry.kind === 'web') {
      localize.run([source])
      return
    }
    // A library copy is fetched again from the link it came from: put the link back first, then copy it.
    localize.run([source], { ...draft, ...mapDraftTexts(draft, (text) => replaceAll(text, entry.link, source)) })
    setSelected(source)
    setBroken((set) => { const next = new Set(set); next.delete(entry.link); return next })
  }
  const remove = (entry: MediaEntry) => {
    patch(mapDraftTexts(draft, (text) => removeLink(text, entry.link)))
    setSelected(null)
  }

  const insertPicked = (items: Array<{ compositeHash: string; mimeType: string | null }>) => {
    setPickerOpen(false)
    const markdown = items.map((item) => {
      const mime = item.mimeType ?? ''
      const extension = EXTENSION_BY_MIME[mime] ?? (mime.startsWith('video/') ? 'mp4' : 'img')
      return `![](media:${item.compositeHash}.${extension})`
    }).join('\n')
    if (!markdown) return
    const textarea = lastTextarea.current
    if (textarea && textarea.isConnected) {
      textarea.focus()
      // insertText keeps the caret, the undo history and React's onChange, so the draft field updates itself.
      if (document.execCommand('insertText', false, markdown)) return
    }
    void navigator.clipboard?.writeText(markdown).catch(() => undefined)
    showSnackbar({ message: t({ ko: '넣을 칸을 먼저 눌러줘. 링크는 복사해뒀어.', en: 'Click the field to insert into first. The link is copied.' }), tone: 'info' })
  }

  const thumbOf = (entry: MediaEntry) => entry.kind === 'media' ? chatMediaThumbnailUrl(entry.compositeHash!) : entry.kind === 'legacy' ? chatAssetUrl(entry.link.slice('chat-asset:'.length)) : entry.link

  const tile = (entry: MediaEntry) => {
    const state = stateOf(entry)
    const info = entry.compositeHash ? infoByHash.get(entry.compositeHash) : undefined
    const ratio = info?.width && info.height ? `${info.width} / ${info.height}` : undefined
    const failure = localize.failures.get(entry.link)
    return (
      // eslint-disable-next-line no-restricted-syntax -- a picture tile; Button padding and centring would crop it
      <button
        key={entry.link}
        type="button"
        onClick={() => setSelected(entry.link)}
        aria-label={entry.usedIn.join(', ')}
        className={cn(
          'relative mb-2 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-sm bg-field outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          selected === entry.link && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        {state === 'fail' || state === 'broken' || (state === 'web' && broken.has(entry.link)) ? (
          <span className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 p-2 text-center text-muted-foreground">
            <ImageOff className="size-6 opacity-70" />
            {state === 'web' ? null : <span className="text-xs font-semibold text-destructive">{state === 'broken' ? t({ ko: '없음', en: 'Missing' }) : reasonLabel(failure ?? '', t).short}</span>}
            {entry.kind === 'web' ? <span className="break-all font-mono text-2xs">{hostOf(entry.link)}</span> : null}
          </span>
        ) : entry.kind === 'web' && entry.video ? (
          <video src={entry.link} muted playsInline preload="metadata" className="block min-h-16 w-full saturate-[.85]" onError={() => markBroken(entry.link)} />
        ) : (
          <img
            src={thumbOf(entry)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ aspectRatio: ratio }}
            className={cn('block h-auto min-h-16 w-full object-cover', state === 'suspect' && 'bg-[repeating-conic-gradient(var(--checker-a)_0%_25%,var(--checker-b)_0%_50%)] bg-[length:12px_12px] object-contain p-3', state === 'web' && 'saturate-[.85]')}
            onError={() => markBroken(entry.link)}
          />
        )}
        {state === 'web' ? <Badge className="text-info"><Globe />{t({ ko: '웹', en: 'Web' })}</Badge> : null}
        {state === 'suspect' ? <Badge className="text-warning"><TriangleAlert />{info?.width}×{info?.height}</Badge> : null}
        {entry.video ? <Badge className="left-auto right-1.5 text-foreground">{t({ ko: '영상', en: 'Video' })}</Badge> : entry.extension === 'gif' ? <Badge className="left-auto right-1.5 text-foreground">GIF</Badge> : null}
      </button>
    )
  }

  const detail = current ? (() => {
    const state = stateOf(current)
    const info = current.compositeHash ? infoByHash.get(current.compositeHash) : undefined
    const source = sourceOf(current)
    const shownLink = source ?? (current.kind === 'media' ? t({ ko: '라이브러리 {id}', en: 'Library {id}' }, { id: current.compositeHash!.slice(0, 12) }) : current.link)
    const facts = [
      info?.width && info.height ? `${info.width}×${info.height}` : null,
      current.extension?.toUpperCase() ?? null,
      info?.duration ? `${info.duration.toFixed(1)}s` : null,
      formatBytes(info?.fileSize ?? null),
    ].filter(Boolean).join(' · ')
    const status = state === 'fail' ? <span className="font-semibold text-destructive">{reasonLabel(localize.failures.get(current.link) ?? '', t).long}</span>
      : state === 'broken' ? <span className="font-semibold text-destructive">{t({ ko: '라이브러리에서 지워졌어', en: 'Removed from the library' })}</span>
      : state === 'suspect' ? <span className="font-semibold text-warning">{suspectReason(info, t)}</span>
      : state === 'web' ? <span className="font-semibold text-info">{t({ ko: '아직 외부 링크', en: 'Still a web link' })}</span>
      : null
    return (
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
        <div className="flex size-11 items-center justify-center overflow-hidden rounded-sm bg-field text-muted-foreground">
          {state === 'fail' || state === 'broken' || broken.has(current.link) ? <ImageOff className="size-5" />
            : current.kind === 'web' && current.video ? <video src={current.link} muted playsInline preload="metadata" className="size-full object-cover" />
            : <img src={thumbOf(current)} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
        </div>
        <div className="min-w-0">
          <div className="truncate font-mono text-xs" title={[source ?? current.link, info?.finalUrl ? `→ ${info.finalUrl}` : null].filter(Boolean).join('\n')}>{shownLink}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            {status}
            {facts && state !== 'fail' ? <span className="tabular-nums">{facts}</span> : null}
            {current.usedIn.map((label) => <span key={label} className="rounded-xs bg-fill px-1.5 text-2xs">{label}</span>)}
          </div>
        </div>
        <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
          {state !== 'fail' && state !== 'broken' ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '크게 보기', en: 'Preview' })} onClick={() => setPreview(current)}><Maximize2 /></IconButton> : null}
          {source ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '원본 열기', en: 'Open original' })} onClick={() => window.open(source, '_blank', 'noopener,noreferrer')}><ExternalLink /></IconButton> : null}
          {state === 'web' ? <IconButton size="icon-sm" variant="ghost" disabled={localize.pending} label={t({ ko: '이것만 받기', en: 'Save this one' })} onClick={() => refetch(current)}><ImageDown /></IconButton> : null}
          {source && (state === 'fail' || state === 'broken' || state === 'suspect') ? <IconButton size="icon-sm" variant="ghost" disabled={localize.pending} label={t({ ko: '다시 받기', en: 'Fetch again' })} onClick={() => refetch(current)}><RefreshCw /></IconButton> : null}
          {current.kind === 'media' && source ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '원래 링크로 되돌리기', en: 'Restore the original link' })} onClick={() => revert(current)}><Undo2 /></IconButton> : null}
          <IconButton size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" label={t({ ko: '텍스트에서 빼기', en: 'Remove from the text' })} onClick={() => remove(current)}><Trash2 /></IconButton>
        </div>
      </div>
    )
  })() : null

  const summary = (
    <span className="flex gap-2.5 text-xs font-semibold tabular-nums">
      {counts.web ? <span className="text-info">{t({ ko: '웹 {n}', en: 'Web {n}' }, { n: counts.web })}</span> : null}
      {counts.suspect ? <span className="text-warning">{t({ ko: '확인 {n}', en: 'Check {n}' }, { n: counts.suspect })}</span> : null}
      {counts.fail ? <span className="text-destructive">{t({ ko: '실패 {n}', en: 'Failed {n}' }, { n: counts.fail })}</span> : null}
      {counts.broken ? <span className="text-destructive">{t({ ko: '없음 {n}', en: 'Missing {n}' }, { n: counts.broken })}</span> : null}
    </span>
  )

  return (
    <>
      <CollapsibleRow
        title={t({ ko: '이미지', en: 'Images' })}
        meta={entries.length || null}
        actions={summary}
        open={open}
        onOpenChange={onOpenChange}
      >
        <div className="columns-3 gap-2 sm:columns-5">
          {entries.map(tile)}
          <Tip content={t({ ko: '라이브러리에서 넣기', en: 'Insert from the library' })}>
            {/* eslint-disable-next-line no-restricted-syntax -- a tile in the masonry; Button would not fill the column */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label={t({ ko: '라이브러리에서 넣기', en: 'Insert from the library' })}
              className="mb-2 flex aspect-square w-full cursor-pointer break-inside-avoid items-center justify-center rounded-sm bg-field text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Plus className="size-5" />
            </button>
          </Tip>
        </div>
        {detail}
      </CollapsibleRow>
      {preview ? <MediaPreview entry={preview} onClose={() => setPreview(null)} /> : null}
      {pickerOpen ? (
        <ChatMediaPicker
          initial={[]}
          maxCount={20}
          title={t({ ko: '라이브러리에서 넣기', en: 'Insert from the library' })}
          applyLabel={t({ ko: '넣기', en: 'Insert' })}
          note={null}
          onPick={insertPicked}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  )
}

function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('absolute left-1.5 top-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-backdrop/70 px-1.5 text-2xs font-bold backdrop-blur-sm [&_svg]:size-3', className)}>{children}</span>
}

/** Remembers the prompt textarea last focused inside the panel, for inserting picked media at its caret. */
export function useLastTextarea() {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLTextAreaElement) ref.current = event.target
  }
  return { ref, onFocusCapture }
}
