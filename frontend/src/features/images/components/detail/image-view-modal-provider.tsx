import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren, type UIEventHandler } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getImagesBatch } from '@/lib/api'
import { ImageDetailView, type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { ImageViewThumbnailStrip } from './image-view-thumbnail-strip'
import { ImageViewModalContext, type ImageViewModalOpenInput } from './image-view-modal-context'

interface ImageViewModalState {
  compositeHash: string | null
  compositeHashes: string[]
}

/** Keep the horizontal thumbnail scrollbar visible only while it is being used. */
function useTransientScrollState() {
  const [isScrollActive, setIsScrollActive] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleScroll: UIEventHandler<HTMLDivElement> = () => {
    setIsScrollActive(true)

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = window.setTimeout(() => {
      setIsScrollActive(false)
      timeoutRef.current = null
    }, 520)
  }

  return {
    isScrollActive,
    handleScroll,
  }
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

  const thumbnailStripScrollState = useTransientScrollState()
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
          thumbnailStripIsScrollActive={thumbnailStripScrollState.isScrollActive}
          onThumbnailStripScroll={thumbnailStripScrollState.handleScroll}
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
  thumbnailStripIsScrollActive: boolean
  onThumbnailStripScroll: UIEventHandler<HTMLDivElement>
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
  thumbnailStripIsScrollActive,
  onThumbnailStripScroll,
  canViewPrevious,
  canViewNext,
  onClose,
  onViewPrevious,
  onViewNext,
  onSelectImage,
}: ImageViewModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [compositeHash])

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/72 p-4 md:p-6" onMouseDown={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="이미지 보기"
        className="mx-auto max-h-full w-full max-w-[1680px] overflow-y-auto rounded-sm border border-border bg-background p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:p-6 xl:flex xl:h-[calc(100vh-3rem)] xl:flex-col xl:overflow-hidden"
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
              isScrollActive={thumbnailStripIsScrollActive}
              onScroll={onThumbnailStripScroll}
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
  onClose,
  onViewPrevious,
  onViewNext,
}: ImageViewModalActionsProps) {
  const navigate = useNavigate()
  const showCounter = totalCount > 1 && activeIndex >= 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onClose}>
          <X className="h-4 w-4" />
          닫기
        </Button>
        <Button variant="outline" onClick={onViewPrevious} disabled={!canViewPrevious}>
          <ChevronLeft className="h-4 w-4" />
          이전
        </Button>
        <Button variant="outline" onClick={onViewNext} disabled={!canViewNext}>
          다음
          <ChevronRight className="h-4 w-4" />
        </Button>
        {showCounter ? <div className="px-2 text-xs text-muted-foreground">{activeIndex + 1} / {totalCount}</div> : null}
        <Button
          variant="outline"
          onClick={() => {
            navigate(`/images/${compositeHash}`)
            onClose()
          }}
        >
          <ExternalLink className="h-4 w-4" />
          상세 페이지
        </Button>
        <Button variant="outline" onClick={controls.refresh} disabled={controls.isRefreshing}>
          <RefreshCcw className="h-4 w-4" />
          새로고침
        </Button>
      </div>

      {controls.downloadUrl ? (
        <Button asChild>
          <a href={controls.downloadUrl} download={controls.downloadName}>
            <Download className="h-4 w-4" />
            다운로드
          </a>
        </Button>
      ) : null}
    </div>
  )
}
