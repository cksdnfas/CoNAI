import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { getRatingTiers } from '@/lib/api-search'

/** A content rating ceiling: 'model' follows the model's, null is none, a number is the highest rating tier (tier_order). */
export type ContentRatingChoice = number | null | 'model'

/** Names a ceiling after the feed's rating tiers: "Teen까지", or "제한 없음". */
export function useCeilingLabel() {
  const { t } = useI18n()
  const tiers = useQuery({ queryKey: ['rating-tiers'], queryFn: getRatingTiers, staleTime: 60_000 }).data ?? []
  const label = (maxTier: number | null) => {
    if (maxTier === null) return t({ ko: '제한 없음', en: 'No limit' })
    const tier = tiers.find((entry) => entry.tier_order === maxTier)
    return tier ? t({ ko: '{name}까지', en: 'Up to {name}' }, { name: tier.tier_name }) : t({ ko: '등급 {n}까지', en: 'Up to tier {n}' }, { n: maxTier })
  }
  return { tiers, label }
}

/**
 * Picks the highest rating tier of media a model is shown (images, videos, animations above it are never sent).
 * `followLabel` adds a first choice that follows the model row's ceiling.
 */
export function ContentRatingSelect({ value, onChange, followLabel, ariaLabel }: {
  value: ContentRatingChoice
  onChange: (value: ContentRatingChoice) => void
  followLabel?: string
  ariaLabel: string
}) {
  const { tiers, label } = useCeilingLabel()
  const orders = tiers.map((tier) => tier.tier_order)
  // A ceiling saved before the tiers changed stays pickable under its position.
  if (typeof value === 'number' && !orders.includes(value)) orders.push(value)
  return (
    <Select
      variant="settings"
      aria-label={ariaLabel}
      value={value === 'model' ? 'model' : value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value === 'model' ? 'model' : event.target.value === '' ? null : Number(event.target.value))}
    >
      {followLabel ? <option value="model">{followLabel}</option> : null}
      <option value="">{label(null)}</option>
      {orders.sort((a, b) => a - b).map((order) => <option key={order} value={order}>{label(order)}</option>)}
    </Select>
  )
}
