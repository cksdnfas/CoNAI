import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, ImageOff, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaHoverPreview } from '@/components/common/media-hover-preview'
import { Spinner } from '@/components/ui/loading-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { useI18n } from '@/i18n'
import type { ChatDisplayBlock, ChatEngine, CodexChatMediaInfo, CodexChatMessage, CodexChatToolCall } from '@/lib/api-codex-chat'
import { requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import type { ImageRecord } from '@/types/image'
import type { ChatAvatarSize } from './chat-appearance'
import { ChatErrorChip } from './chat-error-chip'
import { ChatMarkdown, type ChatEmoticonMap } from './chat-markdown'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { MENTION_CLASS, splitMentions } from './chat-mentions'

const HISTORY_POLL_MS = 3000
const THUMB_CLASS = 'w-auto rounded-sm object-cover'
/** `full`: the chat's width at the image's own ratio (the original file, so it stays sharp). */
const THUMB_SIZE_CLASS = { sm: 'h-28 max-w-[14rem]', md: 'h-40 max-w-[20rem]', full: 'block h-auto w-full object-contain' } as const
const THUMB_PLACEHOLDER_CLASS = { sm: 'h-28 w-28', md: 'h-40 w-40', full: 'aspect-video w-full' } as const

export type ThumbSize = keyof typeof THUMB_SIZE_CLASS

/** A library image as the lightbox needs it; history rows and the thread's media map add mime type and size. */
export function buildChatImageRecord(compositeHash: string, record?: GenerationHistoryRecord, info?: CodexChatMediaInfo): ImageRecord {
  return {
    id: compositeHash,
    composite_hash: compositeHash,
    thumbnail_url: buildApiUrl(`/api/images/${compositeHash}/thumbnail`),
    image_url: buildApiUrl(`/api/images/${compositeHash}/file`),
    mime_type: record?.actual_mime_type ?? info?.mimeType ?? null,
    width: record?.actual_width ?? info?.width ?? record?.width ?? null,
    height: record?.actual_height ?? info?.height ?? record?.height ?? null,
  }
}

/**
 * The box a thumbnail occupies before it is drawn. With the image's dimensions known it is the exact size the image
 * will take (same height/width rules as the image itself), so nothing moves when the image appears.
 */
function thumbPlaceholder(size: ThumbSize, width: number | null | undefined, height: number | null | undefined) {
  if (width && height) {
    return { className: size === 'full' ? 'w-full' : THUMB_SIZE_CLASS[size], style: { aspectRatio: `${width} / ${height}` } }
  }
  return { className: THUMB_PLACEHOLDER_CLASS[size], style: undefined }
}

/** Retries of a thumbnail that is not served yet; the waits add up to about a minute. */
const THUMB_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 15000]

/**
 * Thumbnails that already loaded this session, by their canonical URL → the URL that worked. A thumbnail mounted again
 * (the streamed reply is replaced by the stored message, the thread refetches) starts drawn, with no spinner or fade.
 */
const settledThumbnails = new Map<string, string>()

/**
 * A new result is marked completed slightly before its file finishes post-processing, and until then the image routes
 * answer 404. The `<img>` stays mounted and hidden while it retries (new URL each time) and shows once it has loaded,
 * so the placeholder never flashes in and out.
 */
