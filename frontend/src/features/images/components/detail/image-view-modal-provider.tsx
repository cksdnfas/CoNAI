import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getImage, getImagesBatch } from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import { ImageDetailView, type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { ImageDetailMedia } from './image-detail-media'
import { ImageViewThumbnailStrip } from './image-view-thumbnail-strip'
import { ImageViewModalContext, type ImageViewModalOpenInput } from './image-view-modal-context'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { getDownloadName, getImageDetailDownloadUrl, getImageDetailRenderUrl } from './image-detail-utils'

interface ImageViewModalState {
  compositeHash: string | null
  compositeHashes: string[]
}

type ImageViewModalMode = 'full' | 'medium' | 'minimal'

const IMAGE_VIEW_MODAL_MODE_STORAGE_KEY = 'conai:image-view-modal:mode'

function loadImageViewModalMode(): ImageViewModalMode {
  if (typeof window === 'undefined') {
    return 'full'
  }

  const savedValue = window.localStorage.getItem(IMAGE_VIEW_MODAL_MODE_STORAGE_KEY)
  return savedValue === 'medium' || savedValue === 'minimal' ? savedValue : 'full'
}

function persistImageViewModalMode(mode: ImageViewModalMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_VIEW_MODAL_MODE_STORAGE_KEY, mode)
}

/** Provide a global image view modal for app-shell image browsing flows. */
export function ImageViewModalProvider({ children }: PropsWithChildren) {
  const [modalState, setModalState] = useState<ImageViewModalState>({
    compositeHash: null,
    compositeHashes: [],
  })
  const [viewMode, setViewMode] = useState<ImageViewModalMode>(() => loadImageViewModalMode())

  const activeIndex = useMemo(() => {
    if (!modalState.compositeHash) {
      return -1
    }

    return modalState.compositeHashes.indexOf(modalState.compositeHash)
  }, [modalState.compositeHash, modalState.compositeHashes])

  const canViewPrevious = activeIndex > 0
  const canViewNext = activeIndex >= 0 && activeIndex < modalState.compositeHashes.length - 1

  const thumbnailStripQuery = useQuery({
    queryKey: ['image-view-thumbnail-strip', modalState.compositeHashes],
    queryFn: () => getImagesBatch(modalState.compositeHashes),
    enabled: modalState.compositeHashes.length > 0,
    staleTime: 60_000,
  })

  /** Open the image view modal with an optional ordered navigation context. */
  const openImageView = useCallback((input: ImageViewModalOpenInput) => {
    const compositeHashes = Array.from(new Set((input.compositeHashes ?? []).filter((value) => typeof value === 'string' && value.length > 0)))
    const nextCompositeHashes = compositeHashes.includes(input.compositeHash)
      ? compositeHashes
      : [input.compositeHash, ...compositeHashes]

    setModalState({
      compositeHash: input.compositeHash,
      compositeHashes: nextCompositeHashes,
    })
  }, [])

  const closeImageView = useCallback(() => {
    setModalState({
      compositeHash: null,
      compositeHashes: [],
    })
  }, [])

  const handleViewModeChange = useCallback((nextMode: ImageViewModalMode) => {
    setViewMode(nextMode)
    persistImageViewModalMode(nextMode)
  }, [])

  /** Move to the previous image within the active modal navigation context. */
  const viewPreviousImage = useCallback(() => {
    setModalState((current) => {
      if (!current.compositeHash) {
        return current
      }

      const currentIndex = current.compositeHashes.indexOf(current.compositeHash)
      if (currentIndex <= 0) {
        return current
      }

      return {
        ...current,
        compositeHash: current.compositeHashes[currentIndex - 1],
      }
    })
  }, [])

  /** Move to the next image within the active modal navigation context. */
  const viewNextImage = useCallback(() => {
    setModalState((current) => {
      if (!current.compositeHash) {
        return current
      }

      const currentIndex = current.compositeHashes.indexOf(current.compositeHash)
      if (currentIndex < 0 || currentIndex >= current.compositeHashes.length - 1) {
        return current
      }

      return {
        ...current,
        compositeHash: current.compositeHashes[currentIndex + 1],
      }
    })
  }, [])

  useEffect(() => {
    if (!modalState.compositeHash) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImageView()
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        viewPreviousImage()
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        viewNextImage()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeImageView, modalState.compositeHash, viewNextImage, viewPreviousImage])

  const thumbnailStripItems = thumbnailStripQuery.data ?? []
  const thumbnailStripCompositeHashes = useMemo(
    () => thumbnailStripItems.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [thumbnailStripItems],
  )

  const contextValue = useMemo(
    () => ({
      activeCompositeHash: modalState.compositeHash,
      activeCompositeHashes: modalState.compositeHashes,
      activeIndex,
      canViewPrevious,
      canViewNext,
      openImageView,
      closeImageView,
      viewPreviousImage,
      viewNextImage,
    }),
    [activeIndex, canViewNext, canViewPrevious, closeImageView, modalState.compositeHash, modalState.compositeHashes, openImageView, viewNextImage, viewPreviousImage],
  )

  return (
    <ImageViewModalContext.Provider value={contextValue}>
      {children}
      {modalState.compositeHash ? (
        <ImageViewModal
          compositeHash={modalState.compositeHash}
          activeIndex={activeIndex}
          totalCount={modalState.compositeHashes.length}
          thumbnailStripItems={thumbnailStripItems}
          thumbnailStripCompositeHashes={thumbnailStripCompositeHashes}
          viewMode={viewMode}
          onChangeViewMode={handleViewModeChange}
          canViewPrevious={canViewPrevious}
          canViewNext={canViewNext}
          onClose={closeImageView}
          onViewPrevious={viewPreviousImage}
          onViewNext={viewNextImage}
          onSelectImage={openImageView}
        />
      ) : null}
    </ImageViewModalContext.Provider>
  )
}

