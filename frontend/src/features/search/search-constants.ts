import type { SearchAiToolOption, SearchScope } from './search-types'

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

export const SEARCH_TEXT_INPUT_SCOPES: SearchScope[] = ['positive', 'negative', 'auto', 'model', 'lora']

export const SEARCH_AI_TOOL_OPTIONS: SearchAiToolOption[] = [
  { value: 'nai', label: 'NAI', aliases: ['NovelAI', 'NAI'] },
  { value: 'comfyui', label: 'ComfyUI', aliases: ['ComfyUI'] },
  { value: 'other', label: 'Other', aliases: ['Other'] },
]

export function isTextInputSearchScope(scope: SearchScope) {
  return SEARCH_TEXT_INPUT_SCOPES.includes(scope)
}
