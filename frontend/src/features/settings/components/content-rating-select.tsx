import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { getRatingTiers } from '@/lib/api-search'

/** A content rating ceiling: 'model' follows the model's, null is none, a number is the highest rating tier's id. */
export type ContentRatingChoice = number | null | 'model'

/** Names a ceiling after the feed's rating tiers: "Teen까지", "제한 없음", or a tier that was deleted. */
export function useCeilingLabel() {
  const { t } = useI18n()
  const tiersQuery = useQuery({ queryKey: ['rating-tiers'], queryFn: getRatingTiers, staleTime: 60_000 })
  const tiers = [...(tiersQuery.data ?? [])].sort((a, b) => a.tier_order - b.tier_order)
  const label = (tierId: number | null) => {
    if (tierId === null) return t({ ko: '제한 없음', en: 'No limit' })
    const tier = tiers.find((entry) => entry.id === tierId)
    if (tier) return t({ ko: '{name}까지', en: 'Up to {name}' }, { name: tier.tier_name })
    // Until the tiers load a saved id reads as plain; a deleted tier lets nothing through (the server's rule).
    return tiersQuery.isSuccess ? t({ ko: '삭제된 등급 (모두 차단)', en: 'Deleted tier (blocks all)' }) : '…'
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
  const ids = tiers.map((tier) => tier.id)
  // A saved tier that no longer exists stays visible (and selected) until another is picked.
  if (typeof value === 'number' && !ids.includes(value)) ids.push(value)
  return (
    <Select
      variant="settings"
      aria-label={ariaLabel}
      value={value === 'model' ? 'model' : value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value === 'model' ? 'model' : event.target.value === '' ? null : Number(event.target.value))}
    >
      {followLabel ? <option value="model">{followLabel}</option> : null}
      <option value="">{label(null)}</option>
      {ids.map((id) => <option key={id} value={id}>{label(id)}</option>)}
    </Select>
  )
}