interface ImageViewModalProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
  thumbnailStripItems: Awaited<ReturnType<typeof getImagesBatch>>
  thumbnailStripCompositeHashes: string[]
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  canViewPrevious: boolean
  canViewNext: boolean
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
  onSelectImage: (input: ImageViewModalOpenInput) => void
}

/** Render the shared image detail view inside a global modal shell. */
function ImageViewModal({
  compositeHash,
  activeIndex,
  totalCount,
  thumbnailStripItems,
  thumbnailStripCompositeHashes,
  viewMode,
  onChangeViewMode,
  canViewPrevious,
  canViewNext,
  onClose,
  onViewPrevious,
  onViewNext,
  onSelectImage,
}: ImageViewModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mobileActionsRef = useRef<HTMLDivElement | null>(null)
  const isDesktopModalLayout = useMinWidth(1280)
  const [mobileActionsHeight, setMobileActionsHeight] = useState(0)

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [compositeHash])

  useEffect(() => {
    if (isDesktopModalLayout || viewMode === 'minimal') {
      setMobileActionsHeight(0)
      return
    }

    const mobileActionsElement = mobileActionsRef.current
    if (!mobileActionsElement) {
      setMobileActionsHeight(0)
      return
    }

    const updateMobileActionsHeight = () => {
      setMobileActionsHeight(mobileActionsElement.getBoundingClientRect().height)
    }

    updateMobileActionsHeight()

    const resizeObserver = new ResizeObserver(() => {
      updateMobileActionsHeight()
    })
    resizeObserver.observe(mobileActionsElement)
    window.addEventListener('resize', updateMobileActionsHeight)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMobileActionsHeight)
    }
  }, [isDesktopModalLayout, compositeHash, viewMode])

  const showsThumbnailStrip = viewMode === 'full' && thumbnailStripItems.length > 1

  return createPortal(
    <div className={cn('fixed inset-0 z-[90] bg-black/72', viewMode === 'minimal' ? 'p-0' : 'p-4 md:p-6')} onMouseDown={onClose}>
      {canViewPrevious ? (
        <button
          type="button"
          className={cn(
            'absolute left-0 top-1/2 z-[91] hidden -translate-y-1/2 items-center justify-start text-white/72 transition hover:text-white xl:flex',
            viewMode === 'minimal'
              ? 'h-48 w-20 bg-gradient-to-r from-black/46 via-black/16 to-transparent pl-4'
              : 'h-40 w-16 bg-gradient-to-r from-black/34 via-black/12 to-transparent pl-3',
          )}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onViewPrevious}
          aria-label="이전 이미지"
        >
          <span className={cn(
            'flex items-center justify-center rounded-full border border-white/18 bg-black/20 backdrop-blur-sm',
            viewMode === 'minimal' ? 'h-14 w-14' : 'h-12 w-12',
          )}>
            <ChevronLeft className={viewMode === 'minimal' ? 'h-7 w-7' : 'h-6 w-6'} />
          </span>
        </button>
      ) : null}

      {canViewNext ? (
        <button
          type="button"
          className={cn(
            'absolute right-0 top-1/2 z-[91] hidden -translate-y-1/2 items-center justify-end text-white/72 transition hover:text-white xl:flex',
            viewMode === 'minimal'
              ? 'h-48 w-20 bg-gradient-to-l from-black/46 via-black/16 to-transparent pr-4'
              : 'h-40 w-16 bg-gradient-to-l from-black/34 via-black/12 to-transparent pr-3',
          )}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onViewNext}
          aria-label="다음 이미지"
        >
          <span className={cn(
            'flex items-center justify-center rounded-full border border-white/18 bg-black/20 backdrop-blur-sm',
            viewMode === 'minimal' ? 'h-14 w-14' : 'h-12 w-12',
          )}>
            <ChevronRight className={viewMode === 'minimal' ? 'h-7 w-7' : 'h-6 w-6'} />
          </span>
        </button>
      ) : null}

      {viewMode === 'minimal' ? (
        <ImageViewMinimalContent
          compositeHash={compositeHash}
          activeIndex={activeIndex}
          totalCount={totalCount}
          viewMode={viewMode}
          onChangeViewMode={onChangeViewMode}
          canViewPrevious={canViewPrevious}
          canViewNext={canViewNext}
          onClose={onClose}
          onViewPrevious={onViewPrevious}
          onViewNext={onViewNext}
        />
      ) : (
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label="이미지 보기"
          className="scrollbar-stable-pane mx-auto max-h-full w-full max-w-[1680px] overflow-y-auto rounded-sm border border-border bg-background p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:p-6 xl:flex xl:h-[calc(100vh-3rem)] xl:flex-col xl:overflow-hidden xl:pb-6"
          style={
            isDesktopModalLayout
              ? undefined
              : { paddingBottom: `calc(env(safe-area-inset-bottom) + ${Math.ceil(mobileActionsHeight) + 16}px)` }
          }
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="xl:min-h-0 xl:flex-1">
            {viewMode === 'full' ? (
              <ImageDetailView
                compositeHash={compositeHash}
                presentation="modal"
                renderHeader={(controls) => (
                  <ImageViewModalActions
                    compositeHash={compositeHash}
                    activeIndex={activeIndex}
                    totalCount={totalCount}
                    viewMode={viewMode}
                    onChangeViewMode={onChangeViewMode}
                    canViewPrevious={canViewPrevious}
                    canViewNext={canViewNext}
                    controls={controls}
                    mobileActionsRef={mobileActionsRef}
                    onClose={onClose}
                    onViewPrevious={onViewPrevious}
                    onViewNext={onViewNext}
                  />
                )}
              />
            ) : (
              <ImageViewMediumContent
                compositeHash={compositeHash}
                renderHeader={(controls) => (
                  <ImageViewModalActions
                    compositeHash={compositeHash}
                    activeIndex={activeIndex}
                    totalCount={totalCount}
                    viewMode={viewMode}
                    onChangeViewMode={onChangeViewMode}
                    canViewPrevious={canViewPrevious}
                    canViewNext={canViewNext}
                    controls={controls}
                    mobileActionsRef={mobileActionsRef}
                    onClose={onClose}
                    onViewPrevious={onViewPrevious}
                    onViewNext={onViewNext}
                  />
                )}
              />
            )}
          </div>

          {showsThumbnailStrip ? (
            <div className="mt-4 border-t border-border/70 pt-3 xl:mt-3 xl:shrink-0 xl:pt-3">
              <ImageViewThumbnailStrip
                items={thumbnailStripItems}
                activeCompositeHash={compositeHash}
                onSelect={(nextCompositeHash) =>
                  onSelectImage({
                    compositeHash: nextCompositeHash,
                    compositeHashes: thumbnailStripCompositeHashes,
                  })
                }
              />
            </div>
          ) : null}
        </div>
      )}
    </div>,
    document.body,
  )
}

