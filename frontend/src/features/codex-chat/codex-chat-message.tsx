import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, ImageOff, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaHoverPreview } from '@/components/common/media-hover-preview'
import { Spinner } from '@/components/ui/loading-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { useI18n } from '@/i18n'
import type { ChatEngine, CodexChatMediaInfo, CodexChatMessage, CodexChatToolCall } from '@/lib/api-codex-chat'
import { requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import type { ImageRecord } from '@/types/image'
import type { ChatAvatarSize } from './chat-appearance'
import { ChatErrorChip } from './chat-error-chip'
import { ChatMarkdown } from './chat-markdown'
import { ChatProfileAvatar } from './chat-profile-avatar'

const HISTORY_POLL_MS = 3000
const THUMB_CLASS = 'w-auto rounded-sm object-cover'
const THUMB_SIZE_CLASS = { regular: 'h-28 max-w-[14rem]', large: 'h-40 max-w-[20rem]' } as const
const THUMB_PLACEHOLDER_CLASS = { regular: 'h-28 w-28', large: 'h-40 w-40' } as const

type ThumbSize = keyof typeof THUMB_SIZE_CLASS

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

/** Click opens the lightbox; on PC a short hover shows a larger preview beside it. */
function ChatImageThumb({ image, size, onOpen }: { image: ImageRecord; size: ThumbSize; onOpen: () => void }) {
  const { t } = useI18n()
  const thumbnailUrl = image.thumbnail_url ?? ''
  const isVideo = image.mime_type?.startsWith('video/') === true
  const hoverPreview = useMediaHoverPreview(thumbnailUrl ? { src: thumbnailUrl, fullSrc: isVideo ? null : image.image_url, videoSrc: isVideo ? image.image_url : null } : null)

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control; Button padding/height would crop it */}
      <button
        type="button"
        aria-label={t({ ko: '크게 보기', en: 'View larger' })}
        className="shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onOpen}
        {...hoverPreview.triggerProps}
      >
        {isVideo ? (
          // Videos play muted and looped in place, like the library grid.
          <ImagePreviewMedia image={image} className={cn(THUMB_CLASS, THUMB_SIZE_CLASS[size])} />
        ) : (
          <img src={thumbnailUrl} alt="" loading="lazy" draggable={false} className={cn(THUMB_CLASS, THUMB_SIZE_CLASS[size])} />
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

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-sm bg-surface-high text-muted-foreground', THUMB_PLACEHOLDER_CLASS[size])}>
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
function CodexChatToolMedia({ calls, size = 'regular', media }: { calls: CodexChatToolCall[]; size?: ThumbSize; media?: Record<string, CodexChatMediaInfo> }) {
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

export function CodexChatUserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-high px-3.5 py-2 text-foreground">{content}</div>
    </div>
  )
}

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

/** Who answers in a chat: the thread's profile. */
export type ChatSpeaker = { name: string; avatar: string | null; engine: ChatEngine }

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

export function CodexChatAssistantMessage({ content, toolCalls, status, error, reasoning, streaming = false, largeThumbnails = false, speaker = null, media, avatarSize = 'md' }: {
  content: string
  toolCalls: CodexChatToolCall[]
  status?: CodexChatMessage['status']
  error?: string | null
  /** Live reasoning text of a streaming LLM reply. */
  reasoning?: string
  streaming?: boolean
  largeThumbnails?: boolean
  speaker?: ChatSpeaker | null
  /** Media kind of the images the thread references (videos play inline). */
  media?: Record<string, CodexChatMediaInfo>
  avatarSize?: ChatAvatarSize
}) {
  const { t } = useI18n()
  const avatarBeside = speaker !== null && avatarSize !== 'sm'
  const avatar = speaker ? (
    <ChatProfileAvatar
      name={speaker.name}
      avatar={speaker.avatar}
      engine={speaker.engine}
      size={AVATAR_SIZE[avatarSize]}
      className={avatarSize === 'lg' ? 'size-14 text-lg' : undefined}
    />
  ) : null
  const toolBadge = toolCalls.length > 0 ? <ToolCallsBadge calls={toolCalls} /> : null

  const reply = (
    <div className="min-w-0 flex-1 space-y-2">
      {speaker || toolBadge ? (
        <div className="flex min-h-6 items-center gap-1.5">
          {avatarBeside ? null : avatar}
          {speaker ? <span className="truncate text-xs font-semibold text-muted-foreground">{speaker.name}</span> : null}
          {toolBadge}
        </div>
      ) : null}
      {reasoning ? <ReasoningBlock text={reasoning} active={streaming && !content} /> : null}
      <CodexChatToolMedia calls={toolCalls} size={largeThumbnails ? 'large' : 'regular'} media={media} />
      {content ? <ChatMarkdown text={content} /> : null}
      {streaming ? <ActivityLine toolCalls={toolCalls} /> : null}
      {status === 'interrupted' ? <p className="text-xs text-muted-foreground">{t({ ko: '중단됨', en: 'Stopped' })}</p> : null}
      {status === 'failed' ? <ChatErrorChip error={error ?? null} /> : null}
    </div>
  )

  return avatarBeside ? (
    <div className="flex items-start gap-3">
      {avatar}
      {reply}
    </div>
  ) : reply
}
