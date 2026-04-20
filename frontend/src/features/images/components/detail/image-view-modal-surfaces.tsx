import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getImage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { ImageDetailMedia } from './image-detail-media'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { ImageViewModeSwitcher, type ImageViewModalMode } from './image-view-modal-actions'
import { getDownloadName, getImageDetailDownloadUrl, getImageDetailRenderUrl } from './image-detail-utils'

interface ImageViewSurfaceContentProps {
  compositeHash: string
  renderHeader: (controls: ImageDetailViewHeaderControls) => ReactNode
}

interface ImageViewMinimalContentProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  canViewPrevious: boolean
  canViewNext: boolean
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
}

/** Render one divider-led side panel shell inside the image view overlay. */
function ImageViewSidePanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-sm border border-border/80 bg-surface-container/25', className)}>{children}</div>
}

/** Load the active image detail payload used by modal content surfaces. */
function useImageViewSurfaceDetail(compositeHash: string) {
  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash),
    enabled: Boolean(compositeHash),
  })

  const image = imageQuery.data

  return {
    imageQuery,
    image,
    renderUrl: getImageDetailRenderUrl(image),
    downloadUrl: getImageDetailDownloadUrl(image),
    downloadName: getDownloadName(image?.original_file_path, image?.composite_hash),
  }
}

/** Render the medium modal surface with a large preview and prompt summary cards. */
export function ImageViewMediumContent({ compositeHash, renderHeader }: ImageViewSurfaceContentProps) {
  const { imageQuery, image, renderUrl, downloadUrl, downloadName } = useImageViewSurfaceDetail(compositeHash)
  const positivePrompt = image?.ai_metadata?.prompts?.prompt || image?.ai_metadata?.raw_nai_parameters?.prompt || '—'
  const negativePrompt = image?.ai_metadata?.prompts?.negative_prompt || image?.ai_metadata?.raw_nai_parameters?.uc || '—'
  const characterPrompt = image?.ai_metadata?.prompts?.character_prompt_text
    || image?.ai_metadata?.prompts?.characters?.filter(Boolean).join(', ')
    || image?.ai_metadata?.raw_nai_parameters?.v4_prompt?.caption?.char_captions
      ?.map((item) => item.char_caption)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(', ')
    || '—'

  const controls: ImageDetailViewHeaderControls = {
    downloadName,
    downloadUrl,
    image,
    isRefreshing: imageQuery.isFetching,
    refresh: () => {
      void imageQuery.refetch()
    },
  }

  return (
    <div className="space-y-6 xl:flex xl:min-h-0 xl:flex-col xl:space-y-0">
      <div className="xl:pb-5">{renderHeader(controls)}</div>

      {imageQuery.isLoading ? (
        <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.3fr)_360px]">
          <ImageViewSidePanel>
            <Skeleton className="min-h-[540px] w-full rounded-none xl:h-full xl:min-h-0" />
          </ImageViewSidePanel>
          <ImageViewSidePanel className="divide-y divide-border/70">
            <Skeleton className="h-24 w-full rounded-none" />
            <Skeleton className="h-20 w-full rounded-none" />
            <Skeleton className="h-20 w-full rounded-none" />
          </ImageViewSidePanel>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>이미지 상세를 불러오지 못했어</AlertTitle>
          <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.3fr)_360px] xl:items-start">
          <ImageViewSidePanel className="xl:min-h-0 xl:h-full">
            <div className="flex h-[max(540px,72vh)] items-center justify-center bg-black/20 xl:h-full xl:min-h-0">
              <ImageDetailMedia image={image} renderUrl={renderUrl} className="max-h-[72vh] max-w-full w-auto object-contain xl:max-h-full" />
            </div>
          </ImageViewSidePanel>

          <ImageViewSidePanel className="divide-y divide-border/70 text-sm text-muted-foreground">
            <PromptField label="Positive" value={positivePrompt} />
            <PromptField label="Negative" value={negativePrompt} />
            <PromptField label="Character" value={characterPrompt} />
          </ImageViewSidePanel>
        </div>
      ) : null}
    </div>
  )
}

/** Render the minimal modal surface as an immersive media viewer. */
export function ImageViewMinimalContent({
  compositeHash,
  activeIndex,
  totalCount,
  viewMode,
  onChangeViewMode,
  canViewPrevious,
  canViewNext,
  onClose,
  onViewPrevious,
  onViewNext,
}: ImageViewMinimalContentProps) {
  const navigate = useNavigate()
  const { imageQuery, image, renderUrl, downloadUrl, downloadName } = useImageViewSurfaceDetail(compositeHash)
  const showCounter = totalCount > 1 && activeIndex >= 0
  const overlayButtonClassName = 'border-white/14 bg-black/42 text-white hover:bg-black/60 hover:text-white'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 보기"
      className="relative h-full w-full bg-black"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="absolute inset-x-0 top-0 z-[92] bg-gradient-to-b from-black/82 via-black/38 to-transparent px-4 pb-10 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="icon-sm" variant="secondary" className={overlayButtonClassName} onClick={onClose} aria-label="닫기" title="닫기">
                <X className="h-4 w-4" />
              </Button>
              <Button size="icon-sm" variant="outline" className={overlayButtonClassName} onClick={onViewPrevious} disabled={!canViewPrevious} aria-label="이전 이미지" title="이전 이미지">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="icon-sm" variant="outline" className={overlayButtonClassName} onClick={onViewNext} disabled={!canViewNext} aria-label="다음 이미지" title="다음 이미지">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {showCounter ? <div className="px-2 text-xs text-white/72">{activeIndex + 1} / {totalCount}</div> : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{downloadName}</p>
              <p className="truncate text-[11px] text-white/60">{image?.mime_type || image?.file_type || 'image'}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ImageViewModeSwitcher viewMode={viewMode} onChangeViewMode={onChangeViewMode} tone="overlay" />
            <Button
              size="icon-sm"
              variant="outline"
              className={overlayButtonClassName}
              onClick={() => {
                navigate(`/images/${compositeHash}`)
                onClose()
              }}
              aria-label="상세 페이지 열기"
              title="상세 페이지"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            {downloadUrl ? (
              <ImageDownloadTriggerButton
                image={image}
                size="icon-sm"
                variant="outline"
                className={overlayButtonClassName}
                ariaLabel="다운로드"
                title="다운로드"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex h-full items-center justify-center px-4 py-20">
        {imageQuery.isLoading ? <Skeleton className="h-[68vh] w-full max-w-5xl rounded-sm bg-white/8" /> : null}
        {imageQuery.isError ? (
          <Alert variant="destructive" className="mx-auto max-w-xl">
            <AlertTitle>이미지를 불러오지 못했어</AlertTitle>
            <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : '알 수 없는 오류가 발생했어.'}</AlertDescription>
          </Alert>
        ) : null}
        {!imageQuery.isLoading && !imageQuery.isError && image ? (
          <ImageDetailMedia image={image} renderUrl={renderUrl} className="max-h-[calc(100vh-8rem)] max-w-full w-auto object-contain" />
        ) : null}
      </div>
    </div>
  )
}

/** Render a labeled prompt block inside the medium surface sidebar. */
function PromptField({ label, value }: { label: string; value: string }) {
  return (
    <section className="px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={cn('mt-2 whitespace-pre-wrap break-words text-sm text-foreground')}>{value}</p>
    </section>
  )
}
