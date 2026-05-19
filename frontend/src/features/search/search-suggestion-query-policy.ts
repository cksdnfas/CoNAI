import type { SearchScope } from './search-types'

export type SearchSuggestionQueryKind = 'prompt' | 'rating' | 'model' | 'lora'
export type PromptSuggestionScope = Extract<SearchScope, 'positive' | 'negative' | 'auto'>

const PROMPT_SUGGESTION_SCOPES = new Set<SearchScope>(['positive', 'negative', 'auto'])

export function isPromptSuggestionScope(searchScope: SearchScope): searchScope is PromptSuggestionScope {
  return PROMPT_SUGGESTION_SCOPES.has(searchScope)
}

/** Keep network-backed suggestion queries scoped to the active tab instead of prefetching hidden panes. */
export function shouldEnableSearchSuggestionQuery(queryKind: SearchSuggestionQueryKind, searchScope: SearchScope, normalizedInput: string) {
  switch (queryKind) {
    case 'prompt':
      return isPromptSuggestionScope(searchScope) && normalizedInput.length > 0
    case 'rating':
      return searchScope === 'rating'
    case 'model':
      return searchScope === 'model'
    case 'lora':
      return searchScope === 'lora'
  }
}
