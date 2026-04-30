import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { SEARCH_SCOPE_LABEL_KEYS, isTextInputSearchScope } from '@/features/search/search-constants'
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
import { useI18n } from '@/i18n'

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

function getSearchScopePlaceholder(scope: SearchScope, t: ReturnType<typeof useI18n>['t']) {
  switch (scope) {
    case 'positive':
      return t({ ko: '긍정 프롬프트', en: 'Positive prompt' })
    case 'negative':
      return t({ ko: '부정 프롬프트', en: 'Negative prompt' })
    case 'auto':
      return t({ ko: '오토 태그', en: 'Auto tag' })
    case 'model':
      return t({ ko: '모델명', en: 'Model name' })
    case 'lora':
      return t({ ko: 'LoRA 이름', en: 'LoRA name' })
    default:
      return ''
  }
}

/** Render the group auto-collect editor with chip-first and JSON fallback modes. */
export function AutoCollectChipEditor({ initialJsonText, onChange }: AutoCollectChipEditorProps) {
  const { t } = useI18n()
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
    setWarningMessage(
      parsedState.warningMessage === 'parse-error'
        ? t({ ko: '저장된 자동수집 JSON을 파싱하지 못해서 직접 편집 모드로 열었어.', en: 'Could not parse the saved auto-collect JSON, so it opened in direct edit mode.' })
        : parsedState.warningMessage === 'unsupported-condition'
          ? t({ ko: '기존 자동수집 규칙에 칩 편집기로 표현 못 하는 조건이 있어서 JSON 직접 편집 모드로 열었어.', en: 'Some existing auto-collect conditions cannot be represented in the chip editor, so it opened in direct JSON edit mode.' })
          : null,
    )
    setSearchInput('')
    setSearchScope('positive')
    setIsSuggestionPanelOpen(false)
  }, [initialJsonText, t])

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
        errorMessage: t('groups.components.auto.collect.chip.editor.the.auto.collect.condition.json.is.not'),
      })
    }
  }, [chips, jsonText, mode, onChange, t])

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
      return t('groups.components.auto.collect.chip.editor.rating.tier')
    }
    if (searchScope === 'tool') {
      return t({ ko: 'AI Tool', en: 'AI Tool' })
    }
    return t({ ko: '{scopeLabel} 추천', en: '{scopeLabel} suggestions' }, { scopeLabel: t(SEARCH_SCOPE_LABEL_KEYS[searchScope]) })
  }, [searchScope, t])

  const isTextInputScope = isTextInputSearchScope(searchScope)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{t('groups.components.auto.collect.chip.editor.auto.collect.conditions')}</p>

        <SegmentedControl
          value={mode}
          items={[
            { value: 'chip', label: t('groups.components.auto.collect.chip.editor.edit.search.chips') },
            { value: 'json', label: t('groups.components.auto.collect.chip.editor.edit.json.directly') },
          ]}
          onChange={(nextMode) => setMode(nextMode as AutoCollectEditorState['mode'])}
          size="xs"
        />
      </div>

      {warningMessage ? (
        <Alert>
          <AlertTitle>{t('groups.components.auto.collect.chip.editor.note')}</AlertTitle>
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      ) : null}

      {mode === 'chip' ? (
        <div className="space-y-4">
          <section ref={searchSectionRef} className="space-y-3">
            <div className="theme-settings-control theme-input-surface flex items-center rounded-sm border text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]">
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
                placeholder={isTextInputScope ? getSearchScopePlaceholder(searchScope, t) : searchSectionTitle}
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
                    aria-label={t('groups.components.auto.collect.chip.editor.close.input.filter')}
                    title={t('groups.components.auto.collect.chip.editor.close.input.filter')}
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
                    emptyRatingText={t('groups.components.auto.collect.chip.editor.no.rating.tiers.available')}
                    idlePromptText={t('groups.components.auto.collect.chip.editor.enter.a.search.term')}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <SearchChipList
            chips={chips}
            emptyMessage={t('groups.components.auto.collect.chip.editor.no.condition.chips.yet')}
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
