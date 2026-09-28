import type { SearchChip, SearchOperator, SearchScope } from '@/features/search/search-types'
import { createSearchChipId } from '@/features/search/search-utils'

/** Query parameter on the Home route that carries the applied search chips. */
export const HOME_SEARCH_QUERY_PARAM = 'q'

const SEARCH_SCOPES: ReadonlySet<SearchScope> = new Set(['positive', 'negative', 'auto', 'rating', 'model', 'lora', 'tool'])
const SEARCH_OPERATORS: ReadonlySet<SearchOperator> = new Set(['OR', 'AND', 'NOT'])
const MAX_URL_SEARCH_CHIPS = 50

interface EncodedSearchChipExtras {
  l?: string
  min?: number
  max?: number | null
  c?: string
  cc?: string
  ct?: string
}

/** Compact chip form kept in the URL: [scope, operator, value, extras?]. Ids are regenerated on read. */
type EncodedSearchChip = [SearchScope, SearchOperator, string, EncodedSearchChipExtras?]

function encodeSearchChip(chip: SearchChip): EncodedSearchChip {
  const extras: EncodedSearchChipExtras = {}
  if (chip.label !== chip.value) extras.l = chip.label
  if (typeof chip.minScore === 'number') extras.min = chip.minScore
  if (chip.maxScore !== undefined) extras.max = chip.maxScore
  if (chip.color) extras.c = chip.color
  if (chip.conditionCategory) extras.cc = chip.conditionCategory
  if (chip.conditionType) extras.ct = chip.conditionType

  return Object.keys(extras).length > 0 ? [chip.scope, chip.operator, chip.value, extras] : [chip.scope, chip.operator, chip.value]
}

function decodeSearchChip(entry: unknown): SearchChip | null {
  if (!Array.isArray(entry)) return null

  const [scope, operator, value, rawExtras] = entry as unknown[]
  if (!SEARCH_SCOPES.has(scope as SearchScope) || !SEARCH_OPERATORS.has(operator as SearchOperator)) return null
  if (typeof value !== 'string' || value.trim().length === 0) return null

  const extras = rawExtras && typeof rawExtras === 'object' ? rawExtras as Record<string, unknown> : {}
  const chip: SearchChip = {
    id: createSearchChipId(scope as SearchScope),
    scope: scope as SearchScope,
    operator: operator as SearchOperator,
    label: typeof extras.l === 'string' && extras.l.length > 0 ? extras.l : value,
    value,
  }

  if (typeof extras.min === 'number' && Number.isFinite(extras.min)) chip.minScore = extras.min
  if (extras.max === null || (typeof extras.max === 'number' && Number.isFinite(extras.max))) chip.maxScore = extras.max
  if (typeof extras.c === 'string') chip.color = extras.c
  if (typeof extras.cc === 'string') chip.conditionCategory = extras.cc
  if (typeof extras.ct === 'string') chip.conditionType = extras.ct

  return chip
}

/** Serialize applied chips into the Home `q` parameter value ('' when there is no search). */
export function encodeSearchChipsParam(chips: SearchChip[]) {
  return chips.length > 0 ? JSON.stringify(chips.map(encodeSearchChip)) : ''
}

/** Parse a Home `q` parameter value, dropping anything malformed instead of failing the page. */
export function decodeSearchChipsParam(value: string): SearchChip[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    return parsed
      .slice(0, MAX_URL_SEARCH_CHIPS)
      .map(decodeSearchChip)
      .filter((chip): chip is SearchChip => chip !== null)
  } catch {
    return []
  }
}

/** Read the raw `q` value from a location search string. */
export function readSearchChipsParam(search: string) {
  return new URLSearchParams(search).get(HOME_SEARCH_QUERY_PARAM) ?? ''
}

/** Build the Home location search string for a `q` value. */
export function buildHomeSearchString(query: string) {
  return query ? `?${new URLSearchParams({ [HOME_SEARCH_QUERY_PARAM]: query }).toString()}` : ''
}
