import { useQueries } from '@tanstack/react-query'
import { ImageOff, X } from 'lucide-react'
import { MediaLibraryPicker, type MediaLibraryPickerProps } from '@/components/media/media-library-picker'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import type { ChatMediaAttachment } from '@/lib/api-codex-chat'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'

/** Chat supplies attachment wording and permits clearing all attachments; browsing is shared app-wide. */
export function ChatMediaPicker(props: Pick<MediaLibraryPickerProps, 'initial' | 'maxCount' | 'onPick' | 'onClose'>) {
  const { t } = useI18n()
  return <MediaLibraryPicker {...props} allowEmpty
    applyLabel={t({ ko: '첨부 적용', en: 'Apply attachments' })}
    note={t({ ko: '원본을 참조해 첨부해. 이미지·영상·움짤을 보려면 이미지 보기·프레임 보기 도구와 비전 모델이 필요하고, 오디오 내용 분석은 지원하지 않아.', en: 'Attachments reference the originals. Seeing images, videos and animations requires the image/frame tools and a vision model; audio analysis is not supported.' })}
  />
}

/** Resolve current metadata/visibility for thumbnails; removed originals stay recognizable by name. */
export function ChatMediaAttachments({ items = [], onRemove }: {
  items?: ChatMediaAttachment[]; onRemove?: (hash: string) => void
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const viewer = useImageViewModal()
  const queries = useQueries({ queries: items.map((item) => ({ enabled: canViewImages, queryKey: getImageDetailQueryKey(item.compositeHash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(item.compositeHash, { signal }), retry: false })) })
  const images = queries.flatMap((query) => query.data ? [query.data] : [])
  const safety = useImageFeedSafety({ items: images, enabled: items.length > 0 })
  const visible = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  if (!items.length) return null
  return <div className={cn('flex flex-wrap gap-2', onRemove ? 'mb-2' : 'mt-2 justify-end')}>
    {items.map((item) => {
      const image: ImageRecord | undefined = canViewImages ? visible.get(item.compositeHash) : undefined
      return <div key={item.compositeHash} className="relative flex w-24 flex-col overflow-hidden rounded-sm bg-surface-high">
        <Button variant="ghost" className="h-20 w-full overflow-hidden p-0" disabled={!image || !viewer} aria-label={item.name} onClick={() => viewer?.openImageView({ compositeHash: item.compositeHash, sourceItems: image ? [image] : [] })}>
          {image ? <img src={buildApiUrl(`/api/images/${encodeURIComponent(item.compositeHash)}/thumbnail`)} alt={item.name} loading="lazy" className={cn('size-full object-cover', safety.shouldBlurItemPreview(image) && 'blur-md')} /> : <ImageOff className="size-5 text-muted-foreground" />}
        </Button>
        <Tip content={item.name}><span className="truncate px-1 py-1 text-2xs">{item.name}</span></Tip>
        {onRemove ? <IconButton variant="secondary" size="icon-xs" className="absolute right-0.5 top-0.5" label={t({ ko: '첨부 빼기', en: 'Remove attachment' })} onClick={() => onRemove(item.compositeHash)}><X /></IconButton> : null}
      </div>
    })}
  </div>
}
