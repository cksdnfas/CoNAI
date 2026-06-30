import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildComplexFilterPayload, createTextSearchChip, cycleSearchOperator } from '../features/search/search-utils'
import type { SearchChip } from '../features/search/search-types'

const root = resolve(process.cwd(), 'src')
const homeSearchUi = readFileSync(resolve(root, 'features/home/components/home-search-ui.tsx'), 'utf8')
const homeSearchContext = readFileSync(resolve(root, 'features/home/home-search-context.tsx'), 'utf8')
const homePage = readFileSync(resolve(root, 'features/home/home-page.tsx'), 'utf8')
const homePageData = readFileSync(resolve(root, 'features/home/use-home-page-data.ts'), 'utf8')
const imageList = readFileSync(resolve(root, 'features/images/components/image-list/image-list.tsx'), 'utf8')
const searchSuggestionData = readFileSync(resolve(root, 'features/search/use-search-suggestion-data.ts'), 'utf8')

assert.ok(
  homeSearchUi.includes('let homeSearchDrawerContentLoadPromise'),
  'home search drawer lazy import should be cached for preload and click paths',
)
assert.ok(
  homeSearchUi.includes("import('./home-search-drawer-content')"),
  'home search drawer content should remain split behind a dynamic import',
)
assert.ok(
  homeSearchUi.includes('homeSearchDrawerContentLoadPromise = null'),
  'home search drawer loader should reset after chunk-load failures so retries still work',
)
assert.ok(
  homeSearchUi.includes('const HomeSearchDrawerContentLazy = lazy(loadHomeSearchDrawerContent)'),
  'React.lazy must use the shared cached drawer loader',
)
assert.match(
  homeSearchUi,
  /void loadHomeSearchDrawerContent\(\)\s*\n\s*openDrawer\(\)/,
  'header open should start loading the drawer chunk before setting open state',
)
assert.ok(
  homeSearchUi.includes('scheduleHomeSearchDrawerContentPreload'),
  'drawer chunk should have a scheduled preload path',
)
assert.ok(
  homeSearchUi.includes('requestIdleCallback') && homeSearchUi.includes('{ timeout: 2500 }'),
  'scheduled preload should prefer requestIdleCallback with a timeout',
)
assert.ok(
  homeSearchUi.includes('window.setTimeout') && homeSearchUi.includes('}, 1200)'),
  'scheduled preload should fall back to a delayed timer when idle callbacks are unavailable',
)
assert.match(
  homeSearchUi,
  /useEffect\(\(\) => \{\s*if \(!active\) \{\s*return\s*}\s*return scheduleHomeSearchDrawerContentPreload\(\)/,
  'drawer preload should only be scheduled while the home search surface is active',
)
assert.ok(
  homeSearchContext.includes('type AddScopedTextChipOptions = { operator?: SearchOperator; apply?: boolean }'),
  'scoped text chips should support an immediate apply option',
)
assert.match(
  homeSearchContext,
  /if \(options\?\.apply\) \{\s*commitSearchChips\(nextDraftChips\)\s*setIsDrawerOpen\(false\)/,
  'immediate scoped tag filters should apply search results and close the drawer',
)
assert.ok(
  homePageData.includes('imageListResetKey') && homePage.includes('resetKey={imageListResetKey}'),
  'home search result list should receive a reset key when the active filter set changes',
)
assert.ok(
  imageList.includes("key={`masonry:${resetKey ?? 'stable'}`}") && imageList.includes("key={`grid:${resetKey ?? 'stable'}`}"),
  'image list virtualizers should remount from the reset key so stale filter layouts cannot render blank lists',
)
assert.match(
  searchSuggestionData,
  /const SEARCH_SUGGESTION_INPUT_DEBOUNCE_MS = 180[\s\S]*?function useDebouncedSearchInput\(value: string\)[\s\S]*?window\.setTimeout[\s\S]*?window\.clearTimeout/,
  'network-backed suggestion queries should debounce fast typing before hitting prompt/model/LoRA endpoints',
)
assert.match(
  searchSuggestionData,
  /queryKey: \['search-suggestions', searchScope, debouncedInput\][\s\S]*?query: debouncedInput/,
  'prompt suggestions should query with the debounced input snapshot',
)
assert.match(
  searchSuggestionData,
  /queryKey: \['search-model-suggestions', debouncedInput\][\s\S]*?getSearchModelSuggestions\(\{ query: debouncedInput, limit: 16 \}\)/,
  'model suggestions should query with the debounced input snapshot',
)
assert.match(
  searchSuggestionData,
  /matchesRatingTierSearch\(tier\.tier_name, tier\.min_score, tier\.max_score, normalizedInput\.toLowerCase\(\)\)/,
  'rating suggestions should filter locally instead of sending extra network queries while typing',
)
assert.match(
  searchSuggestionData,
  /suggestionsLoading: shouldEnableSearchSuggestionQuery\('prompt', searchScope, normalizedInput\) && \(isInputSettling \|\| promptSuggestionsQuery\.isLoading\)/,
  'suggestion loading state should reflect the current raw input while the debounced query settles',
)

const defaultTextChip = createTextSearchChip('positive', 'crow \\la+ darknesss\\')
assert.equal(defaultTextChip?.operator, 'AND', 'new text search chips should default to AND')
assert.equal(cycleSearchOperator('AND'), 'OR', 'operator toggle should move from default AND to OR')
assert.deepEqual(
  defaultTextChip ? buildComplexFilterPayload([defaultTextChip]).and_group : [],
  [{ category: 'positive_prompt', type: 'prompt_contains', value: 'crow \\la+ darknesss\\' }],
  'default text search payload should target and_group',
)

const unboundedRatingChip: SearchChip = {
  id: 'rating-nsfw',
  scope: 'rating',
  operator: 'OR',
  label: 'NSFW',
  value: 'NSFW',
  minScore: 15,
  maxScore: null,
}
const unboundedRatingPayload = buildComplexFilterPayload([unboundedRatingChip])
const unboundedRatingCondition = unboundedRatingPayload.or_group[0]
assert.equal(unboundedRatingCondition?.min_score, 15, 'rating payload should keep finite min_score')
assert.equal(
  Object.prototype.hasOwnProperty.call(unboundedRatingCondition, 'max_score'),
  false,
  'unbounded rating payload should omit null max_score instead of sending max_score: null',
)

const boundedRatingChip: SearchChip = {
  ...unboundedRatingChip,
  id: 'rating-safe',
  label: 'Safe-ish',
  value: 'Safe-ish',
  minScore: 0,
  maxScore: 5,
}
const boundedRatingPayload = buildComplexFilterPayload([boundedRatingChip])
assert.equal(boundedRatingPayload.or_group[0]?.max_score, 5, 'rating payload should keep finite max_score')

console.log('Home search contracts verified.')
