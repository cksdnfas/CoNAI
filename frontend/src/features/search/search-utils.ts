import type { CSSProperties } from 'react'
import { getThemeToneStyle } from '@/lib/theme-tones'
import { SEARCH_AI_TOOL_OPTIONS } from './search-constants'
import type { RatingTierRecord, SearchAiToolGroup, SearchChip, SearchOperator, SearchScope } from './search-types'

const SEARCH_OPERATOR_SEQUENCE: SearchOperator[] = ['OR', 'AND', 'NOT']
const SEARCH_AI_TOOL_OPTION_BY_VALUE = new Map<SearchAiToolGroup, (typeof SEARCH_AI_TOOL_OPTIONS)[number]>(
  SEARCH_AI_TOOL_OPTIONS.map((option) => [option.value, option]),
)

const SEARCH_SCOPE_STYLE_BY_SCOPE: Record<SearchScope, CSSProperties> = {
  positive: getThemeToneStyle('positive'),
  negative: getThemeToneStyle('negative'),
  auto: getThemeToneStyle('auto'),
  rating: getThemeToneStyle('rating'),
  model: {
    backgroundColor: 'color-mix(in srgb, var(--primary) 12%, transparent)',
    color: 'color-mix(in srgb, var(--primary) 88%, white 4%)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 24%, transparent)',
  },
  lora: {
    backgroundColor: 'color-mix(in srgb, var(--secondary) 14%, transparent)',
    color: 'color-mix(in srgb, var(--secondary) 88%, white 2%)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--secondary) 24%, transparent)',
  },
  tool: {
    backgroundColor: 'color-mix(in srgb, #f59e0b 14%, transparent)',
    color: 'color-mix(in srgb, #f59e0b 90%, white 2%)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, #f59e0b 28%, transparent)',
  },
}

function getSearchChipScoreRange(chip: Pick<SearchChip, 'minScore' | 'maxScore'>) {
  return {
    ...(Number.isFinite(chip.minScore) ? { min_score: chip.minScore } : {}),
    ...(Number.isFinite(chip.maxScore) ? { max_score: chip.maxScore } : {}),
  }
}

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

/** Create a text-driven search chip using the shared search semantics. */
export function createTextSearchChip(scope: Exclude<SearchScope, 'rating' | 'tool'>, value: string, options?: { operator?: SearchOperator }) {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return null
  }

  if (scope === 'model') {
    return {
      id: createSearchChipId(scope),
      scope,
      operator: options?.operator ?? 'OR',
      label: trimmedValue,
      value: trimmedValue,
      conditionCategory: 'basic',
      conditionType: 'model_name',
    } satisfies SearchChip
  }

  if (scope === 'lora') {
    return {
      id: createSearchChipId(scope),
      scope,
      operator: options?.operator ?? 'OR',
      label: trimmedValue,
      value: trimmedValue,
      conditionCategory: 'basic',
      conditionType: 'lora_model',
    } satisfies SearchChip
  }

  return {
    id: createSearchChipId(scope),
    scope,
    operator: options?.operator ?? 'OR',
    label: buildSearchChipLabel(scope, trimmedValue),
    value: trimmedValue,
  } satisfies SearchChip
}

/** Create a fixed AI-tool group chip (NAI / ComfyUI / Other). */
export function createAIToolSearchChip(tool: SearchAiToolGroup, options?: { operator?: SearchOperator }) {
  const option = SEARCH_AI_TOOL_OPTION_BY_VALUE.get(tool)
  if (!option) {
    return null
  }

  return {
    id: createSearchChipId('tool'),
    scope: 'tool',
    operator: options?.operator ?? 'OR',
    label: option.label,
    value: option.value,
    conditionCategory: 'basic',
    conditionType: 'ai_tool_group',
  } satisfies SearchChip
}

/** Normalize legacy/raw AI tool values into the grouped Tool tab values when possible. */
export function normalizeAIToolGroupValue(value: string): SearchAiToolGroup | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'nai' || normalized === 'novelai') {
    return 'nai'
  }

  if (normalized === 'comfyui') {
    return 'comfyui'
  }

  return null
}

/** Create a rating-tier search chip using the shared rating semantics. */
export function createRatingSearchChip(tier: RatingTierRecord, options?: { operator?: SearchOperator }) {
  return {
    id: createSearchChipId('rating'),
    scope: 'rating',
    operator: options?.operator ?? 'OR',
    label: tier.tier_name,
    value: tier.tier_name,
    minScore: tier.min_score,
    maxScore: tier.max_score,
    color: tier.color ?? null,
  } satisfies SearchChip
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
export function buildSearchHistoryLabel(chips: SearchChip[], options?: { resolveScopeLabel?: (scope: SearchScope) => string }) {
  return chips
    .map((chip) => {
      const prefix = chip.operator === 'NOT' ? 'NOT' : chip.operator
      const scopeLabel = options?.resolveScopeLabel?.(chip.scope) ?? chip.scope
      return `${prefix} ${scopeLabel} ${chip.label}`
    })
    .join(' · ')
    .slice(0, 180)
}

/** Resolve the shared pill/toggle style for each search scope. */
export function getSearchScopeStyle(scope: SearchScope): CSSProperties {
  return SEARCH_SCOPE_STYLE_BY_SCOPE[scope]
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
        ...getSearchChipScoreRange(chip),
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
      ...getSearchChipScoreRange(chip),
    })
  }

  return filter
}
