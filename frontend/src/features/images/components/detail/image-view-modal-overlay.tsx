import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n'
import { ImageDetailView } from '@/features/images/image-detail-view'
import { ImageViewModalActions } from './image-view-modal-actions'
import type { ImageRecord } from '@/types/image'
import type { ImageViewModalAccessOptions } from './image-view-modal-context'

interface ImageViewModalOverlayProps {
  compositeHash: string
  initialImage?: ImageRecord | null
  activeIndex: number
  totalCount: number
  openSessionId: number
  canViewPrevious: boolean
  canViewNext: boolean
  accessOptions: ImageViewModalAccessOptions
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
}

/** Render the full-screen image view modal only after the modal is opened. */
export function ImageViewModalOverlay({
  compositeHash,
  initialImage,
  activeIndex,
  totalCount,
  openSessionId,
  canViewPrevious,
  canViewNext,
  accessOptions,
  onClose,
  onViewPrevious,
  onViewNext,
}: ImageViewModalOverlayProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const containerElement = containerRef.current
    if (!containerElement) {
      return
    }

    containerElement.focus({ preventScroll: true })
  }, [compositeHash, openSessionId])

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black" onMouseDown={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('images.components.detail.image.view.modal.overlay.view.image')}
        tabIndex={-1}
        className="h-[100dvh] w-[100vw] overflow-hidden bg-background outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ImageDetailView
          compositeHash={compositeHash}
          presentation="modal"
          initialImage={initialImage}
          modalNavigation={{
            activeIndex,
            totalCount,
            canViewPrevious,
            canViewNext,
            onViewPrevious,
            onViewNext,
          }}
          renderHeader={(controls) => (
            <ImageViewModalActions
              compositeHash={compositeHash}
              activeIndex={activeIndex}
              totalCount={totalCount}
              controls={controls}
              accessOptions={accessOptions}
              onClose={onClose}
            />
          )}
        />
      </div>
    </div>,
    document.body,
  )
}