function useRetriedThumbnail(url: string) {
  const settled = settledThumbnails.get(url)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(settled !== undefined)
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }, [])
  const src = settled ?? (attempt === 0 || !url ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`)
  const onError = () => {
    if (loaded) return
    if (attempt >= THUMB_RETRY_DELAYS_MS.length) {
      setFailed(true)
      return
    }
    timerRef.current = window.setTimeout(() => setAttempt((current) => current + 1), THUMB_RETRY_DELAYS_MS[attempt])
  }
  const onLoad = () => {
    if (url) settledThumbnails.set(url, src)
    setLoaded(true)
    setFailed(false)
  }
  return { src, loaded, failed, onError, onLoad }
}

/** Click opens the lightbox; on PC a short hover shows a larger preview beside it. */
function ChatImageThumb({ image, size, onOpen }: { image: ImageRecord; size: ThumbSize; onOpen: () => void }) {
  const { t } = useI18n()
  const thumbnailUrl = image.thumbnail_url ?? ''
  const retried = useRetriedThumbnail(size === 'full' ? image.image_url ?? thumbnailUrl : thumbnailUrl)
  const isVideo = image.mime_type?.startsWith('video/') === true
  const hoverPreview = useMediaHoverPreview(thumbnailUrl ? { src: thumbnailUrl, fullSrc: isVideo ? null : image.image_url, videoSrc: isVideo ? image.image_url : null } : null)
  const drawn = isVideo || retried.loaded
  const placeholder = thumbPlaceholder(size, image.width, image.height)

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control; Button padding/height would crop it */}
      <button
        type="button"
        aria-label={t({ ko: '크게 보기', en: 'View larger' })}
        // Until the image is drawn the button is the placeholder box: same footprint, spinner on top.
        className={cn(
          'relative shrink-0 overflow-hidden rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          size === 'full' && 'w-full',
          drawn ? 'cursor-zoom-in' : cn('cursor-default bg-surface-high text-muted-foreground', placeholder.className),
        )}
        style={drawn ? undefined : placeholder.style}
        onClick={drawn ? onOpen : undefined}
        {...(drawn ? hoverPreview.triggerProps : {})}
      >
        {isVideo ? (
          // Videos play muted and looped in place, like the library grid.
          <ImagePreviewMedia image={image} className={cn(THUMB_CLASS, THUMB_SIZE_CLASS[size])} />
        ) : (
          <img
            src={retried.src}
            alt=""
            loading="lazy"
            draggable={false}
            onError={retried.onError}
            onLoad={retried.onLoad}
            className={cn(
              THUMB_CLASS, THUMB_SIZE_CLASS[size], 'transition-opacity duration-300 ease-out',
              drawn ? 'opacity-100' : 'absolute inset-0 h-full w-full opacity-0',
            )}
          />
        )}
        {!drawn && (
          <span className="absolute inset-0 flex items-center justify-center">
            {retried.failed ? <ImageOff className="size-5" /> : <Spinner size="md" />}
          </span>
        )}
      </button>
      {hoverPreview.preview}
    </>
  )
}

function historyQueryOptions(historyId: number) {
  return {
    queryKey: ['codex-chat-history', historyId] as const,
    queryFn: () => requestJson<{ success: boolean; record: GenerationHistoryRecord }>(`/api/generation-history/${historyId}`, { cache: 'no-store' }),
    refetchInterval: (query: { state: { data?: { record: GenerationHistoryRecord } } }) => {
      const status = query.state.data?.record.generation_status
      return status === 'completed' || status === 'failed' ? false : HISTORY_POLL_MS
    },
    retry: false,
  }
}

function resolveHistoryHash(record: GenerationHistoryRecord | undefined) {
  return record?.actual_composite_hash ?? record?.composite_hash ?? null
}

/** A generation result: polls the history row until its image lands, then shows it like any library image. */
function HistoryThumb({ historyId, size, media, onOpen }: { historyId: number; size: ThumbSize; media?: Record<string, CodexChatMediaInfo>; onOpen: (compositeHash: string) => void }) {
  const historyQuery = useQuery(historyQueryOptions(historyId))
  const record = historyQuery.data?.record
  const compositeHash = resolveHistoryHash(record)

  if (record?.generation_status === 'completed' && compositeHash) {
    return <ChatImageThumb image={buildChatImageRecord(compositeHash, record, media?.[compositeHash])} size={size} onOpen={() => onOpen(compositeHash)} />
  }

  // The requested size is known before the image is: the box already has the image's shape.
  const placeholder = thumbPlaceholder(size, record?.width, record?.height)
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-sm bg-surface-high text-muted-foreground', placeholder.className)} style={placeholder.style}>
      {historyQuery.isError || record?.generation_status === 'failed' ? <ImageOff className="size-5" /> : <Spinner size="md" />}
    </div>
  )
}

type ToolCallGroup = { tool: string; count: number; status: CodexChatToolCall['status']; summary: string | null }

/** Agents poll (`get_generation_job` ×N); one row per tool keeps the reply readable. The last call speaks for the group. */
function groupToolCalls(calls: CodexChatToolCall[]): ToolCallGroup[] {
  const groups = new Map<string, ToolCallGroup>()
  for (const call of calls) {
    const group = groups.get(call.tool)
    groups.set(call.tool, {
      tool: call.tool,
      count: (group?.count ?? 0) + 1,
      status: group?.status === 'running' || call.status === 'running' ? 'running' : call.status,
      summary: call.summary ?? group?.summary ?? null,
    })
  }
  return [...groups.values()]
}

function ToolStatusIcon({ status }: { status: CodexChatToolCall['status'] }) {
  if (status === 'running') {
    return <Spinner size="sm" />
  }
  return status === 'failed' ? <X className="size-3.5 text-destructive" /> : <Check className="size-3.5" />
}

const HOVER_DELAY_MS = 120

/** The tools a reply used, as one wrench + count; hovering (or tapping) it lists them. */
function ToolCallsBadge({ calls }: { calls: CodexChatToolCall[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const timerRef = useRef<number | null>(null)
  const groups = groupToolCalls(calls)
  const status: CodexChatToolCall['status'] = calls.some((call) => call.status === 'running')
    ? 'running'
    : calls.some((call) => call.status === 'failed') ? 'failed' : 'completed'
  // Hover opens it on PC; touch has no hover, so a tap toggles it instead.
  const hoverTo = (next: boolean) => (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') {
      return
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => setOpen(next), HOVER_DELAY_MS)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 px-1.5 font-normal text-muted-foreground"
          aria-label={t({ ko: '사용한 도구 {count}개', en: '{count} tool calls' }, { count: calls.length })}
          onPointerEnter={hoverTo(true)}
          onPointerLeave={hoverTo(false)}
        >
          <Wrench />
          <span className="tabular-nums">{calls.length}</span>
          {status !== 'completed' ? <ToolStatusIcon status={status} /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto min-w-48 max-w-[min(22rem,90vw)] p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={hoverTo(true)}
        onPointerLeave={hoverTo(false)}
      >
        <ul className="space-y-0.5">
          {groups.map((group) => (
            <li key={group.tool} className="rounded-sm px-2 py-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-mono">{group.tool}</span>
                {group.count > 1 ? <span className="tabular-nums text-muted-foreground">×{group.count}</span> : null}
                <span className="text-muted-foreground"><ToolStatusIcon status={group.status} /></span>
              </div>
              {group.summary ? <p className="mt-0.5 line-clamp-2 break-words font-mono text-2xs text-muted-foreground">{group.summary}</p> : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** Images and videos the reply's tools produced or found. */
function CodexChatToolMedia({ calls, size = 'md', media }: { calls: CodexChatToolCall[]; size?: ThumbSize; media?: Record<string, CodexChatMediaInfo> }) {
  const { t } = useI18n()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const historyIds = [...new Set(calls.flatMap((call) => call.historyIds))]
  const pendingJobIds = [...new Set(calls.flatMap((call) => call.pendingJobIds ?? []))]
  // History rows resolve to library images too; skip hashes a history thumbnail already shows.
  const historyQueries = useQueries({ queries: historyIds.map((historyId) => historyQueryOptions(historyId)) })
  const historyHashes = new Set(historyQueries.map((query) => resolveHistoryHash(query.data?.record)).filter(Boolean))
  const compositeHashes = [...new Set(calls.flatMap((call) => call.compositeHashes))].filter((hash) => !historyHashes.has(hash))
  // The lightbox pages through this message's images only, in the order the thumbnails show them.
  const lightboxItems: ImageRecord[] = [
    ...historyQueries.flatMap((query) => {
      const record = query.data?.record
      const hash = record?.generation_status === 'completed' ? resolveHistoryHash(record) : null
      return hash ? [buildChatImageRecord(hash, record, media?.[hash])] : []
    }),
    ...compositeHashes.map((hash) => buildChatImageRecord(hash, undefined, media?.[hash])),
  ]
  const openLightbox = (compositeHash: string) => {
    const index = lightboxItems.findIndex((item) => item.composite_hash === compositeHash)
    setLightboxIndex(index >= 0 ? index : null)
  }

  if (historyIds.length === 0 && compositeHashes.length === 0 && pendingJobIds.length === 0) {
    return null
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {pendingJobIds.map((jobId) => (
          <div key={`j${jobId}`} className={cn('flex shrink-0 flex-col items-center justify-center gap-2 rounded-sm bg-surface-high text-xs text-muted-foreground', THUMB_PLACEHOLDER_CLASS[size])}>
            <Spinner size="md" />
            {t({ ko: '생성 대기 중', en: 'Queued' })}
          </div>
        ))}
        {historyIds.map((historyId) => <HistoryThumb key={`h${historyId}`} historyId={historyId} size={size} media={media} onOpen={openLightbox} />)}
        {compositeHashes.map((hash) => <ChatImageThumb key={hash} image={buildChatImageRecord(hash, undefined, media?.[hash])} size={size} onOpen={() => openLightbox(hash)} />)}
      </div>
      <MediaLightbox items={lightboxItems} index={lightboxIndex} onIndexChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} />
    </>
  )
}

/** `mentions`: group room member names, highlighted where the message addresses them. */
export const CodexChatUserMessage = memo(function CodexChatUserMessage({ content, mentions }: { content: string; mentions?: readonly string[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-high px-3.5 py-2 text-foreground">
        {mentions?.length ? splitMentions(content, mentions).map((part, index) => part.mention ? <span key={index} className={MENTION_CLASS}>{part.text}</span> : part.text) : content}
      </div>
    </div>
  )
})

/** While a reply is in progress: what it is doing right now, so a long chain of tool calls never looks finished. */
function ActivityLine({ toolCalls }: { toolCalls: CodexChatToolCall[] }) {
  const { t } = useI18n()
  const runningTool = [...toolCalls].reverse().find((call) => call.status === 'running')
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Spinner size="sm" />
      <span className="truncate">
        {runningTool ? t({ ko: '도구 실행 중: {tool}', en: 'Running tool: {tool}' }, { tool: runningTool.tool }) : t({ ko: '작업 중…', en: 'Working…' })}
      </span>
    </div>
  )
}

/** Another character of the profile who can speak in a reply (`[Name]` lines). */
export type ChatCastSpeaker = { name: string; avatar: string | null; color: string }

/** Who answers in a chat: the thread's profile, its look, and the other characters it voices. */
export type ChatSpeaker = {
  name: string
  avatar: string | null
  engine: ChatEngine
  roleplay?: boolean
  blocks?: ChatDisplayBlock[]
  cast?: ChatCastSpeaker[]
  /** The profile's emoticons (`&*keyword*&`). */
  emoticons?: ChatEmoticonMap | null
  /** Group rooms: member names, so `@name` mentions are highlighted. */
  mentions?: readonly string[]
}

/** A `[Name]` line (or line start) switching the speaker; only names of the profile or its cast count. */
const CAST_MARKER_PATTERN = /^[ \t]*\[([^\]\n]{1,40})\][ \t]*/gm

type CastSegment = { speaker: ChatCastSpeaker | null; text: string }

/** Splits a reply into parts by speaker; `speaker: null` is the profile itself. */
function splitByCast(text: string, profileName: string, cast: ChatCastSpeaker[]): CastSegment[] {
  const members = new Map(cast.filter((member) => member.name).map((member) => [member.name.toLowerCase(), member]))
  const segments: CastSegment[] = []
  let current: CastSegment = { speaker: null, text: '' }
  let cursor = 0
  for (const match of text.matchAll(CAST_MARKER_PATTERN)) {
    const name = match[1].trim().toLowerCase()
    const member = members.get(name)
    if (!member && name !== profileName.toLowerCase()) continue
    const index = match.index ?? 0
    current.text += text.slice(cursor, index)
    segments.push(current)
    current = { speaker: member ?? null, text: '' }
    cursor = index + match[0].length
  }
  current.text += text.slice(cursor)
  segments.push(current)
  return segments.filter((segment) => segment.text.trim())
}

/** The model's reasoning while it streams, folded by default (never stored). */
function ReasoningBlock({ text, active }: { text: string; active: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-muted-foreground">
      <Button variant="ghost" size="xs" className="-ml-2 gap-1 text-muted-foreground" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
        {active ? t({ ko: '생각하는 중…', en: 'Thinking…' }) : t({ ko: '생각한 과정', en: 'Reasoning' })}
      </Button>
      {open ? <div className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-l border-line pl-3 leading-relaxed">{text}</div> : null}
    </div>
  )
}

/** Appearance setting → avatar size; small keeps the name line compact, larger sizes sit in a column beside the reply. */
const AVATAR_SIZE = { sm: 'sm', md: 'lg', lg: 'xl' } as const

export const CodexChatAssistantMessage = memo(function CodexChatAssistantMessage({ content, toolCalls, status, error, reasoning, streaming = false, imageSize = 'full', speaker = null, media, avatarSize = 'md' }: {
  content: string
  toolCalls: CodexChatToolCall[]
  status?: CodexChatMessage['status']
  error?: string | null
  /** Live reasoning text of a streaming LLM reply. */
  reasoning?: string
  streaming?: boolean
  /** The reader's image size (chat appearance). */
  imageSize?: ThumbSize
  speaker?: ChatSpeaker | null
  /** Media kind of the images the thread references (videos play inline). */
  media?: Record<string, CodexChatMediaInfo>
  avatarSize?: ChatAvatarSize
}) {
  const { t } = useI18n()
  const avatarBeside = speaker !== null && avatarSize !== 'sm'
  const toolBadge = toolCalls.length > 0 ? <ToolCallsBadge calls={toolCalls} /> : null
  const markdown = (text: string) => <ChatMarkdown text={text} roleplay={speaker?.roleplay} blocks={speaker?.blocks} emoticons={speaker?.emoticons} mentions={speaker?.mentions} />
  const avatarOf = (who: { name: string; avatar: string | null }, engine: ChatEngine) => (
    <ChatProfileAvatar name={who.name} avatar={who.avatar} engine={engine} size={AVATAR_SIZE[avatarSize]} className={avatarSize === 'lg' ? 'size-14 text-lg' : undefined} />
  )

  /** One speaker's part: avatar beside (or inline with) the name, then the content. */
  const row = (key: string, who: { name: string; avatar: string | null; color?: string } | null, engine: ChatEngine, extra: ReactNode, children: ReactNode) => {
    const avatar = who ? avatarOf(who, engine) : null
    const body = (
      <div className="min-w-0 flex-1 space-y-2">
        {who || extra ? (
          <div className="flex min-h-6 items-center gap-1.5">
            {avatarBeside ? null : avatar}
            {who ? <span className="truncate text-xs font-semibold text-muted-foreground" style={who.color ? { color: who.color } : undefined}>{who.name}</span> : null}
            {extra}
          </div>
        ) : null}
        {children}
      </div>
    )
    return avatarBeside ? <div key={key} className="flex items-start gap-3">{avatar}{body}</div> : <div key={key}>{body}</div>
  }

  const segments = content && speaker?.cast?.length ? splitByCast(content, speaker.name, speaker.cast) : null
  const hasCast = segments?.some((segment) => segment.speaker !== null) ?? false
  // Without cast lines the whole reply is the profile's; with them, only the leading part (if any) is.
  const ownText = hasCast ? (segments?.[0]?.speaker === null ? segments[0].text : '') : content
  const castSegments = hasCast ? (segments ?? []).filter((segment, index) => !(index === 0 && segment.speaker === null)) : []
  const ownParts = (
    <>
      {reasoning ? <ReasoningBlock text={reasoning} active={streaming && !content} /> : null}
      <CodexChatToolMedia calls={toolCalls} size={imageSize} media={media} />
      {ownText ? markdown(ownText) : null}
    </>
  )
  const showOwnRow = !hasCast || Boolean(ownText || reasoning || toolCalls.length > 0)
  const footer = (
    <>
      {streaming ? <ActivityLine toolCalls={toolCalls} /> : null}
      {status === 'interrupted' ? <p className="text-xs text-muted-foreground">{t({ ko: '중단됨', en: 'Stopped' })}</p> : null}
      {status === 'failed' ? <ChatErrorChip error={error ?? null} /> : null}
    </>
  )

  if (!hasCast) {
    return row('own', speaker, speaker?.engine ?? 'llm', toolBadge, <>{ownParts}{footer}</>)
  }

  return (
    <div className="space-y-5">
      {showOwnRow ? row('own', speaker, speaker?.engine ?? 'llm', toolBadge, ownParts) : null}
      {castSegments.map((segment, index) => row(`cast-${index}`, segment.speaker ?? speaker, segment.speaker ? 'llm' : speaker?.engine ?? 'llm', null, markdown(segment.text)))}
      {/* Status lines line up with the text column. */}
      <div className={cn('space-y-2', avatarBeside && (avatarSize === 'lg' ? 'pl-17' : 'pl-13'))}>{footer}</div>
    </div>
  )
})
