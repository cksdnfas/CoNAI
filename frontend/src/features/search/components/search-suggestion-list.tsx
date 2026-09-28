import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchAiToolGroup, SearchMetadataSuggestion, SearchScope } from '@/features/search/search-types'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

interface SearchSuggestionListProps {
  searchScope: SearchScope
  searchInput: string
  promptSuggestions: PromptCollectionItem[]
  filteredRatingTiers: RatingTierRecord[]
  modelSuggestions: SearchMetadataSuggestion[]
  loraSuggestions: SearchMetadataSuggestion[]
  suggestionsLoading: boolean
  ratingTiersLoading: boolean
  modelSuggestionsLoading: boolean
  loraSuggestionsLoading: boolean
  onSubmitInput: () => void
  onSelectSuggestion: (item: PromptCollectionItem) => void
  onSelectMetadataSuggestion: (value: string) => void
  onSelectRatingTier: (tier: RatingTierRecord) => void
  onSelectAIToolSuggestion: (tool: SearchAiToolGroup) => void
  emptyPromptText?: string
  emptyRatingText?: string
  idlePromptText?: string
}

/** Edge-to-edge list row: nav tone and hover, with the trailing hint/count pushed right. */
const suggestionRowClassName = 'h-auto justify-between gap-4 rounded-none px-4 py-3'

function SuggestionActionRow({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <Button type="button" onClick={onClick} variant="nav" className={suggestionRowClassName}>
      <span className="truncate text-sm text-foreground">{label}</span>
      {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
    </Button>
  )
}

/** Render the shared suggestion list for prompt, rating, metadata, and tool search scopes. */
export function SearchSuggestionList({
  searchScope,
  searchInput,
  promptSuggestions,
  filteredRatingTiers,
  modelSuggestions,
  loraSuggestions,
  suggestionsLoading,
  ratingTiersLoading,
  modelSuggestionsLoading,
  loraSuggestionsLoading,
  onSubmitInput,
  onSelectSuggestion,
  onSelectMetadataSuggestion,
  onSelectRatingTier,
  onSelectAIToolSuggestion,
  emptyPromptText,
  emptyRatingText,
  idlePromptText,
}: SearchSuggestionListProps) {
  const { t, formatNumber } = useI18n()
  const resolvedEmptyPromptText = emptyPromptText ?? t('search.components.search.suggestion.list.no.matching.prompt.suggestions')
  const resolvedEmptyRatingText = emptyRatingText ?? t('search.components.search.suggestion.list.no.rating.tiers.available')
  const resolvedIdlePromptText = idlePromptText ?? t('search.components.search.suggestion.list.enter.a.search.term')
  const trimmedInput = searchInput.trim()

  if (searchScope === 'positive' || searchScope === 'negative' || searchScope === 'auto') {
    return (
      <>
        {trimmedInput.length > 0 ? <SuggestionActionRow label={t({ ko: '"{value}" 추가', en: 'Add "{value}"' }, { value: trimmedInput })} hint="Enter" onClick={onSubmitInput} /> : null}

        {suggestionsLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">{t('search.components.search.suggestion.list.loading.suggestions')}</div> : null}
        {!suggestionsLoading && trimmedInput.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{resolvedIdlePromptText}</div> : null}
        {!suggestionsLoading && trimmedInput.length > 0 && promptSuggestions.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{resolvedEmptyPromptText}</div> : null}
        {!suggestionsLoading && promptSuggestions.length > 0
          ? promptSuggestions.map((item) => (
              <Button
                key={`${item.type}-${item.id}`}
                type="button"
                onClick={() => onSelectSuggestion(item)}
                variant="nav" className={suggestionRowClassName}
              >
                <span className="truncate text-sm text-secondary">{item.prompt}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{formatNumber(item.usage_count)}</span>
              </Button>
            ))
          : null}
      </>
    )
  }

  if (searchScope === 'rating') {
    return (
      <>
        {ratingTiersLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">{t('search.components.search.suggestion.list.loading.rating.tiers')}</div> : null}
        {!ratingTiersLoading && filteredRatingTiers.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{resolvedEmptyRatingText}</div> : null}
        {!ratingTiersLoading && filteredRatingTiers.length > 0
          ? filteredRatingTiers.map((tier) => (
              <Button
                key={tier.id}
                type="button"
                onClick={() => onSelectRatingTier(tier)}
                variant="nav" className={suggestionRowClassName}
              >
                <span className="text-sm font-semibold" style={tier.color ? { color: tier.color } : undefined}>
                  {tier.tier_name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {tier.min_score}~{tier.max_score === null ? '∞' : tier.max_score}
                </span>
              </Button>
            ))
          : null}
      </>
    )
  }

  if (searchScope === 'tool') {
    return (
      <>
        {SEARCH_AI_TOOL_OPTIONS.map((tool) => (
          <SuggestionActionRow key={tool.value} label={tool.label} onClick={() => onSelectAIToolSuggestion(tool.value)} />
        ))}
      </>
    )
  }

  const metadataSuggestions = searchScope === 'model' ? modelSuggestions : loraSuggestions
  const metadataLoading = searchScope === 'model' ? modelSuggestionsLoading : loraSuggestionsLoading
  const metadataLabel = searchScope === 'model' ? t('search.components.search.suggestion.list.model') : 'LoRA'
  const metadataEmptyText = trimmedInput.length > 0
    ? t({ ko: '일치하는 {metadataLabel}이 없어.', en: 'No matching {metadataLabel}.' }, { metadataLabel })
    : t({ ko: '추천 {metadataLabel}이 아직 없어.', en: 'Suggested {metadataLabel} are not available yet.' }, { metadataLabel })

  return (
    <>
      {trimmedInput.length > 0 ? <SuggestionActionRow label={t({ ko: '"{value}" 추가', en: 'Add "{value}"' }, { value: trimmedInput })} hint="Enter" onClick={onSubmitInput} /> : null}
      {metadataLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">{t({ ko: '{metadataLabel} 추천을 불러오는 중…', en: 'Loading {metadataLabel} suggestions…' }, { metadataLabel })}</div> : null}
      {!metadataLoading && metadataSuggestions.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{metadataEmptyText}</div> : null}
      {!metadataLoading && metadataSuggestions.length > 0
        ? metadataSuggestions.map((item) => (
            <Button
              key={item.value}
              type="button"
              onClick={() => onSelectMetadataSuggestion(item.value)}
              variant="nav" className={suggestionRowClassName}
            >
              <span className="truncate text-sm text-secondary">{item.value}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{formatNumber(item.count)}</span>
            </Button>
          ))
        : null}
    </>
  )
}
