import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getRatingTiers } from '@/lib/api-search'
import { resolveImageFeedSafety } from '@/features/images/components/image-list/image-rating-safety'
import {
  getImageListDisplayName,
  getImageListMediaKind,
  getImageListPreviewUrl,
} from '@/features/images/components/image-list/image-list-utils'

function scrollThumbnailStripToActive(
  stripElement: HTMLDivElement,
  activeButton: HTMLButtonElement,
  behavior: ScrollBehavior,
) {
  const targetLeft = activeButton.offsetLeft - ((stripElement.clientWidth - activeButton.clientWidth) / 2)
  const maxScrollLeft = Math.max(0, stripElement.scrollWidth - stripElement.clientWidth)
  const nextScrollLeft = Math.min(Math.max(0, targetLeft), maxScrollLeft)

  stripElement.scrollTo({
    left: nextScrollLeft,
    behavior,
  })
}

interface ImageViewThumbnailStripProps {
  items: ImageRecord[]
  activeCompositeHash: string
  initialScrollSessionId: number
  focusRequestId: number
  focusBehavior: ScrollBehavior | null
  onSelect: (compositeHash: string) => void
}

function ThumbnailStripPreview({ item, displayName, blurPreview }: { item: ImageRecord, displayName: string, blurPreview: boolean }) {
  const previewUrl = getImageListPreviewUrl(item)
  const mediaKind = getImageListMediaKind(item)
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl, item.composite_hash, item.original_file_path, item.is_processing])

  if (!previewUrl || hasPreviewError) {
    return (
      <ImagePreviewPlaceholder
        label={item.is_processing ? '처리 중' : '미리보기 없음'}
        compact
        className="text-[10px]"
      />
    )
  }

  return (
    <div className={cn('h-full w-full transition duration-300', blurPreview && 'scale-[1.03] blur-2xl saturate-[0.55]')}>
      {mediaKind === 'video' ? (
        <video
          src={previewUrl}
          className="h-full w-full object-cover select-none"
          muted
          playsInline
          preload="metadata"
          draggable={false}
          onError={() => setHasPreviewError(true)}
        />
      ) : (
        <img
          src={previewUrl}
          alt={displayName}
          className="h-full w-full object-cover select-none"
          loading="lazy"
          draggable={false}
          onError={() => setHasPreviewError(true)}
        />
      )}
    </div>
  )
}

