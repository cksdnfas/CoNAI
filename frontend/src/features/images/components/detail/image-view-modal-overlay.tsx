import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { ImageDetailView } from '@/features/images/image-detail-view'
import { ImageViewThumbnailStrip } from './image-view-thumbnail-strip'
import { ImageViewModalActions, type ImageViewModalMode } from './image-view-modal-actions'
import { ImageViewMediumContent, ImageViewMinimalContent } from './image-view-modal-surfaces'
import type { ImageViewModalOpenInput } from './image-view-modal-context'

interface ImageViewModalOverlayProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
  thumbnailStripItems: ImageRecord[]
  thumbnailStripCompositeHashes: string[]
  openSessionId: number
  stripFocusRequestId: number
  stripFocusBehavior: ScrollBehavior | null
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  canViewPrevious: boolean
  canViewNext: boolean
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
  onSelectImage: (input: ImageViewModalOpenInput) => void
}

/** Render the full-screen image view modal only after the modal is opened. */
export function ImageViewModalOverlay({
  compositeHash,
  activeIndex,
  totalCount,
  thumbnailStripItems,
  thumbnailStripCompositeHashes,
  openSessionId,
  stripFocusRequestId,
  stripFocusBehavior,
  viewMode,
  onChangeViewMode,
  canViewPrevious,
  canViewNext,
  onClose,
  onViewPrevious,
  onViewNext,
  onSelectImage,
}: ImageViewModalOverlayProps) {
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
                initialScrollSessionId={openSessionId}
                focusRequestId={stripFocusRequestId}
                focusBehavior={stripFocusBehavior}
                onSelect={(nextCompositeHash) =>
                  onSelectImage({
                    compositeHash: nextCompositeHash,
                    compositeHashes: thumbnailStripCompositeHashes,
                    stripFocusBehavior: null,
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
