import type { SearchChip, SearchOperator, SearchScope } from '@/features/home/search-types'
import { createSearchChipId } from '@/features/home/search-utils'

interface FilterConditionLike {
  category?: string
  type?: string
  value?: unknown
  min_score?: number
  max_score?: number | null
}

interface ComplexFilterLike {
  exclude_group?: FilterConditionLike[]
  or_group?: FilterConditionLike[]
  and_group?: FilterConditionLike[]
}

export interface ParsedAutoCollectChipState {
  initialMode: 'chip' | 'json'
  chips: SearchChip[]
  jsonText: string
  warningMessage: string | null
}

/** Convert a supported auto-collect condition into the shared search-chip shape. */
function buildSearchChipFromCondition(condition: FilterConditionLike, operator: SearchOperator): SearchChip | null {
  let scope: SearchScope | null = null

  if (condition.type === 'prompt_contains') {
    scope = 'positive'
  } else if (condition.type === 'negative_prompt_contains') {
    scope = 'negative'
  } else if (condition.type === 'auto_tag_any') {
    scope = 'auto'
  } else if (condition.type === 'auto_tag_rating_score') {
    scope = 'rating'
  }

  if (!scope) {
    return null
  }

  const rawValue = typeof condition.value === 'string' || typeof condition.value === 'number'
    ? String(condition.value)
    : ''
  const value = rawValue.trim()
  if (!value) {
    return null
  }

  return {
    id: createSearchChipId(scope),
    scope,
    operator,
    label: value,
    value,
    minScore: condition.min_score,
    maxScore: condition.max_score,
  }
}

/** Parse a ComplexFilter-like payload into editable search chips when every rule is supported. */
function parseComplexFilterChips(filter: ComplexFilterLike) {
  const chips: SearchChip[] = []
  const groupEntries: Array<[SearchOperator, FilterConditionLike[] | undefined]> = [
    ['NOT', filter.exclude_group],
    ['OR', filter.or_group],
    ['AND', filter.and_group],
  ]

  for (const [operator, conditions] of groupEntries) {
    for (const condition of conditions ?? []) {
      const chip = buildSearchChipFromCondition(condition, operator)
      if (!chip) {
        return null
      }
      chips.push(chip)
    }
  }

  return chips
}

/** Parse stored auto-collect JSON into either chip mode or JSON fallback mode. */
export function parseAutoCollectChipState(autoCollectJsonText?: string | null): ParsedAutoCollectChipState {
  const jsonText = autoCollectJsonText?.trim() ?? ''
  if (!jsonText) {
    return {
      initialMode: 'chip',
      chips: [],
      jsonText: '',
      warningMessage: null,
    }
  }

  try {
    const parsedValue = JSON.parse(jsonText) as ComplexFilterLike | FilterConditionLike[]

    if (Array.isArray(parsedValue)) {
      const chips = parseComplexFilterChips({ or_group: parsedValue })
      if (!chips) {
        return {
          initialMode: 'json',
          chips: [],
          jsonText,
          warningMessage: '기존 자동수집 규칙에 칩 편집기로 표현 못 하는 조건이 있어서 JSON 직접 편집 모드로 열었어.',
        }
      }

      return {
        initialMode: 'chip',
        chips,
        jsonText: JSON.stringify({ or_group: parsedValue, and_group: [], exclude_group: [] }, null, 2),
        warningMessage: null,
      }
    }

    const chips = parseComplexFilterChips(parsedValue)
    if (!chips) {
      return {
        initialMode: 'json',
        chips: [],
        jsonText: JSON.stringify(parsedValue, null, 2),
        warningMessage: '기존 자동수집 규칙에 칩 편집기로 표현 못 하는 조건이 있어서 JSON 직접 편집 모드로 열었어.',
      }
    }

    return {
      initialMode: 'chip',
      chips,
      jsonText: JSON.stringify(parsedValue, null, 2),
      warningMessage: null,
    }
  } catch {
    return {
      initialMode: 'json',
      chips: [],
      jsonText,
      warningMessage: '저장된 자동수집 JSON을 파싱하지 못해서 직접 편집 모드로 열었어.',
    }
  }
}
