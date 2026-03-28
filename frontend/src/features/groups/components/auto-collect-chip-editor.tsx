import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { useSearchSuggestionData } from '@/features/search/use-search-suggestion-data'
import type { SearchChip, SearchOperator, SearchScope } from '@/features/search/search-types'
import { buildComplexFilterPayload, buildSearchChipKey, createRatingSearchChip, createTextSearchChip, cycleSearchOperator } from '@/features/search/search-utils'
import { parseAutoCollectChipState } from '@/features/groups/auto-collect-chip-utils'

interface AutoCollectEditorState {
  mode: 'chip' | 'json'
  parsedValue: unknown
  errorMessage: string | null
}

interface AutoCollectChipEditorProps {
  initialJsonText?: string | null
  onChange: (state: AutoCollectEditorState) => void
}

/** Create a search chip for the auto-collect editor using the shared search-chip model. */
function createAutoCollectChip(scope: SearchScope, operator: SearchOperator, value: string): SearchChip | null {
  if (scope === 'rating') {
    return null
  }

  const chip = createTextSearchChip(scope, value, { operator })
  return chip ? { ...chip } : null
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

  const { promptSuggestions, filteredRatingTiers, suggestionsLoading, ratingTiersLoading } = useSearchSuggestionData(searchScope, searchInput)

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
    appendChip(createAutoCollectChip(searchScope, 'OR', searchInput))
  }

  const addSuggestionChip = (value: string) => {
    appendChip(createAutoCollectChip(searchScope, 'OR', value))
  }

  const addRatingChip = (tierId: number) => {
    const tier = filteredRatingTiers.find((item) => item.id === tierId)
    if (!tier) {
      return
    }

    appendChip(createRatingSearchChip(tier, { operator: 'OR' }))
  }

  const addBasicChip = (conditionType: 'ai_tool' | 'model_name') => {
    const trimmedValue = basicInput.trim()
    if (!trimmedValue) {
      return
    }

    appendChip({
      id: `basic-${conditionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
          <p className="text-xs text-muted-foreground">검색과 같은 칩/연산자 체계를 공유하고, 복잡한 규칙만 JSON 직접 편집으로 내려가면 돼.</p>
        </div>

        <div className="inline-flex rounded-sm border border-border bg-background p-1">
          <button
            type="button"
            className={mode === 'chip' ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground' : 'rounded-sm px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-high hover:text-foreground'}
            onClick={() => setMode('chip')}
          >
            검색칩 편집
          </button>
          <button
            type="button"
            className={mode === 'json' ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground' : 'rounded-sm px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-high hover:text-foreground'}
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
          <SearchScopeTabs searchScope={searchScope} onChange={setSearchScope} />

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
              <SearchSuggestionList
                searchScope={searchScope}
                searchInput={searchInput}
                promptSuggestions={promptSuggestions}
                filteredRatingTiers={filteredRatingTiers}
                suggestionsLoading={suggestionsLoading}
                ratingTiersLoading={ratingTiersLoading}
                onSubmitInput={addTextChip}
                onSelectSuggestion={(item) => addSuggestionChip(item.prompt)}
                onSelectRatingTier={(tier) => addRatingChip(tier.id)}
              />
            </div>
          </div>

          <SearchChipList
            chips={chips}
            emptyMessage="아직 추가된 조건 칩이 없어."
            onCycleOperator={(chipId) => {
              setChips((current) => current.map((item) => (item.id === chipId ? { ...item, operator: cycleSearchOperator(item.operator) } : item)))
            }}
            onRemove={(chipId) => {
              setChips((current) => current.filter((item) => item.id !== chipId))
            }}
          />
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
