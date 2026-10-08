import type { ComplexFilter, FilterCondition } from '../types/filter'

/**
 * Chip-shaped auto-collect rules for assistants (MCP tools and the group page action).
 * They build the same ComplexFilter the group editor's chip mode saves, so a rule set written by an assistant opens
 * back as chips in the editor instead of falling back to raw JSON.
 */
export const GROUP_AUTO_COLLECT_SCOPES = ['positive', 'negative', 'auto_tag', 'model', 'lora', 'ai_tool'] as const
export const GROUP_AUTO_COLLECT_OPERATORS = ['AND', 'OR', 'NOT'] as const
export const GROUP_AUTO_COLLECT_AI_TOOLS = ['nai', 'comfyui', 'other'] as const
export const GROUP_AUTO_COLLECT_RULE_LIMIT = 64

export type GroupAutoCollectScope = typeof GROUP_AUTO_COLLECT_SCOPES[number]
export type GroupAutoCollectOperator = typeof GROUP_AUTO_COLLECT_OPERATORS[number]
export interface GroupAutoCollectRule {
  scope: GroupAutoCollectScope
  operator: GroupAutoCollectOperator
  value: string
}

const CONDITION_BY_SCOPE: Record<GroupAutoCollectScope, Pick<FilterCondition, 'category' | 'type'> & { range?: true }> = {
  positive: { category: 'positive_prompt', type: 'prompt_contains' },
  negative: { category: 'negative_prompt', type: 'negative_prompt_contains' },
  auto_tag: { category: 'auto_tag', type: 'auto_tag_any', range: true },
  model: { category: 'basic', type: 'model_name' },
  lora: { category: 'basic', type: 'lora_model' },
  ai_tool: { category: 'basic', type: 'ai_tool_group' },
}

/** Rules → stored filter. AND matches all, OR needs at least one, NOT excludes. Throws on an empty or unknown rule. */
export function buildGroupAutoCollectFilter(rules: readonly GroupAutoCollectRule[]): ComplexFilter {
  if (!rules.length) throw new Error('자동수집 조건이 하나 이상 필요해.')
  if (rules.length > GROUP_AUTO_COLLECT_RULE_LIMIT) throw new Error(`자동수집 조건은 ${GROUP_AUTO_COLLECT_RULE_LIMIT}개까지야.`)
  const filter = { exclude_group: [] as FilterCondition[], or_group: [] as FilterCondition[], and_group: [] as FilterCondition[] }
  for (const rule of rules) {
    const shape = CONDITION_BY_SCOPE[rule.scope]
    if (!shape) throw new Error(`알 수 없는 조건 종류야: ${String(rule.scope)}`)
    const target = rule.operator === 'NOT' ? filter.exclude_group : rule.operator === 'OR' ? filter.or_group : rule.operator === 'AND' ? filter.and_group : null
    if (!target) throw new Error(`알 수 없는 조건 연산이야: ${String(rule.operator)}`)
    const value = typeof rule.value === 'string' ? rule.value.trim() : ''
    if (!value) throw new Error('자동수집 조건 값이 비어 있어.')
    if (rule.scope === 'ai_tool' && !(GROUP_AUTO_COLLECT_AI_TOOLS as readonly string[]).includes(value)) throw new Error(`ai_tool 값은 ${GROUP_AUTO_COLLECT_AI_TOOLS.join(', ')} 중 하나야.`)
    target.push({ category: shape.category, type: shape.type, value, ...(shape.range ? { min_score: 0, max_score: 1 } : {}) })
  }
  return filter
}

/**
 * Stored conditions → rules. Returns [] when nothing is stored and null when the stored filter uses anything the rules
 * cannot express (legacy arrays, regex, rating scores, score ranges, ...), so callers never silently drop conditions.
 */
export function readGroupAutoCollectRules(stored: string | null | undefined): GroupAutoCollectRule[] | null {
  const text = stored?.trim()
  if (!text) return []
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const filter = parsed as Record<string, unknown>
  const rules: GroupAutoCollectRule[] = []
  const groups: Array<[GroupAutoCollectOperator, string]> = [['NOT', 'exclude_group'], ['OR', 'or_group'], ['AND', 'and_group']]
  for (const [operator, key] of groups) {
    const conditions = filter[key]
    if (conditions === undefined) continue
    if (!Array.isArray(conditions)) return null
    for (const condition of conditions as Array<Record<string, unknown>>) {
      const scope = (Object.keys(CONDITION_BY_SCOPE) as GroupAutoCollectScope[]).find((candidate) => CONDITION_BY_SCOPE[candidate].type === condition?.type)
      if (!scope || typeof condition.value !== 'string' || !condition.value.trim() || condition.case_sensitive || condition.exact_match) return null
      const range = CONDITION_BY_SCOPE[scope].range
      if (range ? (Number(condition.min_score ?? 0) !== 0 || Number(condition.max_score ?? 1) !== 1) : (condition.min_score !== undefined || condition.max_score !== undefined)) return null
      rules.push({ scope, operator, value: condition.value.trim() })
    }
  }
  return Object.keys(filter).every((key) => groups.some(([, name]) => name === key)) ? rules : null
}
