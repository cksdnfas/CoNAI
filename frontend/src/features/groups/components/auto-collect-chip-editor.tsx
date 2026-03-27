import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { searchPromptCollection, getRatingTiers } from '@/lib/api'
import { getThemeToneStyle } from '@/lib/theme-tones'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchChip, SearchOperator, SearchScope } from '@/features/home/search-types'
import { buildComplexFilterPayload, buildSearchChipKey, buildSearchChipLabel, createSearchChipId, cycleSearchOperator } from '@/features/home/search-utils'
import { parseAutoCollectChipState } from '@/features/groups/auto-collect-chip-utils'
import { cn } from '@/lib/utils'

const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'auto', label: '오토' },
  { value: 'negative', label: '부정' },
  { value: 'rating', label: '평가' },
]

const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  positive: '긍정',
  negative: '부정',
  auto: '오토',
  rating: '평가',
}

interface AutoCollectEditorState {
  mode: 'chip' | 'json'
  parsedValue: unknown
  errorMessage: string | null
}

interface AutoCollectChipEditorProps {
  initialJsonText?: string | null
  onChange: (state: AutoCollectEditorState) => void
}

/** Create a new search chip for auto-collect editing. */
function createAutoCollectChip(scope: SearchScope, operator: SearchOperator, value: string, ratingTier?: RatingTierRecord): SearchChip | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return null
  }

  return {
    id: createSearchChipId(scope),
    scope,
    operator,
    label: scope === 'rating' ? ratingTier?.tier_name ?? trimmedValue : buildSearchChipLabel(scope, trimmedValue),
    value: trimmedValue,
    minScore: ratingTier?.min_score,
    maxScore: ratingTier?.max_score,
    color: ratingTier?.color ?? null,
  }
}

