import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchScope } from '@/features/search/search-types'

interface SearchSuggestionListProps {
  searchScope: SearchScope
  searchInput: string
  promptSuggestions: PromptCollectionItem[]
  filteredRatingTiers: RatingTierRecord[]
  suggestionsLoading: boolean
  ratingTiersLoading: boolean
  onSubmitInput: () => void
  onSelectSuggestion: (item: PromptCollectionItem) => void
  onSelectRatingTier: (tier: RatingTierRecord) => void
  emptyPromptText?: string
  emptyRatingText?: string
  idlePromptText?: string
}

/** Render the shared suggestion list for prompt and rating search scopes. */
export function SearchSuggestionList({
  searchScope,
  searchInput,
  promptSuggestions,
  filteredRatingTiers,
  suggestionsLoading,
  ratingTiersLoading,
  onSubmitInput,
  onSelectSuggestion,
  onSelectRatingTier,
  emptyPromptText = '일치하는 추천 프롬프트가 아직 없어.',
  emptyRatingText = '사용 가능한 평가 티어가 없어.',
  idlePromptText = '먼저 검색어를 입력하면 추천 프롬프트가 보여.',
}: SearchSuggestionListProps) {
  if (searchScope !== 'rating') {
    return (
      <>
        {searchInput.trim().length > 0 ? (
          <button
            type="button"
            onClick={onSubmitInput}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-surface-high"
          >
            <span className="text-sm text-foreground">&quot;{searchInput.trim()}&quot; 검색</span>
            <span className="text-xs text-muted-foreground">Enter</span>
          </button>
        ) : null}

        {suggestionsLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">추천 항목을 불러오는 중…</div> : null}
        {!suggestionsLoading && searchInput.trim().length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{idlePromptText}</div> : null}
        {!suggestionsLoading && searchInput.trim().length > 0 && promptSuggestions.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{emptyPromptText}</div> : null}
        {!suggestionsLoading && promptSuggestions.length > 0
          ? promptSuggestions.map((item) => (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                onClick={() => onSelectSuggestion(item)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
              >
                <span className="truncate text-sm text-secondary">{item.prompt}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</span>
              </button>
            ))
          : null}
      </>
    )
  }

  return (
    <>
      {ratingTiersLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">평가 티어를 불러오는 중…</div> : null}
      {!ratingTiersLoading && filteredRatingTiers.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{emptyRatingText}</div> : null}
      {!ratingTiersLoading && filteredRatingTiers.length > 0
        ? filteredRatingTiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              onClick={() => onSelectRatingTier(tier)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
            >
              <span className="text-sm font-semibold" style={tier.color ? { color: tier.color } : undefined}>
                {tier.tier_name}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground">
                {tier.min_score}~{tier.max_score === null ? '∞' : tier.max_score}
              </span>
            </button>
          ))
        : null}
    </>
  )
}