interface ImageViewSurfaceContentProps {
  compositeHash: string
  renderHeader: (controls: ImageDetailViewHeaderControls) => ReactNode
}

function ImageViewMediumContent({ compositeHash, renderHeader }: ImageViewSurfaceContentProps) {
  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash),
    enabled: Boolean(compositeHash),
  })

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadUrl = getImageDetailDownloadUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)
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
          <Skeleton className="min-h-[540px] w-full rounded-sm" />
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-sm" />
            <Skeleton className="h-20 w-full rounded-sm" />
            <Skeleton className="h-20 w-full rounded-sm" />
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>이미지 상세를 불러오지 못했어</AlertTitle>
          <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.3fr)_360px] xl:items-start">
          <div className="overflow-hidden rounded-sm bg-surface-container shadow-[0_0_40px_rgba(14,14,14,0.22)] xl:min-h-0 xl:h-full">
            <div className="flex min-h-[540px] items-center justify-center bg-surface-lowest xl:h-full xl:min-h-0">
              <ImageDetailMedia image={image} renderUrl={renderUrl} className="max-h-[72vh] w-full object-contain xl:max-h-full" />
            </div>
          </div>

          <div className="space-y-3 rounded-sm border border-border bg-surface-container p-4 text-sm text-muted-foreground">
            <PromptField label="Positive" value={positivePrompt} />
            <PromptField label="Negative" value={negativePrompt} />
            <PromptField label="Character" value={characterPrompt} />
          </div>
        </div>
      ) : null}
    </div>
  )
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

