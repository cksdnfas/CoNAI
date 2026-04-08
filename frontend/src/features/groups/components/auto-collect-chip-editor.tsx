import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { SEARCH_SCOPE_LABELS, isTextInputSearchScope } from '@/features/search/search-constants'
import { useSearchSuggestionData } from '@/features/search/use-search-suggestion-data'
import type { SearchChip, SearchOperator, SearchScope } from '@/features/search/search-types'
import {
  buildComplexFilterPayload,
  buildSearchChipKey,
  createAIToolSearchChip,
  createRatingSearchChip,
  createTextSearchChip,
  cycleSearchOperator,
} from '@/features/search/search-utils'
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
  if (scope === 'rating' || scope === 'tool') {
    return null
  }

  const chip = createTextSearchChip(scope, value, { operator })
  return chip ? { ...chip } : null
}

const SEARCH_SCOPE_PLACEHOLDERS: Partial<Record<SearchScope, string>> = {
  positive: '긍정 프롬프트',
  negative: '부정 프롬프트',
  auto: '오토 태그',
  model: '모델명',
  lora: 'LoRA 이름',
}

/** Render the group auto-collect editor with chip-first and JSON fallback modes. */
export function AutoCollectChipEditor({ initialJsonText, onChange }: AutoCollectChipEditorProps) {
  const [mode, setMode] = useState<'chip' | 'json'>('chip')
  const [searchScope, setSearchScope] = useState<SearchScope>('positive')
  const [searchInput, setSearchInput] = useState('')
  const [chips, setChips] = useState<SearchChip[]>([])
  const [jsonText, setJsonText] = useState('')
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [isSuggestionPanelOpen, setIsSuggestionPanelOpen] = useState(false)
  const searchSectionRef = useRef<HTMLElement | null>(null)

  const {
    promptSuggestions,
    filteredRatingTiers,
    modelSuggestions,
    loraSuggestions,
    suggestionsLoading,
    ratingTiersLoading,
    modelSuggestionsLoading,
    loraSuggestionsLoading,
  } = useSearchSuggestionData(searchScope, searchInput)

  useEffect(() => {
    const parsedState = parseAutoCollectChipState(initialJsonText)
    setMode(parsedState.initialMode)
    setChips(parsedState.chips)
    setJsonText(parsedState.jsonText)
    setWarningMessage(parsedState.warningMessage)
    setSearchInput('')
    setSearchScope('positive')
    setIsSuggestionPanelOpen(false)
  }, [initialJsonText])

  useEffect(() => {
    if (!isSuggestionPanelOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!searchSectionRef.current?.contains(event.target as Node)) {
        setIsSuggestionPanelOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isSuggestionPanelOpen])

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
    setIsSuggestionPanelOpen(false)
  }

  const submitSearchInput = () => {
    appendChip(createAutoCollectChip(searchScope, 'OR', searchInput))
  }

  const searchSectionTitle = useMemo(() => {
    if (searchScope === 'rating') {
      return '평가 티어'
    }
    if (searchScope === 'tool') {
      return 'AI Tool'
    }
    return `${SEARCH_SCOPE_LABELS[searchScope]} 추천`
  }, [searchScope])

  const isTextInputScope = isTextInputSearchScope(searchScope)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">자동수집 조건</p>

        <SegmentedControl
          value={mode}
          items={[
            { value: 'chip', label: '검색칩 편집' },
            { value: 'json', label: 'JSON 직접 편집' },
          ]}
          onChange={(nextMode) => setMode(nextMode as AutoCollectEditorState['mode'])}
          size="xs"
        />
      </div>

      {warningMessage ? (
        <Alert>
          <AlertTitle>참고</AlertTitle>
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      ) : null}

      {mode === 'chip' ? (
        <div className="space-y-4">
          <section ref={searchSectionRef} className="space-y-3">
            <div className="theme-settings-control flex items-center rounded-sm border border-border bg-surface-container text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]">
              <Search className="mr-2 h-4 w-4 text-muted-foreground" />
              <input
                value={searchInput}
                onFocus={() => setIsSuggestionPanelOpen(true)}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitSearchInput()
                  }
                }}
                placeholder={isTextInputScope ? SEARCH_SCOPE_PLACEHOLDERS[searchScope] : searchSectionTitle}
                className="h-10 w-full bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>

            {isSuggestionPanelOpen ? (
              <div className="theme-floating-panel overflow-hidden rounded-sm">
                <div className="flex items-center gap-2 border-b border-white/5 px-[var(--theme-panel-padding-x)] py-[calc(var(--theme-panel-padding-y)_-_0.125rem)]">
                  <div className="min-w-0 flex-1">
                    <SearchScopeTabs searchScope={searchScope} onChange={setSearchScope} />
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSuggestionPanelOpen(false)}
                    className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground"
                    aria-label="입력 필터 닫기"
                    title="입력 필터 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-[420px] overflow-y-auto py-2">
                  <SearchSuggestionList
                    searchScope={searchScope}
                    searchInput={searchInput}
                    promptSuggestions={promptSuggestions}
                    filteredRatingTiers={filteredRatingTiers}
                    modelSuggestions={modelSuggestions}
                    loraSuggestions={loraSuggestions}
                    suggestionsLoading={suggestionsLoading}
                    ratingTiersLoading={ratingTiersLoading}
                    modelSuggestionsLoading={modelSuggestionsLoading}
                    loraSuggestionsLoading={loraSuggestionsLoading}
                    onSubmitInput={submitSearchInput}
                    onSelectSuggestion={(item) => appendChip(createAutoCollectChip(searchScope, 'OR', item.prompt))}
                    onSelectMetadataSuggestion={(value) => appendChip(createAutoCollectChip(searchScope, 'OR', value))}
                    onSelectRatingTier={(tier) => appendChip(createRatingSearchChip(tier, { operator: 'OR' }))}
                    onSelectAIToolSuggestion={(tool) => appendChip(createAIToolSearchChip(tool, { operator: 'OR' }))}
                    emptyRatingText="사용 가능한 평가 티어가 없어."
                    idlePromptText="검색어 입력"
                  />
                </div>
              </div>
            ) : null}
          </section>

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
          placeholder="{ ... }"
        />
      )}
    </div>
  )
}
