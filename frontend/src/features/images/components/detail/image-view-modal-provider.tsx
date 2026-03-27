import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getImagesBatch } from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { ImageDetailView, type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { ImageViewThumbnailStrip } from './image-view-thumbnail-strip'
import { ImageViewModalContext, type ImageViewModalOpenInput } from './image-view-modal-context'
import { ImageGroupAssignAction } from './image-group-assign-action'

interface ImageViewModalState {
  compositeHash: string | null
  compositeHashes: string[]
}

/** Provide a global image view modal for app-shell image browsing flows. */
export function ImageViewModalProvider({ children }: PropsWithChildren) {
  const [modalState, setModalState] = useState<ImageViewModalState>({
    compositeHash: null,
    compositeHashes: [],
  })

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
    if (isDesktopModalLayout) {
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
  }, [isDesktopModalLayout, compositeHash])

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/72 p-4 md:p-6" onMouseDown={onClose}>
      {canViewPrevious ? (
        <button
          type="button"
          className="absolute inset-y-0 left-0 z-[91] hidden w-20 items-center justify-start bg-gradient-to-r from-black/34 via-black/12 to-transparent pl-3 text-white/72 transition hover:text-white xl:flex"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onViewPrevious}
          aria-label="이전 이미지"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/18 bg-black/20 backdrop-blur-sm">
            <ChevronLeft className="h-6 w-6" />
          </span>
        </button>
      ) : null}

      {canViewNext ? (
        <button
          type="button"
          className="absolute inset-y-0 right-0 z-[91] hidden w-20 items-center justify-end bg-gradient-to-l from-black/34 via-black/12 to-transparent pr-3 text-white/72 transition hover:text-white xl:flex"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onViewNext}
          aria-label="다음 이미지"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/18 bg-black/20 backdrop-blur-sm">
            <ChevronRight className="h-6 w-6" />
          </span>
        </button>
      ) : null}

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
          <ImageDetailView
            compositeHash={compositeHash}
            presentation="modal"
            renderHeader={(controls) => (
              <ImageViewModalActions
                compositeHash={compositeHash}
                activeIndex={activeIndex}
                totalCount={totalCount}
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
        </div>

        {thumbnailStripItems.length > 1 ? (
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
    </div>,
    document.body,
  )
}

interface ImageViewModalActionsProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
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
        <div className="flex flex-wrap items-center gap-2">{navigationButtons}</div>
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-2">
            {navigationButtons}
            {groupAssignButton}
            {downloadButton}
          </div>
        </div>
      </div>
    </>
  )
}
