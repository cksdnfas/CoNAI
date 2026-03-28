import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchAiToolGroup, SearchMetadataSuggestion, SearchScope } from '@/features/search/search-types'

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

function SuggestionActionRow({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high">
      <span className="truncate text-sm text-foreground">{label}</span>
      {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
    </button>
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
  emptyPromptText = '일치하는 추천 프롬프트가 아직 없어.',
  emptyRatingText = '사용 가능한 평가 티어가 없어.',
  idlePromptText = '먼저 검색어를 입력하면 추천 프롬프트가 보여.',
}: SearchSuggestionListProps) {
  if (searchScope === 'positive' || searchScope === 'negative' || searchScope === 'auto') {
    return (
      <>
        {searchInput.trim().length > 0 ? <SuggestionActionRow label={`"${searchInput.trim()}" 추가`} hint="Enter" onClick={onSubmitInput} /> : null}

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

  if (searchScope === 'rating') {
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
  const metadataLabel = searchScope === 'model' ? '모델' : 'LoRA'
  const metadataEmptyText = searchInput.trim().length > 0 ? `일치하는 ${metadataLabel}이 없어.` : `추천 ${metadataLabel}이 아직 없어.`

  return (
    <>
      {searchInput.trim().length > 0 ? <SuggestionActionRow label={`"${searchInput.trim()}" 추가`} hint="Enter" onClick={onSubmitInput} /> : null}
      {metadataLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">{metadataLabel} 추천을 불러오는 중…</div> : null}
      {!metadataLoading && metadataSuggestions.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">{metadataEmptyText}</div> : null}
      {!metadataLoading && metadataSuggestions.length > 0
        ? metadataSuggestions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onSelectMetadataSuggestion(item.value)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
            >
              <span className="truncate text-sm text-secondary">{item.value}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{item.count.toLocaleString('ko-KR')}</span>
            </button>
          ))
        : null}
    </>
  )
}
