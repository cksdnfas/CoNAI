import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
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

  // 티어 정책이 아직 도착하지 않은 첫 페인트는 노출(fail-open)이 아니라 블러(fail-closed)로
  // 시작한다. 종전의 'show' 기본값은 제한 컨텐츠를 한 프레임 노출한 뒤 블러로 반전시키면서
  // 리스트를 흔들었다. 정책이 로드된 뒤 티어에 안 걸리는(미평가) 미디어는 그대로 보여준다.
  if (!tier && tiers == null) {
    return { tier: null, visibility: 'blur' }
  }

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
  // The tier colour is user data, so its tint and frame are inline; an inset ring frames it without adding height.
  const tierBadgeStyle: CSSProperties | undefined = tier.color
    ? {
        color: tier.color,
        backgroundColor: `color-mix(in srgb, ${tier.color} 18%, rgb(0 0 0 / 84%))`,
        boxShadow: `inset 0 0 0 1px ${tier.color}`,
      }
    : undefined

  return (
    <div ref={containerRef} className="relative">
      <div ref={measureRef} aria-hidden className="pointer-events-none absolute left-0 top-0 flex w-max items-center gap-1 whitespace-nowrap opacity-0">
        <Badge variant="overlay" size="sm" casing="upper" style={tierBadgeStyle}>
          {tier.tier_name}
        </Badge>
        {visibility === 'blur' ? (
          <Badge variant="overlay" size="sm" casing="upper">
            Blur
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="overlay"
          size={isCompact ? 'xs' : 'sm'}
          casing="upper"
          className={isCompact ? 'min-w-5' : undefined}
          style={tierBadgeStyle}
        >
          {tierLabel}
        </Badge>
        {visibility === 'blur' ? (
          <Badge
            variant="overlay" size={isCompact ? 'xs' : 'sm'}
            casing="upper"
            className={isCompact ? 'min-w-5' : undefined}
          >
            {blurLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}
