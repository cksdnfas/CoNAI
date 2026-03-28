import type { SearchAiToolOption, SearchScope } from './search-types'

export const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'negative', label: '부정' },
  { value: 'auto', label: '오토' },
  { value: 'rating', label: '평가' },
  { value: 'model', label: '모델' },
  { value: 'lora', label: 'LoRA' },
  { value: 'tool', label: 'Tool' },
]

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  positive: '긍정',
  negative: '부정',
  auto: '오토',
  rating: '평가',
  model: '모델',
  lora: 'LoRA',
  tool: 'Tool',
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
