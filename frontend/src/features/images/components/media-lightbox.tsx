import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ImageOff, Info, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useChatDockedBesidePage } from '@/features/codex-chat/chat-reference'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { useImageViewModal } from './detail/image-view-modal-context'
import { ImageDownloadTriggerButton } from './image-download-trigger-button'
import { getImageListMediaKind, getImageListPreviewUrl } from './image-list/image-list-utils'
import { lockBodyScroll } from '@/lib/body-scroll-lock'

export interface MediaLightboxProps {
  items: ImageRecord[]
  /** Index of the open item; `null` keeps the lightbox closed. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  /** Extra toolbar actions for the current item, placed before the shared ones. */
  renderActions?: (item: ImageRecord, index: number) => ReactNode
}

const SWIPE_MIN_PX = 50
const TAP_SLOP_PX = 10
const DOUBLE_TAP_MS = 300
const DRAG_SLOP_PX = 4
const LIGHTBOX_OPEN_EVENT = 'conai:media-lightbox-open'

type ContainedRect = { left: number; top: number; width: number; height: number; scale: number }
type ZoomAnchor = { ratioX: number; ratioY: number; offsetX: number; offsetY: number; naturalWidth: number; naturalHeight: number }

function getItemKey(item: ImageRecord) {
  return item.composite_hash ?? String(item.id)
}

/** The full-size source: the original file for stills and GIFs, the stream for videos. */
function getFullUrl(item: ImageRecord) {
  return getImageListMediaKind(item) === 'video' ? getImageListPreviewUrl(item) : item.image_url ?? item.thumbnail_url ?? null
}

/** Where an `object-contain` image actually paints inside its element box. */
function getContainedRect(image: HTMLImageElement): ContainedRect | null {
  const box = image.getBoundingClientRect()
  if (!image.naturalWidth || !image.naturalHeight || box.width === 0 || box.height === 0) {
    return null
  }

  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height, scale }
}