/** Render a horizontal thumbnail strip for fast modal image navigation. */
export function ImageViewThumbnailStrip({
  items,
  activeCompositeHash,
  initialScrollSessionId,
  focusRequestId,
  focusBehavior,
  onSelect,
}: ImageViewThumbnailStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const dragPointerIdRef = useRef<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const suppressClickRef = useRef(false)
  const initialScrollAppliedSessionRef = useRef<number | null>(null)
  const focusRequestAppliedRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    staleTime: 60_000,
  })

  const activeIndex = useMemo(
    () => items.findIndex((item) => item.composite_hash === activeCompositeHash),
    [activeCompositeHash, items],
  )

  const blurPreviewByHash = useMemo(
    () => new Map(
      items.map((item) => [
        item.composite_hash,
        resolveImageFeedSafety(item, ratingTiersQuery.data).visibility === 'blur',
      ]),
    ),
    [items, ratingTiersQuery.data],
  )

  useEffect(() => {
    if (items.length <= 1) {
      return
    }

    if (initialScrollAppliedSessionRef.current === initialScrollSessionId) {
      return
    }

    const activeButton = buttonRefs.current[activeCompositeHash]
    const stripElement = stripRef.current
    if (!activeButton || !stripElement) {
      return
    }

    scrollThumbnailStripToActive(stripElement, activeButton, 'auto')
    initialScrollAppliedSessionRef.current = initialScrollSessionId
    focusRequestAppliedRef.current = focusRequestId
  }, [activeCompositeHash, focusRequestId, initialScrollSessionId, items])

  useEffect(() => {
    if (items.length <= 1 || focusBehavior == null) {
      return
    }

    if (focusRequestAppliedRef.current === focusRequestId) {
      return
    }

    const activeButton = buttonRefs.current[activeCompositeHash]
    const stripElement = stripRef.current
    if (!activeButton || !stripElement) {
      return
    }

    scrollThumbnailStripToActive(stripElement, activeButton, focusBehavior)
    focusRequestAppliedRef.current = focusRequestId
  }, [activeCompositeHash, focusBehavior, focusRequestId, items])

  if (items.length <= 1) {
    return null
  }

  const finishDrag = () => {
    dragPointerIdRef.current = null
    dragStartXRef.current = 0
    dragStartScrollLeftRef.current = 0
    setIsDragging(false)

    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  return (
    <div
      ref={stripRef}
      className={cn(
        'image-view-thumbnail-strip snap-x snap-mandatory overflow-x-auto overflow-y-hidden py-2',
        isDragging && 'cursor-grabbing select-none',
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }

        dragPointerIdRef.current = event.pointerId
        dragStartXRef.current = event.clientX
        dragStartScrollLeftRef.current = stripRef.current?.scrollLeft ?? 0
        suppressClickRef.current = false
        setIsDragging(false)
      }}
      onPointerMove={(event) => {
        if (dragPointerIdRef.current !== event.pointerId || !stripRef.current) {
          return
        }

        const deltaX = event.clientX - dragStartXRef.current
        if (!isDragging && Math.abs(deltaX) > 6) {
          suppressClickRef.current = true
          setIsDragging(true)
        }

        if (Math.abs(deltaX) <= 1) {
          return
        }

        stripRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerUp={(event) => {
        if (dragPointerIdRef.current !== event.pointerId) {
          return
        }

        finishDrag()
      }}
      onPointerCancel={(event) => {
        if (dragPointerIdRef.current !== event.pointerId) {
          return
        }

        finishDrag()
      }}
      onPointerLeave={(event) => {
        if (dragPointerIdRef.current !== event.pointerId || !isDragging) {
          return
        }

        finishDrag()
      }}
      style={{ touchAction: 'pan-y pinch-zoom' }}
    >
      <div className="flex min-w-max items-center gap-3 pr-1">
        {items.map((item, index) => {
          const compositeHash = item.composite_hash
          if (!compositeHash) {
            return null
          }

          const displayName = getImageListDisplayName(item)
          const isActive = compositeHash === activeCompositeHash
          const blurPreview = blurPreviewByHash.get(compositeHash) === true

          return (
            <button
              key={compositeHash}
              ref={(node) => {
                buttonRefs.current[compositeHash] = node
              }}
              type="button"
              className={cn(
                'group relative h-18 w-18 shrink-0 snap-center overflow-hidden rounded-sm border bg-surface-low text-left transition-all duration-200 select-none',
                isDragging && 'pointer-events-none',
                isActive
                  ? 'border-primary scale-[1.03] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_58%,transparent)]'
                  : 'border-border hover:border-secondary/60 hover:scale-[1.02]',
              )}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }

                onSelect(compositeHash)
              }}
              onDragStart={(event) => event.preventDefault()}
              title={`${index + 1}. ${displayName}`}
              aria-label={`${index + 1}. ${displayName}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <ThumbnailStripPreview item={item} displayName={displayName} blurPreview={blurPreview} />

              {blurPreview ? <div className="pointer-events-none absolute inset-0 z-10 bg-black/18" /> : null}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white/88">
                {index + 1}
              </div>

              {blurPreview ? (
                <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-full border border-white/18 bg-black/68 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/88 backdrop-blur-sm">
                  Blur
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-1 px-1 text-[11px] text-muted-foreground select-none">
        {activeIndex >= 0 ? `${activeIndex + 1} / ${items.length}` : `${items.length} items`}
      </div>
    </div>
  )
}
