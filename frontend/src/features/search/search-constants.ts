import type { TranslationDictionary } from '@/i18n'
import type { SearchAiToolOption, SearchOperator, SearchScope } from './search-types'

export const SEARCH_SCOPE_TABS: Array<{ value: SearchScope }> = [
  { value: 'positive' },
  { value: 'negative' },
  { value: 'auto' },
  { value: 'rating' },
  { value: 'model' },
  { value: 'lora' },
  { value: 'tool' },
]

export const SEARCH_SCOPE_LABEL_KEYS: Record<SearchScope, string> = {
  positive: 'search.search.constants.positive',
  negative: 'search.search.constants.negative',
  auto: 'search.search.constants.auto',
  rating: 'search.search.constants.rating',
  model: 'search.search.constants.model',
  lora: 'search.search.constants.lora',
  tool: 'search.search.constants.tool',
}

/** Plain-language chip operator labels (AND = must match, OR = any of, NOT = exclude). */
export const SEARCH_OPERATOR_LABELS: Record<SearchOperator, TranslationDictionary> = {
  AND: { ko: '포함', en: 'Include' },
  OR: { ko: '또는', en: 'Any' },
  NOT: { ko: '제외', en: 'Exclude' },
}

export const SEARCH_OPERATOR_DESCRIPTIONS: Record<SearchOperator, TranslationDictionary> = {
  AND: { ko: '포함: 이 조건이 꼭 있어야 해', en: 'Include: images must match this' },
  OR: { ko: '또는: "또는" 조건 중 하나만 맞으면 돼', en: 'Any: images need to match at least one "Any" filter' },
  NOT: { ko: '제외: 이 조건이 있는 이미지는 빼', en: 'Exclude: images matching this are left out' },
}

export const SEARCH_OPERATOR_CYCLE_HINT: TranslationDictionary = {
  ko: '누를 때마다 포함 → 또는 → 제외 순으로 바뀌어',
  en: 'Click to switch Include → Any → Exclude',
}

export const SEARCH_TEXT_INPUT_SCOPES: SearchScope[] = ['positive', 'negative', 'auto', 'model', 'lora']

export const SEARCH_AI_TOOL_OPTIONS: SearchAiToolOption[] = [
  { value: 'nai', label: 'NAI', aliases: ['NovelAI', 'NAI'] },
  { value: 'comfyui', label: 'ComfyUI', aliases: ['ComfyUI'] },
  { value: 'other', label: 'Other', aliases: ['Other'] },
]

export function isTextInputSearchScope(scope: SearchScope) {
  return SEARCH_TEXT_INPUT_SCOPES.includes(scope)
}
