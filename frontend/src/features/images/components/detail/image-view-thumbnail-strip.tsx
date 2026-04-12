import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import {
  getImageListDisplayName,
  getImageListMediaKind,
  getImageListPreviewUrl,
} from '@/features/images/components/image-list/image-list-utils'

interface ImageViewThumbnailStripProps {
  items: ImageRecord[]
  activeCompositeHash: string
  initialScrollSessionId: number
  focusRequestId: number
  focusBehavior: ScrollBehavior | null
  onSelect: (compositeHash: string) => void
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

  const activeIndex = useMemo(
    () => items.findIndex((item) => item.composite_hash === activeCompositeHash),
    [activeCompositeHash, items],
  )

  useEffect(() => {
    if (items.length <= 1) {
      return
    }

    if (initialScrollAppliedSessionRef.current === initialScrollSessionId) {
      return
    }

    const activeButton = buttonRefs.current[activeCompositeHash]
    if (!activeButton) {
      return
    }

    activeButton.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    })
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
    if (!activeButton) {
      return
    }

    activeButton.scrollIntoView({
      behavior: focusBehavior,
      block: 'nearest',
      inline: 'center',
    })
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

          const previewUrl = getImageListPreviewUrl(item)
          const mediaKind = getImageListMediaKind(item)
          const displayName = getImageListDisplayName(item)
          const isActive = compositeHash === activeCompositeHash

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
              {previewUrl ? (
                mediaKind === 'video' ? (
                  <video
                    src={previewUrl}
                    className="h-full w-full object-cover select-none"
                    muted
                    playsInline
                    preload="metadata"
                    draggable={false}
                  />
                ) : (
                  <img src={previewUrl} alt={displayName} className="h-full w-full object-cover select-none" loading="lazy" draggable={false} />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">없음</div>
              )}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white/88">
                {index + 1}
              </div>
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
