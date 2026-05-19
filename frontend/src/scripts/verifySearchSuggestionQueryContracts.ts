import * as assert from 'node:assert/strict'
import {
  isPromptSuggestionScope,
  shouldEnableSearchSuggestionQuery,
  type SearchSuggestionQueryKind,
} from '../features/search/search-suggestion-query-policy'
import type { SearchScope } from '../features/search/search-types'

const scopes: SearchScope[] = ['positive', 'negative', 'auto', 'rating', 'model', 'lora', 'tool']
const promptScopes: SearchScope[] = ['positive', 'negative', 'auto']
const nonPromptScopes = scopes.filter((scope) => !promptScopes.includes(scope))

for (const scope of promptScopes) {
  assert.equal(isPromptSuggestionScope(scope), true, `${scope} should be a prompt suggestion scope`)
  assert.equal(
    shouldEnableSearchSuggestionQuery('prompt', scope, 'cat'),
    true,
    `${scope} suggestions should run when the user typed a prompt query`,
  )
  assert.equal(
    shouldEnableSearchSuggestionQuery('prompt', scope, ''),
    false,
    `${scope} suggestions should stay idle for empty prompt input`,
  )
}

for (const scope of nonPromptScopes) {
  assert.equal(isPromptSuggestionScope(scope), false, `${scope} should not be a prompt suggestion scope`)
  assert.equal(
    shouldEnableSearchSuggestionQuery('prompt', scope, 'cat'),
    false,
    `${scope} should not run prompt suggestions in a hidden tab`,
  )
}

const queryKinds: SearchSuggestionQueryKind[] = ['rating', 'model', 'lora']
const expectedScopeByKind: Record<SearchSuggestionQueryKind, SearchScope | null> = {
  prompt: null,
  rating: 'rating',
  model: 'model',
  lora: 'lora',
}

for (const kind of queryKinds) {
  for (const scope of scopes) {
    assert.equal(
      shouldEnableSearchSuggestionQuery(kind, scope, ''),
      scope === expectedScopeByKind[kind],
      `${kind} suggestions should only run while the ${expectedScopeByKind[kind]} tab is active`,
    )
  }
}

console.log('Search suggestion query contracts verified.')
