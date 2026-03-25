import { useEffect, useMemo, useRef, type UIEventHandler } from 'react'
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
  isScrollActive: boolean
  onScroll: UIEventHandler<HTMLDivElement>
  onSelect: (compositeHash: string) => void
}

/** Render a horizontal thumbnail strip for fast modal image navigation. */
export function ImageViewThumbnailStrip({
  items,
  activeCompositeHash,
  isScrollActive,
  onScroll,
  onSelect,
}: ImageViewThumbnailStripProps) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const activeIndex = useMemo(
    () => items.findIndex((item) => item.composite_hash === activeCompositeHash),
    [activeCompositeHash, items],
  )

  useEffect(() => {
    if (!activeCompositeHash) {
      return
    }

    buttonRefs.current[activeCompositeHash]?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: 'smooth',
    })
  }, [activeCompositeHash])

  if (items.length <= 1) {
    return null
  }

  return (
    <div
      className={cn(
        'image-view-thumbnail-strip snap-x snap-mandatory overflow-x-auto overflow-y-hidden py-2',
        isScrollActive && 'is-scroll-active',
      )}
      onScroll={onScroll}
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
                'group relative h-18 w-18 shrink-0 snap-center overflow-hidden rounded-sm border bg-surface-low text-left transition-all duration-200',
                isActive
                  ? 'border-primary scale-[1.03] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_58%,transparent)]'
                  : 'border-border hover:border-secondary/60 hover:scale-[1.02]',
              )}
              onClick={() => onSelect(compositeHash)}
              title={`${index + 1}. ${displayName}`}
              aria-label={`${index + 1}. ${displayName}`}
              aria-current={isActive ? 'true' : undefined}
            >
              {previewUrl ? (
                mediaKind === 'video' ? (
                  <video
                    src={previewUrl}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img src={previewUrl} alt={displayName} className="h-full w-full object-cover" loading="lazy" />
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

      <div className="mt-1 px-1 text-[11px] text-muted-foreground">
        {activeIndex >= 0 ? `${activeIndex + 1} / ${items.length}` : `${items.length} items`}
      </div>
    </div>
  )
}
