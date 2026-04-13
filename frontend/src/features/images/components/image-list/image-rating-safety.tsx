import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'

export type ImageFeedVisibility = 'show' | 'blur' | 'hide'

export interface ResolvedImageFeedSafety {
  tier: RatingTierRecord | null
  visibility: ImageFeedVisibility
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
  if (!tier) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
  )
}

/** Build the preview-media class for a blurred feed card without affecting the surrounding chrome. */
export function getImageFeedPreviewClassName(blurPreview: boolean) {
  return cn(blurPreview && 'scale-[1.03] blur-2xl saturate-[0.55]')
}