function isInsideRect(rect: ContainedRect, clientX: number, clientY: number) {
  return clientX >= rect.left && clientX <= rect.left + rect.width && clientY >= rect.top && clientY <= rect.top + rect.height
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

interface StageProps {
  item: ImageRecord
  canViewPrevious: boolean
  canViewNext: boolean
  onViewPrevious: () => void
  onViewNext: () => void
  onClose: () => void
}

/**
 * One item: fitted to the screen, double-click / double-tap toggles actual pixels (drag or touch-scroll to pan).
 * Swipe changes items on touch; a click or tap outside the media closes.
 */
function MediaLightboxStage({ item, canViewPrevious, canViewNext, onViewPrevious, onViewNext, onClose }: StageProps) {
  const { t } = useI18n()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLImageElement | null>(null)
  const fullRef = useRef<HTMLImageElement | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastTapRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const suppressClickRef = useRef(false)
  const lastTouchZoomAtRef = useRef(0)
  const dragRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null)
  const [fullLoaded, setFullLoaded] = useState(false)
  // Chat and gallery items may not know their mime type: a still that fails to decode gets one retry as a video.
  const [renderAs, setRenderAs] = useState<'image' | 'video' | 'failed'>(getImageListMediaKind(item) === 'video' ? 'video' : 'image')
  const [zoom, setZoom] = useState<ZoomAnchor | null>(null)
  const [canZoom, setCanZoom] = useState(false)
  const fullUrl = getFullUrl(item)
  const thumbnailUrl = item.thumbnail_url ?? null

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!zoom || !scroller) {
      return
    }

    scroller.scrollLeft = zoom.ratioX * zoom.naturalWidth - zoom.offsetX
    scroller.scrollTop = zoom.ratioY * zoom.naturalHeight - zoom.offsetY
  }, [zoom])

  const updateCanZoom = () => {
    const rect = fullRef.current ? getContainedRect(fullRef.current) : null
    setCanZoom(Boolean(rect && rect.scale < 1))
  }

  const getVisibleRect = () => {
    const image = fullLoaded ? fullRef.current : thumbRef.current
    return image ? getContainedRect(image) : null
  }

  const toggleZoom = (clientX: number, clientY: number) => {
    if (zoom) {
      setZoom(null)
      return
    }

    const image = fullLoaded ? fullRef.current : null
    const rect = image ? getContainedRect(image) : null
    const stageRect = stageRef.current?.getBoundingClientRect()
    if (!image || !rect || !stageRect || rect.scale >= 1 || !isInsideRect(rect, clientX, clientY)) {
      return
    }

    setZoom({
      ratioX: clamp01((clientX - rect.left) / rect.width),
      ratioY: clamp01((clientY - rect.top) / rect.height),
      offsetX: clientX - stageRect.left,
      offsetY: clientY - stageRect.top,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })
  }

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (zoom) {
      return
    }
    if (renderAs === 'image') {
      const rect = getVisibleRect()
      if (rect && isInsideRect(rect, event.clientX, event.clientY)) {
        return
      }
    } else if (event.target instanceof HTMLVideoElement) {
      return
    }
    onClose()
  }

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (renderAs !== 'image' || Date.now() - lastTouchZoomAtRef.current < 600) {
      return
    }
    toggleZoom(event.clientX, event.clientY)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchStartRef.current = { x: event.clientX, y: event.clientY }
      return
    }

    const scroller = scrollRef.current
    if (zoom && scroller && event.button === 0) {
      dragRef.current = { x: event.clientX, y: event.clientY, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const scroller = scrollRef.current
    if (!drag || !scroller) {
      return
    }

    const deltaX = event.clientX - drag.x
    const deltaY = event.clientY - drag.y
    drag.moved ||= Math.abs(deltaX) > DRAG_SLOP_PX || Math.abs(deltaY) > DRAG_SLOP_PX
    scroller.scrollLeft = drag.scrollLeft - deltaX
    scroller.scrollTop = drag.scrollTop - deltaY
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      suppressClickRef.current = dragRef.current.moved
      dragRef.current = null
      return
    }

    const start = touchStartRef.current
    touchStartRef.current = null
    if (event.pointerType !== 'touch' || !start) {
      return
    }

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (!zoom && Math.abs(deltaX) > SWIPE_MIN_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      suppressClickRef.current = true
      lastTapRef.current = null
      if (deltaX > 0 && canViewPrevious) {
        onViewPrevious()
      } else if (deltaX < 0 && canViewNext) {
        onViewNext()
      }
      return
    }

    if (Math.abs(deltaX) > TAP_SLOP_PX || Math.abs(deltaY) > TAP_SLOP_PX || renderAs !== 'image') {
      return
    }

    const now = Date.now()
    const lastTap = lastTapRef.current
    if (lastTap && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
      lastTapRef.current = null
      lastTouchZoomAtRef.current = now
      suppressClickRef.current = true
      toggleZoom(event.clientX, event.clientY)
      return
    }
    lastTapRef.current = { x: event.clientX, y: event.clientY, at: now }
  }

  return (
    <div
      ref={stageRef}
      className={cn('relative min-h-0 flex-1 select-none', zoom ? 'touch-auto' : 'touch-none')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        touchStartRef.current = null
        dragRef.current = null
      }}
    >
      {renderAs === 'failed' || !fullUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/60">
          <ImageOff className="size-8" />
        </div>
      ) : renderAs === 'video' ? (
        <div className="absolute inset-0 flex items-center justify-center p-2 sm:px-20">
          <video
            src={fullUrl}
            poster={thumbnailUrl ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
            onCanPlay={(event) => {
              // Browsers refuse autoplay with sound once the opening click is no longer "recent" (e.g. after an
              // image attempt failed first); fall back to muted playback so the video still starts.
              const video = event.currentTarget
              if (video.paused) {
                video.play().catch(() => {
                  video.muted = true
                  void video.play().catch(() => undefined)
                })
              }
            }}
            onError={() => setRenderAs('failed')}
          />
        </div>
      ) : zoom ? (
        <div ref={scrollRef} className="absolute inset-0 flex overflow-auto cursor-grab active:cursor-grabbing">
          <img src={fullUrl} alt="" draggable={false} className="m-auto max-w-none" style={{ width: zoom.naturalWidth, height: zoom.naturalHeight }} />
        </div>
      ) : (
        <div className="absolute inset-0 p-2 sm:px-20">
          <div className={cn('relative h-full w-full', canZoom && 'cursor-zoom-in')}>
            {thumbnailUrl && !fullLoaded ? (
              <img ref={thumbRef} src={thumbnailUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
            ) : null}
            <img
              ref={fullRef}
              src={fullUrl}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={() => {
                setFullLoaded(true)
                updateCanZoom()
              }}
              onError={() => setRenderAs((current) => (current === 'image' ? 'video' : 'failed'))}
            />
          </div>
        </div>
      )}

      {zoom ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-sm bg-backdrop px-2.5 py-1 text-xs tabular-nums text-white">100%</div>
      ) : null}

      {canViewPrevious ? (
        <IconButton variant="overlay" className="absolute left-4 top-1/2 hidden -translate-y-1/2 rounded-full sm:inline-flex" label={t({ ko: '이전', en: 'Previous' })} onClick={(event) => { event.stopPropagation(); onViewPrevious() }}>
          <ChevronLeft />
        </IconButton>
      ) : null}
      {canViewNext ? (
        <IconButton variant="overlay" className="absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-full sm:inline-flex" label={t({ ko: '다음', en: 'Next' })} onClick={(event) => { event.stopPropagation(); onViewNext() }}>
          <ChevronRight />
        </IconButton>
      ) : null}
    </div>
  )
}

