import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'

export type ImageFeedVisibility = 'show' | 'blur' | 'hide'

export interface ResolvedImageFeedSafety {
  tier: RatingTierRecord | null
  visibility: ImageFeedVisibility
}

const IMAGE_SAFETY_BADGE_COMPACT_RATIO = 0.2

/** Build a one-character fallback label for very small feed badges. */
function getCompactSafetyBadgeLabel(label: string) {
  const normalized = label.trim()
  return Array.from(normalized)[0] ?? label
}

/** Resolve the current tier for one rating score using the active tier ranges. */
export function resolveRatingTier(score: number | null | undefined, tiers: RatingTierRecord[] | null | undefined) {
  if (typeof score !== 'number' || !Number.isFinite(score) || !tiers || tiers.length === 0) {
    return null
  }

  return tiers.find((tier) => (
    score >= tier.min_score && (tier.max_score == null || score < tier.max_score)
  )) ?? null
}

/** Resolve how one image should appear in feed/list contexts for the phase-1 safety slice. */
export function resolveImageFeedSafety(image: ImageRecord, tiers: RatingTierRecord[] | null | undefined): ResolvedImageFeedSafety {
  const tier = resolveRatingTier(image.rating_score, tiers)
  return {
    tier,
    visibility: tier?.feed_visibility ?? 'show',
  }
}

/** Render a persistent tier badge for one feed card using the tier's own label and color. */
export function ImageRatingSafetyBadge({
  tier,
  visibility,
}: {
  tier: RatingTierRecord | null
  visibility: ImageFeedVisibility
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [isCompact, setIsCompact] = useState(false)

  useEffect(() => {
    if (!tier || typeof window === 'undefined') {
      return
    }

    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) {
      return
    }

    let frameId = 0

    const updateCompactMode = () => {
      frameId = 0
      const containerWidth = container.clientWidth
      const fullWidth = measure.scrollWidth
      if (containerWidth <= 0 || fullWidth <= 0) {
        return
      }
      setIsCompact(fullWidth > containerWidth * IMAGE_SAFETY_BADGE_COMPACT_RATIO)
    }

    const scheduleUpdate = () => {
      if (frameId !== 0) {
        return
      }
      frameId = window.requestAnimationFrame(updateCompactMode)
    }

    scheduleUpdate()

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(container)
    observer.observe(measure)

    return () => {
      observer.disconnect()
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [tier, visibility])

  if (!tier) {
    return null
  }

  const compactTierLabel = getCompactSafetyBadgeLabel(tier.tier_name)
  const tierLabel = isCompact ? compactTierLabel : tier.tier_name
  const blurLabel = isCompact ? 'B' : 'Blur'

  return (
    <div ref={containerRef} className="relative">
      <div ref={measureRef} aria-hidden className="pointer-events-none absolute left-0 top-0 flex w-max items-center gap-1.5 whitespace-nowrap opacity-0">
        <Badge
          variant="secondary"
          className="border bg-background/92 text-[11px] font-semibold shadow-sm backdrop-blur-sm"
          style={tier.color
            ? {
                color: tier.color,
                borderColor: tier.color,
                backgroundColor: `color-mix(in srgb, ${tier.color} 18%, rgb(0 0 0 / 84%))`,
              }
            : undefined}
        >
          {tier.tier_name}
        </Badge>
        {visibility === 'blur' ? (
          <Badge variant="outline" className="border-white/18 bg-black/68 text-[10px] uppercase tracking-[0.12em] text-white/88 backdrop-blur-sm">
            Blur
          </Badge>
        ) : null}
      </div>
      <div className="image-rating-safety-badges flex flex-wrap items-center gap-1.5">
        <Badge
          variant="secondary"
          className="image-rating-safety-badge border bg-background/92 text-[11px] font-semibold shadow-sm backdrop-blur-sm"
          style={tier.color
            ? {
                color: tier.color,
                borderColor: tier.color,
                backgroundColor: `color-mix(in srgb, ${tier.color} 18%, rgb(0 0 0 / 84%))`,
              }
            : undefined}
        >
          {tierLabel}
        </Badge>
        {visibility === 'blur' ? (
          <Badge variant="outline" className="image-rating-safety-badge border-white/18 bg-black/68 text-[10px] uppercase tracking-[0.12em] text-white/88 backdrop-blur-sm">
            {blurLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

/** Build the preview-media class for a blurred feed card without affecting the surrounding chrome. */
export function getImageFeedPreviewClassName(blurPreview: boolean) {
  return cn(blurPreview && 'scale-[1.03] blur-2xl saturate-[0.55]')
}
