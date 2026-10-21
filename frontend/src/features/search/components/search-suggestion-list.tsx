import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchAiToolGroup, SearchMetadataSuggestion, SearchScope } from '@/features/search/search-types'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
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
}

/** Loading row: a centred spinner, its text only for assistive tech. */
function SuggestionLoadingRow({ label }: { label: string }) {
  return (
    <div className="flex justify-center px-4 py-3 text-muted-foreground">
      <Spinner size="sm" label={label} />
    </div>
  )
}

function SuggestionActionRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ListRow asChild interactive size="lg">
      <button type="button" onClick={onClick}>
        <span className="truncate text-sm text-foreground">{label}</span>
      </button>
    </ListRow>
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
}: SearchSuggestionListProps) {
  const { t, formatNumber } = useI18n()
  const trimmedInput = searchInput.trim()

  if (searchScope === 'positive' || searchScope === 'negative' || searchScope === 'auto') {
    return (
      <>
        {trimmedInput.length > 0 ? <SuggestionActionRow label={t({ ko: '"{value}" 추가', en: 'Add "{value}"' }, { value: trimmedInput })} onClick={onSubmitInput} /> : null}

        {suggestionsLoading ? <SuggestionLoadingRow label={t('search.components.search.suggestion.list.loading.suggestions')} /> : null}
        {!suggestionsLoading && promptSuggestions.length > 0
          ? promptSuggestions.map((item) => (
              <ListRow
                key={`${item.type}-${item.id}`}
                asChild
                interactive
                size="lg"
                trailing={<span className="text-sm">{formatNumber(item.usage_count)}</span>}
              >
                <button type="button" onClick={() => onSelectSuggestion(item)}>
                  <span className="truncate text-sm text-secondary-text">{item.prompt}</span>
                </button>
              </ListRow>
            ))
          : null}
      </>
    )
  }

  if (searchScope === 'rating') {
    return (
      <>
        {ratingTiersLoading ? <SuggestionLoadingRow label={t('search.components.search.suggestion.list.loading.rating.tiers')} /> : null}
        {!ratingTiersLoading && filteredRatingTiers.length > 0
          ? filteredRatingTiers.map((tier) => (
              <ListRow
                key={tier.id}
                asChild
                interactive
                size="lg"
                trailing={<span className="text-sm">{tier.min_score}~{tier.max_score === null ? '∞' : tier.max_score}</span>}
              >
                <button type="button" onClick={() => onSelectRatingTier(tier)}>
                  <span className="text-sm font-semibold" style={tier.color ? { color: tier.color } : undefined}>
                    {tier.tier_name}
                  </span>
                </button>
              </ListRow>
            ))
          : null}
      </>
    )
  }

  if (searchScope === 'meaning') {
    return trimmedInput.length > 0
      ? <SuggestionActionRow label={t({ ko: '"{value}" 설명으로 찾기', en: 'Find by "{value}"' }, { value: trimmedInput })} onClick={onSubmitInput} />
      : null
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

  return (
    <>
      {trimmedInput.length > 0 ? <SuggestionActionRow label={t({ ko: '"{value}" 추가', en: 'Add "{value}"' }, { value: trimmedInput })} onClick={onSubmitInput} /> : null}
      {metadataLoading ? <SuggestionLoadingRow label={t({ ko: '{metadataLabel} 추천을 불러오는 중…', en: 'Loading {metadataLabel} suggestions…' }, { metadataLabel })} /> : null}
      {!metadataLoading && metadataSuggestions.length > 0
        ? metadataSuggestions.map((item) => (
            <ListRow
              key={item.value}
              asChild
              interactive
              size="lg"
              trailing={<span className="text-sm">{formatNumber(item.count)}</span>}
            >
              <button type="button" onClick={() => onSelectMetadataSuggestion(item.value)}>
                <span className="truncate text-sm text-secondary-text">{item.value}</span>
              </button>
            </ListRow>
          ))
        : null}
    </>
  )
}