/** Render the group auto-collect editor with chip-first and JSON fallback modes. */
export function AutoCollectChipEditor({ initialJsonText, onChange }: AutoCollectChipEditorProps) {
  const [mode, setMode] = useState<'chip' | 'json'>('chip')
  const [searchScope, setSearchScope] = useState<SearchScope>('positive')
  const [searchInput, setSearchInput] = useState('')
  const [basicInput, setBasicInput] = useState('')
  const [chips, setChips] = useState<SearchChip[]>([])
  const [jsonText, setJsonText] = useState('')
  const [warningMessage, setWarningMessage] = useState<string | null>(null)

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['group-auto-collect-suggestions', searchScope, searchInput],
    queryFn: () =>
      searchPromptCollection({
        query: searchInput,
        type: searchScope === 'rating' ? 'positive' : searchScope,
        page: 1,
        limit: 16,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      }),
    enabled: searchScope !== 'rating' && searchInput.trim().length > 0,
  })

  useEffect(() => {
    const parsedState = parseAutoCollectChipState(initialJsonText)
    setMode(parsedState.initialMode)
    setChips(parsedState.chips)
    setJsonText(parsedState.jsonText)
    setWarningMessage(parsedState.warningMessage)
    setSearchInput('')
    setBasicInput('')
    setSearchScope('positive')
  }, [initialJsonText])

  useEffect(() => {
    if (mode === 'chip') {
      onChange({
        mode,
        parsedValue: chips.length > 0 ? buildComplexFilterPayload(chips) : undefined,
        errorMessage: null,
      })
      return
    }

    const trimmedJsonText = jsonText.trim()
    if (!trimmedJsonText) {
      onChange({ mode, parsedValue: undefined, errorMessage: null })
      return
    }

    try {
      onChange({
        mode,
        parsedValue: JSON.parse(trimmedJsonText),
        errorMessage: null,
      })
    } catch {
      onChange({
        mode,
        parsedValue: undefined,
        errorMessage: '자동수집 조건 JSON 형식이 올바르지 않아.',
      })
    }
  }, [chips, jsonText, mode, onChange])

  const ratingTiers = ratingTiersQuery.data ?? []
  const promptSuggestions = promptSuggestionsQuery.data?.items ?? []
  const filteredRatingTiers = useMemo(() => ratingTiers, [ratingTiers])

  const appendChip = (chip: SearchChip | null) => {
    if (!chip) {
      return
    }

    setChips((current) => {
      const nextKey = buildSearchChipKey(chip)
      if (current.some((item) => buildSearchChipKey(item) === nextKey && item.operator === chip.operator)) {
        return current
      }
      return [...current, chip]
    })
    setSearchInput('')
  }

  const addTextChip = () => {
    if (searchScope === 'rating') {
      return
    }

    appendChip(createAutoCollectChip(searchScope, 'OR', searchInput))
  }

  const addSuggestionChip = (item: PromptCollectionItem) => {
    appendChip(createAutoCollectChip(searchScope, 'OR', item.prompt))
  }

  const addRatingChip = (tier: RatingTierRecord) => {
    appendChip(createAutoCollectChip('rating', 'OR', tier.tier_name, tier))
  }

  const addBasicChip = (conditionType: 'ai_tool' | 'model_name') => {
    const trimmedValue = basicInput.trim()
    if (!trimmedValue) {
      return
    }

    appendChip({
      id: createSearchChipId('positive'),
      scope: 'positive',
      scopeLabel: '기본',
      operator: 'OR',
      label: conditionType === 'ai_tool' ? `AI Tool: ${trimmedValue}` : `Model: ${trimmedValue}`,
      value: trimmedValue,
      conditionCategory: 'basic',
      conditionType,
    })
    setBasicInput('')
  }

  return (
    <div className="space-y-4 rounded-sm border border-border/70 bg-surface-low/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">자동수집 조건</p>
          <p className="text-xs text-muted-foreground">기본은 검색칩 방식으로 편집하고, 복잡한 규칙은 JSON 직접 편집으로 내려가면 돼.</p>
        </div>

        <div className="inline-flex rounded-sm border border-border bg-background p-1">
          <button
            type="button"
            className={cn('rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors', mode === 'chip' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground')}
            onClick={() => setMode('chip')}
          >
            검색칩 편집
          </button>
          <button
            type="button"
            className={cn('rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors', mode === 'json' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground')}
            onClick={() => setMode('json')}
          >
            JSON 직접 편집
          </button>
        </div>
      </div>

      {warningMessage ? (
        <Alert>
          <AlertTitle>참고</AlertTitle>
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      ) : null}

      {mode === 'chip' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {SEARCH_SCOPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSearchScope(tab.value)}
                className={cn('rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors', searchScope === tab.value ? '' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground')}
                style={searchScope === tab.value ? getThemeToneStyle(tab.value) : undefined}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {searchScope !== 'rating' ? (
            <div className="flex gap-2">
              <div className="theme-settings-control flex flex-1 items-center rounded-sm border border-border bg-surface-lowest text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addTextChip()
                    }
                  }}
                  placeholder="자동수집에 쓸 키워드를 넣어줘"
                  className="h-10 w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Button type="button" variant="secondary" onClick={addTextChip}>
                칩 추가
              </Button>
            </div>
          ) : null}

          <div className="space-y-2 rounded-sm border border-border/70 bg-background/60 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Basic conditions</p>
              <p className="mt-1 text-xs text-muted-foreground">AI Tool / Model 기준 자동수집도 여기서 바로 추가할 수 있어.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="theme-settings-control flex min-w-[220px] flex-1 items-center rounded-sm border border-border bg-surface-lowest text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]">
                <input
                  value={basicInput}
                  onChange={(event) => setBasicInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addBasicChip('ai_tool')
                    }
                  }}
                  placeholder="예: NovelAI / SDXL / pony"
                  className="h-10 w-full bg-transparent px-3 outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Button type="button" variant="secondary" onClick={() => addBasicChip('ai_tool')}>
                AI Tool 추가
              </Button>
              <Button type="button" variant="secondary" onClick={() => addBasicChip('model_name')}>
                Model 추가
              </Button>
            </div>
          </div>

          <div className="rounded-sm border border-border/70 bg-background/60">
            <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {searchScope === 'rating' ? 'Rating tiers' : 'Prompt suggestions'}
            </div>
            <div className="max-h-56 overflow-y-auto py-2">
              {searchScope !== 'rating' ? (
                <>
                  {promptSuggestionsQuery.isLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">추천 항목을 불러오는 중…</div> : null}
                  {!promptSuggestionsQuery.isLoading && searchInput.trim().length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">먼저 검색어를 입력하면 추천 프롬프트가 보여.</div> : null}
                  {!promptSuggestionsQuery.isLoading && searchInput.trim().length > 0 && promptSuggestions.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">일치하는 추천 프롬프트가 아직 없어.</div> : null}
                  {!promptSuggestionsQuery.isLoading && promptSuggestions.length > 0
                    ? promptSuggestions.map((item) => (
                        <button
                          key={`${item.type}-${item.id}`}
                          type="button"
                          onClick={() => addSuggestionChip(item)}
                          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
                        >
                          <span className="truncate text-sm text-secondary">{item.prompt}</span>
                          <span className="shrink-0 text-sm text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</span>
                        </button>
                      ))
                    : null}
                </>
              ) : (
                <>
                  {ratingTiersQuery.isLoading ? <div className="px-4 py-4 text-sm text-muted-foreground">평가 티어를 불러오는 중…</div> : null}
                  {!ratingTiersQuery.isLoading && filteredRatingTiers.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">사용 가능한 평가 티어가 없어.</div> : null}
                  {!ratingTiersQuery.isLoading && filteredRatingTiers.length > 0
                    ? filteredRatingTiers.map((tier) => (
                        <button
                          key={tier.id}
                          type="button"
                          onClick={() => addRatingChip(tier)}
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
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current filters</div>
            {chips.length === 0 ? <div className="rounded-sm border border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">아직 추가된 조건 칩이 없어.</div> : null}
            {chips.length > 0 ? (
              <div className="space-y-2">
                {chips.map((chip) => (
                  <div key={chip.id} className="flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-3">
                    <span className="rounded-sm px-2 py-1 text-[11px] font-semibold tracking-[0.08em]" style={getThemeToneStyle(chip.scope)}>
                      {chip.scopeLabel ?? SEARCH_SCOPE_LABELS[chip.scope]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChips((current) => current.map((item) => (item.id === chip.id ? { ...item, operator: cycleSearchOperator(item.operator) } : item)))}
                      className="rounded-sm border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.16em] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] transition hover:border-primary/55 hover:bg-primary/18 active:scale-[0.98]"
                    >
                      {chip.operator}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground" style={chip.color ? { color: chip.color } : undefined}>
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChips((current) => current.filter((item) => item.id !== chip.id))}
                      className="text-muted-foreground transition hover:text-foreground"
                      aria-label={`${chip.label} 삭제`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <Textarea
          rows={12}
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          placeholder={[
            '{',
            '  "or_group": [',
            '    { "category": "auto_tag", "type": "auto_tag_any", "value": "1girl" }',
            '  ],',
            '  "and_group": [],',
            '  "exclude_group": []',
            '}',
          ].join('\n')}
        />
      )}
    </div>
  )
}
