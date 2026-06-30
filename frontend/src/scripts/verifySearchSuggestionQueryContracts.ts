import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAIToolSearchChip, getSearchScopeStyle } from '../features/search/search-utils'
import { isPromptSuggestionScope, shouldEnableSearchSuggestionQuery, type SearchSuggestionQueryKind } from '../features/search/search-suggestion-query-policy'
import type { SearchScope } from '../features/search/search-types'

const searchSuggestionDataSource = readFileSync(
  resolve(process.cwd(), 'src/features/search/use-search-suggestion-data.ts'),
  'utf8',
)

assert.match(
  searchSuggestionDataSource,
  /const SEARCH_SUGGESTION_INPUT_DEBOUNCE_MS = 180/,
  'search suggestion network queries should wait for a short input-settle window instead of firing on every keystroke',
)
assert.match(
  searchSuggestionDataSource,
  /function useDebouncedSearchInput\(value: string\)[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?setDebouncedValue\(value\)[\s\S]*?SEARCH_SUGGESTION_INPUT_DEBOUNCE_MS/,
  'search suggestion debounce should publish the latest settled input through one shared hook',
)
assert.match(
  searchSuggestionDataSource,
  /queryKey: \['search-suggestions', searchScope, debouncedInput\][\s\S]*?query: debouncedInput/,
  'prompt suggestion queries should use the settled input in both cache key and request payload',
)
assert.match(
  searchSuggestionDataSource,
  /queryKey: \['search-model-suggestions', debouncedInput\][\s\S]*?getSearchModelSuggestions\(\{ query: debouncedInput, limit: 16 \}\)/,
  'model suggestions should use the settled input in both cache key and request payload',
)
assert.match(
  searchSuggestionDataSource,
  /ratingTiers\.filter\(\(tier\) => matchesRatingTierSearch\(tier\.tier_name, tier\.min_score, tier\.max_score, normalizedInput\.toLowerCase\(\)\)\)/,
  'rating tier suggestions should filter locally by the visible input instead of showing the full tier list while typing',
)

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

for (const scope of scopes) {
  assert.strictEqual(
    getSearchScopeStyle(scope),
    getSearchScopeStyle(scope),
    `${scope} style should be served from the stable search-scope style lookup`,
  )
}

const comfyChip = createAIToolSearchChip('comfyui', { operator: 'AND' })
assert.equal(comfyChip?.label, 'ComfyUI', 'AI tool chip creation should resolve labels through the indexed option lookup')
assert.equal(comfyChip?.operator, 'AND', 'AI tool chip creation should preserve requested operators')
assert.equal(comfyChip?.conditionType, 'ai_tool_group', 'AI tool chips should keep backend condition semantics')

console.log('Search suggestion query and utility contracts verified.')
