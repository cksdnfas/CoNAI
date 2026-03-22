import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchChip, SearchHistoryEntry, SearchScope } from '../search-types'

interface HomeSearchPanelProps {
  searchScope: SearchScope
  searchInput: string
  draftChips: SearchChip[]
  suggestions: PromptCollectionItem[]
  ratingTiers: RatingTierRecord[]
  historyEntries: SearchHistoryEntry[]
  suggestionsLoading: boolean
  historyLoading: boolean
  onSearchScopeChange: (scope: SearchScope) => void
  onSearchInputChange: (value: string) => void
  onAddTextChip: () => void
  onAddSuggestionChip: (item: PromptCollectionItem) => void
  onAddRatingChip: (tier: RatingTierRecord) => void
  onCycleChipOperator: (chipId: string) => void
  onRemoveChip: (chipId: string) => void
  onApplySearch: () => void
  onClearSearch: () => void
  onSelectHistoryEntry: (entry: SearchHistoryEntry) => void
  onDeleteHistoryEntry: (entryId: string) => void
  onClearHistory: () => void
}

const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'negative', label: '부정' },
  { value: 'auto', label: '오토' },
  { value: 'rating', label: '평가' },
]

/** Render the interactive home search builder with chips, suggestions, and history. */
export function HomeSearchPanel({
  searchScope,
  searchInput,
  draftChips,
  suggestions,
  ratingTiers,
  historyEntries,
  suggestionsLoading,
  historyLoading,
  onSearchScopeChange,
  onSearchInputChange,
  onAddTextChip,
  onAddSuggestionChip,
  onAddRatingChip,
  onCycleChipOperator,
  onRemoveChip,
  onApplySearch,
  onClearSearch,
  onSelectHistoryEntry,
  onDeleteHistoryEntry,
  onClearHistory,
}: HomeSearchPanelProps) {
  return (
    <Card className="space-y-5 bg-surface-container p-5">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Search Builder</div>
        <p className="text-sm text-muted-foreground">칩을 추가하고, 칩을 눌러 OR → AND → NOT으로 바꾼 뒤 검색을 적용하면 돼.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3 text-sm font-semibold">
        {SEARCH_SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onSearchScopeChange(tab.value)}
            className={cn(
              'rounded-sm px-3 py-1.5 transition-colors',
              searchScope === tab.value ? 'bg-primary text-primary-foreground' : 'bg-surface-highest text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {searchScope !== 'rating' ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row">
            <input
              value={searchInput}
              onChange={(event) => onSearchInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onAddTextChip()
                }
              }}
              placeholder={searchScope === 'positive' ? '긍정 프롬프트 검색어 입력…' : searchScope === 'negative' ? '부정 프롬프트 검색어 입력…' : '오토 태그 검색어 입력…'}
              className="h-11 w-full rounded-sm border border-white/10 bg-surface-lowest px-4 text-sm text-foreground outline-none transition focus:border-primary"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onAddTextChip}>
                칩 추가
              </Button>
              <Button type="button" onClick={onApplySearch}>
                검색 적용
              </Button>
            </div>
          </div>

          <div className="rounded-sm border border-white/5 bg-surface-lowest p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">추천 항목</div>
            {suggestionsLoading ? <div className="text-sm text-muted-foreground">추천을 불러오는 중…</div> : null}
            {!suggestionsLoading && suggestions.length === 0 ? (
              <div className="text-sm text-muted-foreground">검색어를 입력하면 기존 수집 프롬프트 후보를 보여줄게.</div>
            ) : null}
            {!suggestionsLoading && suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => onAddSuggestionChip(item)}
                    className="rounded-sm border border-white/10 bg-surface-highest px-3 py-2 text-left text-sm text-foreground transition hover:border-primary"
                  >
                    <span>{item.prompt}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {ratingTiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                onClick={() => onAddRatingChip(tier)}
                className="min-w-[140px] rounded-sm border border-white/10 bg-surface-lowest px-4 py-3 text-left transition hover:border-primary"
              >
                <div className="text-base font-semibold" style={tier.color ? { color: tier.color } : undefined}>
                  {tier.tier_name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {tier.min_score}~{tier.max_score === null ? '∞' : tier.max_score}
                </div>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={onApplySearch}>
              검색 적용
            </Button>
            <Button type="button" variant="outline" onClick={onClearSearch}>
              검색 초기화
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-sm border border-white/5 bg-surface-lowest p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">적용 예정 칩</div>
        {draftChips.length === 0 ? <div className="text-sm text-muted-foreground">아직 추가된 검색 칩이 없어.</div> : null}
        {draftChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {draftChips.map((chip) => (
              <div key={chip.id} className="flex items-center gap-2 rounded-sm border border-white/10 bg-surface-highest px-3 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => onCycleChipOperator(chip.id)}
                  className="rounded-sm bg-background px-2 py-1 text-[11px] font-bold tracking-[0.16em] text-primary"
                >
                  {chip.operator}
                </button>
                <span style={chip.color ? { color: chip.color } : undefined}>{chip.label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveChip(chip.id)}
                  className="text-muted-foreground transition hover:text-foreground"
                  aria-label={`${chip.label} 삭제`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApplySearch}>
          검색 적용
        </Button>
        <Button type="button" variant="outline" onClick={onClearSearch}>
          검색 초기화
        </Button>
      </div>

      <div className="rounded-sm border border-white/5 bg-surface-lowest p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">검색 히스토리</div>
          <Button type="button" variant="outline" onClick={onClearHistory} disabled={historyEntries.length === 0}>
            전체 삭제
          </Button>
        </div>

        {historyLoading ? <div className="text-sm text-muted-foreground">히스토리를 불러오는 중…</div> : null}
        {!historyLoading && historyEntries.length === 0 ? <div className="text-sm text-muted-foreground">저장된 검색 히스토리가 아직 없어.</div> : null}
        {!historyLoading && historyEntries.length > 0 ? (
          <div className="space-y-2">
            {historyEntries.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-sm border border-white/5 bg-surface-highest px-3 py-3">
                <button type="button" onClick={() => onSelectHistoryEntry(entry)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-foreground">{entry.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(entry.updatedAt).toLocaleString('ko-KR')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteHistoryEntry(entry.id)}
                  className="text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