function ImageViewMinimalContent({
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
  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash),
    enabled: Boolean(compositeHash),
  })

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadUrl = getImageDetailDownloadUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)
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
              <Button size="icon-sm" variant="outline" className={overlayButtonClassName} asChild aria-label="다운로드" title="다운로드">
                <a href={downloadUrl} download={downloadName} aria-label="다운로드" title="다운로드">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
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
          <ImageDetailMedia image={image} renderUrl={renderUrl} className="max-h-[calc(100vh-8rem)] w-full max-w-full object-contain" />
        ) : null}
      </div>
    </div>
  )
}

function PromptField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-surface-lowest px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em]">{label}</p>
      <p className={cn('mt-2 whitespace-pre-wrap break-words text-sm text-foreground')}>{value}</p>
    </div>
  )
}

function ImageViewModeSwitcher({
  viewMode,
  onChangeViewMode,
  tone = 'surface',
}: {
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  tone?: 'surface' | 'overlay'
}) {
  return (
    <SegmentedControl
      value={viewMode}
      items={[
        { value: 'full', label: 'L' },
        { value: 'medium', label: 'M' },
        { value: 'minimal', label: 'S' },
      ]}
      onChange={(nextMode) => onChangeViewMode(nextMode as ImageViewModalMode)}
      size="xs"
      className={tone === 'overlay' ? 'border-white/12 bg-black/36 text-white backdrop-blur-sm' : undefined}
    />
  )
}

interface ImageViewModalActionsProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  canViewPrevious: boolean
  canViewNext: boolean
  controls: ImageDetailViewHeaderControls
  mobileActionsRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
}

/** Render modal-specific image detail actions without changing the shared detail body. */
function ImageViewModalActions({
  compositeHash,
  activeIndex,
  totalCount,
  viewMode,
  onChangeViewMode,
  canViewPrevious,
  canViewNext,
  controls,
  mobileActionsRef,
  onClose,
  onViewPrevious,
  onViewNext,
}: ImageViewModalActionsProps) {
  const navigate = useNavigate()
  const showCounter = totalCount > 1 && activeIndex >= 0

  const openDetailPage = () => {
    navigate(`/images/${compositeHash}`)
    onClose()
  }

  const navigationButtons = (
    <>
      <Button size="icon-sm" variant="secondary" onClick={onClose} aria-label="닫기" title="닫기">
        <X className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onViewPrevious} disabled={!canViewPrevious} aria-label="이전 이미지" title="이전 이미지">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onViewNext} disabled={!canViewNext} aria-label="다음 이미지" title="다음 이미지">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {showCounter ? <div className="px-2 text-xs text-muted-foreground">{activeIndex + 1} / {totalCount}</div> : null}
      <Button size="icon-sm" variant="outline" onClick={openDetailPage} aria-label="상세 페이지 열기" title="상세 페이지">
        <ExternalLink className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={controls.refresh} disabled={controls.isRefreshing} aria-label="새로고침" title="새로고침">
        <RefreshCcw className={controls.isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
    </>
  )

  const groupAssignButton = <ImageGroupAssignAction image={controls.image} />
  const modeSwitcher = <ImageViewModeSwitcher viewMode={viewMode} onChangeViewMode={onChangeViewMode} />

  const downloadButton = controls.downloadUrl ? (
    <Button size="icon-sm" asChild aria-label="다운로드" title="다운로드">
      <a href={controls.downloadUrl} download={controls.downloadName} aria-label="다운로드" title="다운로드">
        <Download className="h-4 w-4" />
      </a>
    </Button>
  ) : null

  return (
    <>
      <div className="hidden xl:flex xl:flex-wrap xl:items-center xl:justify-between xl:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {navigationButtons}
          {modeSwitcher}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImageEditAction image={controls.image} />
          {groupAssignButton}
          {downloadButton}
        </div>
      </div>

      <div
        ref={mobileActionsRef}
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[92] md:inset-x-6 xl:hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rounded-sm border border-border bg-background/96 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {navigationButtons}
              <ImageEditAction image={controls.image} />
              {groupAssignButton}
              {downloadButton}
            </div>
            {modeSwitcher}
          </div>
        </div>
      </div>
    </>
  )
}
