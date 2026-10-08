import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n'
import { ImageDetailView } from '@/features/images/image-detail-view'
import { useChatDockedBesidePage } from '@/features/codex-chat/chat-reference'
import { ImageViewModalActions } from './image-view-modal-actions'
import type { ImageRecord } from '@/types/image'
import type { ImageViewModalAccessOptions, ImageViewSequenceTotal } from './image-view-modal-context'

interface ImageViewModalOverlayProps {
  compositeHash: string
  initialImage?: ImageRecord | null
  activeIndex: number
  totalCount: number
  sequenceTotal: ImageViewSequenceTotal | null
  sequenceHasMore: boolean
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
  sequenceTotal,
  sequenceHasMore,
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
  // A docked chat panel stays usable beside the viewer: the viewer takes the page's side only.
  const besideChat = useChatDockedBesidePage()

  useEffect(() => {
    const containerElement = containerRef.current
    if (!containerElement) {
      return
    }

    containerElement.focus({ preventScroll: true })
  }, [compositeHash, openSessionId])

  return createPortal(
    <div className="fixed inset-y-0 left-0 right-[var(--chat-dock-width,0px)] z-[90] bg-black" onMouseDown={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal={!besideChat}
        aria-label={t('images.components.detail.image.view.modal.overlay.view.image')}
        tabIndex={-1}
        className="h-[100dvh] w-full overflow-hidden bg-background outline-none"
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
              sequenceTotal={sequenceTotal}
              sequenceHasMore={sequenceHasMore}
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
