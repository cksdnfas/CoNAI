import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { chatGenerationPollInterval } from '@/features/runtime-events/chat-generation-query-updates'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { buildChatImageRecord } from './chat-image-record'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownLeft, ImageIcon, Search } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useI18n } from '@/i18n'
import { getCodexChatThreadMedia, type CodexChatMediaItem } from '@/lib/api-codex-chat'
import type { ImageRecord } from '@/types/image'
import { ChatImageListActionsContext, ChatReferenceButton } from './chat-reference'
import { refetchActiveChatQuery } from './chat-query-refresh'
import { codexChatMediaQueryKey, useCodexChat } from './codex-chat-context'
import { parseServerDate } from '@/lib/server-time'

type GalleryFilter = 'all' | 'generated' | 'found'

type GalleryEntry = { media: CodexChatMediaItem; image: ImageRecord }

function toImageRecord(media: CodexChatMediaItem): ImageRecord {
  return buildChatImageRecord(media.compositeHash, undefined, media)
}

/** Every image of one chat, newest first, in the shared virtualized media surface. */
export function CodexChatGallery({ threadId, columns, pendingJobs }: { threadId: number; columns: 'narrow' | 'wide'; pendingJobs: number }) {
  const { t, formatDate, formatNumber } = useI18n()
  const chat = useCodexChat()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<GalleryFilter>('all')
  const { canViewImages } = useImagePermissions()
  const { status: streamStatus } = useRuntimeEventStream()
  const mediaQuery = useQuery({ refetchInterval: (query) => pendingJobs > 0 || query.state.data?.some((item) => item.postprocessStatus === 'pending') ? chatGenerationPollInterval(streamStatus) : false, enabled: canViewImages, queryKey: codexChatMediaQueryKey(threadId), queryFn: () => getCodexChatThreadMedia(threadId) })
  const previousJobs = useRef({ threadId, count: pendingJobs })
  useEffect(() => {
    // Without SSE, a final job can finish between polling ticks; read its result before stopping the timer.
    if (canViewImages && streamStatus !== 'live' && previousJobs.current.threadId === threadId && previousJobs.current.count > pendingJobs) void refetchActiveChatQuery(queryClient, codexChatMediaQueryKey(threadId))
    previousJobs.current = { threadId, count: pendingJobs }
  }, [canViewImages, streamStatus, threadId, pendingJobs, queryClient])

  const allEntries = useMemo<GalleryEntry[]>(
    () => (mediaQuery.data ?? []).map((media) => ({ media, image: toImageRecord(media) })),
    [mediaQuery.data],
  )
  const counts = {
    all: allEntries.length,
    generated: allEntries.filter((entry) => entry.media.source === 'generated').length,
    found: allEntries.filter((entry) => entry.media.source === 'found').length,
  }
  const entries = useMemo(
    () => (filter === 'all' ? allEntries : allEntries.filter((entry) => entry.media.source === filter)),
    [allEntries, filter],
  )
  const lightboxItems = useMemo(() => entries.map((entry) => entry.image), [entries])

  const mediaByHash = new Map(entries.map((entry) => [entry.media.compositeHash, entry.media]))

  const tabLabel = (label: string, count: number) => (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(count)}</span>
    </span>
  )

  if (!canViewImages) return <ImagePermissionNotice />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-2">
        <SegmentedTabBar
          size="xs"
          value={filter}
          onChange={(value) => setFilter(value as GalleryFilter)}
          ariaLabel={t({ ko: '이미지 분류', en: 'Image filter' })}
          items={[
            { value: 'all', label: tabLabel(t({ ko: '전체', en: 'All' }), counts.all) },
            { value: 'generated', label: tabLabel(t({ ko: '생성', en: 'Generated' }), counts.generated) },
            { value: 'found', label: tabLabel(t({ ko: '찾아본', en: 'Looked up' }), counts.found) },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 px-3 pb-4">
        {mediaQuery.isPending ? (
          <LoadingState variant="inline" />
        ) : mediaQuery.isError ? (
          <ErrorState title={t({ ko: '이미지를 불러오지 못했어.', en: 'Could not load images.' })} />
        ) : entries.length === 0 ? (
          <EmptyState icon={ImageIcon} title={t({ ko: '아직 이미지가 없어', en: 'No images yet' })} />
        ) : (
          <ChatImageListActionsContext.Provider value={true}><ImageList
            items={lightboxItems}
            resetKey={`${threadId}:${filter}`}
            layout="masonry"
            scrollMode="container"
            viewportHeight="100%"
            preferredColumnCount={columns === 'wide' ? 5 : 3}
            activationMode="modal"
            selectable={false}
            showDefaultQuickActions={false}
            renderItemOverlay={(image) => {
              const media = image.composite_hash ? mediaByHash.get(image.composite_hash) : undefined
              return <div className="flex items-center gap-1">
                <ChatReferenceButton compositeHash={image.composite_hash} mimeType={image.mime_type ?? null} size="icon-xs" />
                {media && chat ? <IconButton variant="overlay" size="icon-xs" label={t({ ko: '메시지로 이동', en: 'Go to message' })} onClick={(event) => { event.stopPropagation(); chat.focusMessage(media.messageId) }}><CornerDownLeft /></IconButton> : null}
              </div>
            }}
            renderItemPersistentOverlay={(image) => {
              const media = image.composite_hash ? mediaByHash.get(image.composite_hash) : undefined
              return media ? <Badge variant="overlay" size="xs">
                {filter === 'all' && media.source === 'found' ? <Search className="size-3" /> : null}
                {formatDate(parseServerDate(media.createdDate))}
              </Badge> : null
            }}
          /></ChatImageListActionsContext.Provider>
        )}
      </div>

    </div>
  )
}