function MediaLightboxOverlay({ items, index, onIndexChange, onClose, renderActions, onOpenDetail }: Omit<MediaLightboxProps, 'index'> & { index: number; onOpenDetail: (() => void) | null }) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)
  const item = items[index]
  const count = items.length
  const canViewPrevious = index > 0
  const canViewNext = index < count - 1
  const compositeHash = item.composite_hash ?? null
  // A docked chat panel stays usable beside the lightbox, as beside the detail modal that replaces it.
  const besideChat = useChatDockedBesidePage()

  const viewPrevious = useCallback(() => onIndexChange(Math.max(0, index - 1)), [index, onIndexChange])
  const viewNext = useCallback(() => onIndexChange(Math.min(count - 1, index + 1)), [count, index, onIndexChange])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    containerRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousRootBackground = root.style.backgroundColor
    const releaseScroll = lockBodyScroll()
    // `scrollbar-gutter: stable` keeps the root gutter painted in the page colour beside the overlay; dropping the
    // gutter would reflow the page behind, so paint it black instead.
    root.style.backgroundColor = 'black'
    return () => {
      releaseScroll()
      root.style.backgroundColor = previousRootBackground
      opener?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Keys typed in a docked chat panel beside the lightbox belong to the chat.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-chat-dock]'))) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft' && canViewPrevious) {
        event.preventDefault()
        viewPrevious()
      } else if (event.key === 'ArrowRight' && canViewNext) {
        event.preventDefault()
        viewNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canViewNext, canViewPrevious, onClose, viewNext, viewPrevious])

  useEffect(() => {
    for (const neighbour of [items[index - 1], items[index + 1]]) {
      const url = neighbour && getImageListMediaKind(neighbour) !== 'video' ? getFullUrl(neighbour) : null
      if (url) {
        new Image().src = url
      }
    }
  }, [index, items])

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [index])

  // The chat beside stays clickable, so another message's image can open a second lightbox: the newest one replaces it.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const token = Symbol('media-lightbox')
    const closeOnNewer = (event: Event) => {
      if ((event as CustomEvent<symbol>).detail !== token) onCloseRef.current()
    }
    window.dispatchEvent(new CustomEvent(LIGHTBOX_OPEN_EVENT, { detail: token }))
    window.addEventListener(LIGHTBOX_OPEN_EVENT, closeOnNewer)
    return () => window.removeEventListener(LIGHTBOX_OPEN_EVENT, closeOnNewer)
  }, [])

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal={!besideChat}
      aria-label={t({ ko: '이미지 보기', en: 'Image viewer' })}
      tabIndex={-1}
      // Full-bleed, taking the same page side beside a docked chat as the detail modal (z-[90]).
      className="fixed inset-y-0 left-0 right-[var(--chat-dock-width,0px)] z-[88] flex flex-col bg-black text-white outline-none"
    >
      <div className="flex h-14 shrink-0 items-center gap-1.5 pl-4 pr-2 sm:pl-6">
        <span className="flex-1 text-sm tabular-nums text-white/70">{count > 1 ? `${index + 1} / ${count}` : null}</span>
        {renderActions?.(item, index)}
        {onOpenDetail ? (
          <IconButton variant="overlay" label={t({ ko: '상세 보기', en: 'Details' })} onClick={onOpenDetail}>
            <Info />
          </IconButton>
        ) : null}
        {compositeHash ? <ImageDownloadTriggerButton image={item} size="icon" variant="overlay" /> : null}
        <IconButton variant="overlay" label={t({ ko: '닫기', en: 'Close' })} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <MediaLightboxStage
        key={getItemKey(item)}
        item={item}
        canViewPrevious={canViewPrevious}
        canViewNext={canViewNext}
        onViewPrevious={viewPrevious}
        onViewNext={viewNext}
        onClose={onClose}
      />

      {count > 1 ? (
        <div className="h-20 shrink-0 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="mx-auto flex h-full w-max items-center gap-1.5 px-1">
            {items.map((candidate, candidateIndex) => (
              // eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control; Button padding/height would crop it
              <button
                key={getItemKey(candidate)}
                ref={candidateIndex === index ? activeThumbRef : undefined}
                type="button"
                aria-label={t({ ko: '{index}번째 이미지', en: 'Image {index}' }, { index: candidateIndex + 1 })}
                aria-current={candidateIndex === index ? 'true' : undefined}
                onClick={() => onIndexChange(candidateIndex)}
                className={cn(
                  'h-12 shrink-0 cursor-pointer overflow-hidden rounded-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white/60',
                  candidateIndex === index ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : 'opacity-45 hover:opacity-80',
                )}
              >
                {candidate.thumbnail_url ? (
                  <img src={candidate.thumbnail_url} alt="" loading="lazy" draggable={false} className="h-full w-auto min-w-8 object-cover" />
                ) : (
                  <span className="flex h-full w-8 items-center justify-center bg-white/10"><ImageOff className="size-4" /></span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-6 shrink-0" />
      )}
    </div>,
    document.body,
  )
}

/**
 * Lightweight full-screen viewer for a short list (chat results, a chat's gallery): no metadata, just the media.
 * "Details" swaps it for the regular image modal (it does not stack on top); while that modal shows, opening an item
 * here moves the modal to it instead. Browser back, Esc, ✕ or a click outside the media close it.
 */
export function MediaLightbox({ items, index, onIndexChange, onClose, renderActions }: MediaLightboxProps) {
  const { canViewImages } = useImagePermissions()
  const imageViewModal = useImageViewModal()
  const detailOpen = Boolean(imageViewModal?.activeCompositeHash)
  const open = canViewImages && index !== null && items.length > 0
  const clampedIndex = index === null ? 0 : Math.min(Math.max(index, 0), items.length - 1)
  const { handOff } = useOverlayBackClose({ open: open && !detailOpen, onClose })

  /** Show `items[target]` in the image modal, paging through this same list. */
  const showInDetail = useCallback((target: number) => {
    const compositeHash = items[target]?.composite_hash
    if (!compositeHash || !imageViewModal) {
      return false
    }

    const sourceItems = items.filter((candidate) => Boolean(candidate.composite_hash))
    imageViewModal.openImageView({
      compositeHash,
      compositeHashes: sourceItems.map((candidate) => candidate.composite_hash as string),
      sourceId: 'media-lightbox',
      sourceItems,
      accessOptions: { allowDetailNavigation: false },
    })
    return true
  }, [imageViewModal, items])

  // Opened while the image modal is showing: the modal moves to the item and the lightbox stays shut.
  useEffect(() => {
    if (!open || !detailOpen) {
      return
    }
    showInDetail(clampedIndex)
    onClose()
  }, [clampedIndex, detailOpen, onClose, open, showInDetail])

  if (!open || detailOpen) {
    return null
  }

  const canOpenDetail = Boolean(items[clampedIndex]?.composite_hash && imageViewModal)
  const openDetail = () => {
    if (showInDetail(clampedIndex)) {
      handOff()
      onClose()
    }
  }

  return (
    <MediaLightboxOverlay
      items={items}
      index={clampedIndex}
      onIndexChange={onIndexChange}
      onClose={onClose}
      renderActions={renderActions}
      onOpenDetail={canOpenDetail ? openDetail : null}
    />
  )
}
