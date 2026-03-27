import type { SearchChip, SearchOperator, SearchScope } from './search-types'

const SEARCH_OPERATOR_SEQUENCE: SearchOperator[] = ['OR', 'AND', 'NOT']

/** Build a stable UI label for a search chip. */
export function buildSearchChipLabel(_scope: SearchScope, value: string) {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return ''
  }

  return trimmedValue
}

/** Create a stable browser-safe id for a search chip. */
export function createSearchChipId(scope: SearchScope) {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Rotate the operator order used by the search chip buttons. */
export function cycleSearchOperator(operator: SearchOperator): SearchOperator {
  const currentIndex = SEARCH_OPERATOR_SEQUENCE.indexOf(operator)
  return SEARCH_OPERATOR_SEQUENCE[(currentIndex + 1) % SEARCH_OPERATOR_SEQUENCE.length]
}

/** Create a dedupe key for chips that represent the same search condition. */
export function buildSearchChipKey(chip: Pick<SearchChip, 'scope' | 'value' | 'minScore' | 'maxScore' | 'conditionType'>) {
  return [chip.scope, chip.conditionType ?? '', chip.value.trim().toLowerCase(), chip.minScore ?? '', chip.maxScore ?? ''].join('::')
}

/** Build a compact label for persisted search history entries. */
export function buildSearchHistoryLabel(chips: SearchChip[]) {
  return chips
    .map((chip) => {
      const prefix = chip.operator === 'NOT' ? 'NOT' : chip.operator
      const scopeLabel = chip.scopeLabel ?? (chip.scope === 'positive' ? '긍정' : chip.scope === 'negative' ? '부정' : chip.scope === 'auto' ? '오토' : '평가')
      return `${prefix} ${scopeLabel} ${chip.label}`
    })
    .join(' · ')
    .slice(0, 180)
}

/** Convert UI chips into the backend complex filter payload. */
export function buildComplexFilterPayload(chips: SearchChip[]) {
  const filter = {
    exclude_group: [] as Array<Record<string, unknown>>,
    or_group: [] as Array<Record<string, unknown>>,
    and_group: [] as Array<Record<string, unknown>>,
  }

  for (const chip of chips) {
    const targetGroup = chip.operator === 'NOT' ? filter.exclude_group : chip.operator === 'AND' ? filter.and_group : filter.or_group

    if (chip.conditionCategory && chip.conditionType) {
      targetGroup.push({
        category: chip.conditionCategory,
        type: chip.conditionType,
        value: chip.value,
        ...(chip.minScore !== undefined ? { min_score: chip.minScore } : {}),
        ...(chip.maxScore !== undefined ? { max_score: chip.maxScore } : {}),
      })
      continue
    }

    if (chip.scope === 'positive') {
      targetGroup.push({
        category: 'positive_prompt',
        type: 'prompt_contains',
        value: chip.value,
      })
      continue
    }

    if (chip.scope === 'negative') {
      targetGroup.push({
        category: 'negative_prompt',
        type: 'negative_prompt_contains',
        value: chip.value,
      })
      continue
    }

    if (chip.scope === 'auto') {
      targetGroup.push({
        category: 'auto_tag',
        type: 'auto_tag_any',
        value: chip.value,
        min_score: 0,
        max_score: 1,
      })
      continue
    }

    targetGroup.push({
      category: 'auto_tag',
      type: 'auto_tag_rating_score',
      value: chip.value,
      ...(chip.minScore !== undefined ? { min_score: chip.minScore } : {}),
      ...(chip.maxScore !== undefined ? { max_score: chip.maxScore } : {}),
    })
  }

  return filter
}
