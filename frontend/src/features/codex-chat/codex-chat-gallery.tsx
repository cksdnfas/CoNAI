import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { buildChatImageRecord } from './chat-image-record'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, ImageIcon, Search } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useMediaHoverPreview } from '@/components/common/media-hover-preview'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { useI18n } from '@/i18n'
import { getCodexChatThreadMedia, type CodexChatMediaItem } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { ChatReferenceButton, ChatThumbOverlay } from './chat-reference'
import { codexChatMediaQueryKey, useCodexChat } from './codex-chat-context'

type GalleryFilter = 'all' | 'generated' | 'found'

type GalleryEntry = { media: CodexChatMediaItem; image: ImageRecord }

/** SQLite `CURRENT_TIMESTAMP` is UTC without a zone marker. */
function parseServerDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

function toImageRecord(media: CodexChatMediaItem): ImageRecord {
  return buildChatImageRecord(media.compositeHash, undefined, media)
}

function GalleryTile({ entry, showFoundMark, onOpen }: { entry: GalleryEntry; showFoundMark: boolean; onOpen: () => void }) {
  const { t } = useI18n()
  const { media, image } = entry
  const thumbnailUrl = image.thumbnail_url ?? ''
  const isVideo = media.mimeType?.startsWith('video/') === true
  const hoverPreview = useMediaHoverPreview(thumbnailUrl ? { src: thumbnailUrl, fullSrc: isVideo ? null : image.image_url, videoSrc: isVideo ? image.image_url : null } : null)
  const aspectRatio = media.width && media.height ? `${media.width} / ${media.height}` : undefined

  return (
    <ChatThumbOverlay className="mb-1 break-inside-avoid" actions={<ChatReferenceButton compositeHash={media.compositeHash} mimeType={media.mimeType} size="icon-xs" />}>
      {/* eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control; Button padding/height would crop it */}
      <button
        type="button"
        aria-label={t({ ko: '크게 보기', en: 'View larger' })}
        className="relative block w-full cursor-zoom-in overflow-hidden rounded-sm bg-surface-high outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        style={{ aspectRatio }}
        onClick={onOpen}
        {...hoverPreview.triggerProps}
      >
        {isVideo ? (
          <ImagePreviewMedia image={image} className="block h-full w-full object-cover" />
        ) : (
          <img src={thumbnailUrl} alt="" loading="lazy" draggable={false} className="block h-full w-full object-cover" />
        )}
        {showFoundMark && media.source === 'found' ? (
          <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-backdrop text-white">
            <Search className="size-3" />
          </span>
        ) : null}
      </button>
      {hoverPreview.preview}
    </ChatThumbOverlay>
  )
}

/** Every image of one chat, newest first in day groups, split into generated / looked-up tabs. */
export function CodexChatGallery({ threadId, columns }: { threadId: number; columns: 'narrow' | 'wide' }) {
  const { t, formatDate, formatNumber } = useI18n()
  const chat = useCodexChat()
  const [filter, setFilter] = useState<GalleryFilter>('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const { canViewImages } = useImagePermissions()
  const mediaQuery = useQuery({ enabled: canViewImages, queryKey: codexChatMediaQueryKey(threadId), queryFn: () => getCodexChatThreadMedia(threadId) })

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

  const sections = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const groups: Array<{ key: string; label: string; items: Array<{ entry: GalleryEntry; index: number }> }> = []
    entries.forEach((entry, index) => {
      const date = parseServerDate(entry.media.createdDate)
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      let group = groups.at(-1)
      if (!group || group.key !== key) {
        const label = date.toDateString() === today.toDateString()
          ? t({ ko: '오늘', en: 'Today' })
          : date.toDateString() === yesterday.toDateString()
            ? t({ ko: '어제', en: 'Yesterday' })
            : formatDate(date, date.getFullYear() === today.getFullYear() ? { month: 'long', day: 'numeric' } : { dateStyle: 'medium' })
        group = { key, label, items: [] }
        groups.push(group)
      }
      group.items.push({ entry, index })
    })
    return groups
  }, [entries, formatDate, t])

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
          onChange={(value) => {
            setFilter(value as GalleryFilter)
            setLightboxIndex(null)
          }}
          ariaLabel={t({ ko: '이미지 분류', en: 'Image filter' })}
          items={[
            { value: 'all', label: tabLabel(t({ ko: '전체', en: 'All' }), counts.all) },
            { value: 'generated', label: tabLabel(t({ ko: '생성', en: 'Generated' }), counts.generated) },
            { value: 'found', label: tabLabel(t({ ko: '찾아본', en: 'Looked up' }), counts.found) },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {mediaQuery.isPending ? (
          <LoadingState variant="inline" />
        ) : mediaQuery.isError ? (
          <ErrorState title={t({ ko: '이미지를 불러오지 못했어.', en: 'Could not load images.' })} />
        ) : entries.length === 0 ? (
          <EmptyState className="bg-transparent" icon={ImageIcon} title={t({ ko: '아직 이미지가 없어.', en: 'No images yet.' })} />
        ) : (
          sections.map((section) => (
            <section key={section.key}>
              <h3 className="pb-2 pt-3 text-xs font-medium text-muted-foreground">{section.label}</h3>
              <div className={cn('gap-1', columns === 'wide' ? 'columns-3 sm:columns-4 lg:columns-5' : 'columns-3')}>
                {section.items.map(({ entry, index }) => (
                  <GalleryTile key={entry.media.compositeHash} entry={entry} showFoundMark={filter === 'all'} onOpen={() => setLightboxIndex(index)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <MediaLightbox
        items={lightboxItems}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        renderActions={(item, index) => {
          const messageId = entries[index]?.media.messageId
          return (
            <>
              <ChatReferenceButton compositeHash={item.composite_hash} mimeType={item.mime_type ?? null} />
              {messageId !== undefined && chat ? (
                <IconButton
                  variant="overlay"
                  label={t({ ko: '메시지로 이동', en: 'Go to message' })}
                  onClick={() => {
                    setLightboxIndex(null)
                    chat.focusMessage(messageId)
                  }}
                >
                  <CornerDownLeft />
                </IconButton>
              ) : null}
            </>
          )
        }}
      />
    </div>
  )
}
