import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  GraphWorkflowStoppedError,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

type CompareOperator = 'equals' | 'not_equals' | 'greater_than' | 'greater_than_or_equal' | 'less_than' | 'less_than_or_equal'
type TextMatchMode = 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex'
type ValuePresenceMode = 'exists' | 'empty' | 'not_empty'

/** Normalize a workflow value into a boolean for logic operations. */
function normalizeBooleanValue(value: unknown, label: string) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }

  throw new Error(`${label} 입력은 불리언 값이어야 해`)
}

/** Normalize one workflow value into text without losing primitive values. */
function normalizeTextValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  try {
    const jsonText = JSON.stringify(value)
    if (typeof jsonText === 'string') {
      return jsonText
    }
  } catch {
    // Fall back to string coercion below.
  }

  return String(value)
}

/** Decide whether a workflow value should count as present. */
function hasWorkflowValue(value: unknown) {
  if (value === undefined || value === null) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0
  }

  return true
}

/** Store system node outputs and write the shared completion log. */
function completeSystemNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  operationKey: string,
  nodeArtifacts: Record<string, RuntimeArtifact>,
) {
  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Build one boolean artifact for logic nodes. */
function completeBooleanLogicNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  operationKey: string,
  value: boolean,
) {
  const nodeArtifacts = {
    result: buildRuntimeArtifact(context.executionId, node.id, 'result', 'boolean', value, {
      kind: 'system-logic-operation',
      operationKey,
    }),
  }

  completeSystemNode(context, node, moduleDefinition, operationKey, nodeArtifacts)
}

/** Execute a boolean AND operation. */
export function executeLogicAndNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const left = normalizeBooleanValue(resolvedInputs.left, 'AND A')
  const right = normalizeBooleanValue(resolvedInputs.right, 'AND B')
  completeBooleanLogicNode(context, node, moduleDefinition, 'system.logic_and', left && right)
}

/** Execute a boolean OR operation. */
export function executeLogicOrNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const left = normalizeBooleanValue(resolvedInputs.left, 'OR A')
  const right = normalizeBooleanValue(resolvedInputs.right, 'OR B')
  completeBooleanLogicNode(context, node, moduleDefinition, 'system.logic_or', left || right)
}

/** Execute a boolean NOT operation. */
export function executeLogicNotNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const value = normalizeBooleanValue(resolvedInputs.value, 'NOT 값')
  completeBooleanLogicNode(context, node, moduleDefinition, 'system.logic_not', !value)
}

/** Compare two workflow values with the configured operator. */
function compareWorkflowValues(leftValue: unknown, rightValue: unknown, operator: CompareOperator) {
  if (operator === 'equals') {
    return JSON.stringify(leftValue) === JSON.stringify(rightValue)
  }

  if (operator === 'not_equals') {
    return JSON.stringify(leftValue) !== JSON.stringify(rightValue)
  }

  const leftNumber = Number(leftValue)
  const rightNumber = Number(rightValue)
  const leftComparable = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber : normalizeTextValue(leftValue)
  const rightComparable = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? rightNumber : normalizeTextValue(rightValue)

  if (operator === 'greater_than') {
    return leftComparable > rightComparable
  }

  if (operator === 'greater_than_or_equal') {
    return leftComparable >= rightComparable
  }

  if (operator === 'less_than') {
    return leftComparable < rightComparable
  }

  return leftComparable <= rightComparable
}

/** Execute a generic comparison operation. */
export function executeLogicCompareNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operator = typeof resolvedInputs.operator === 'string' ? resolvedInputs.operator : 'equals'
  const normalizedOperator: CompareOperator = [
    'equals',
    'not_equals',
    'greater_than',
    'greater_than_or_equal',
    'less_than',
    'less_than_or_equal',
  ].includes(operator) ? operator as CompareOperator : 'equals'

  completeBooleanLogicNode(
    context,
    node,
    moduleDefinition,
    'system.logic_compare',
    compareWorkflowValues(resolvedInputs.left, resolvedInputs.right, normalizedOperator),
  )
}

/** Match text using simple string modes or a regular expression. */
function matchTextValue(text: string, query: string, mode: TextMatchMode) {
  if (mode === 'not_contains') {
    return !text.includes(query)
  }

  if (mode === 'starts_with') {
    return text.startsWith(query)
  }

  if (mode === 'ends_with') {
    return text.endsWith(query)
  }

  if (mode === 'regex') {
    try {
      return new RegExp(query).test(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 정규식 오류'
      throw new Error(`텍스트 매치 노드 정규식 설정이 올바르지 않아: ${message}`)
    }
  }

  return text.includes(query)
}

/** Execute a text matching operation. */
export function executeLogicTextMatchNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const mode = typeof resolvedInputs.mode === 'string' ? resolvedInputs.mode : 'contains'
  const normalizedMode: TextMatchMode = ['contains', 'not_contains', 'starts_with', 'ends_with', 'regex'].includes(mode)
    ? mode as TextMatchMode
    : 'contains'

  completeBooleanLogicNode(
    context,
    node,
    moduleDefinition,
    'system.logic_text_match',
    matchTextValue(normalizeTextValue(resolvedInputs.text), normalizeTextValue(resolvedInputs.query), normalizedMode),
  )
}

/** Execute a value presence check. */
export function executeLogicValuePresenceNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const mode = typeof resolvedInputs.mode === 'string' ? resolvedInputs.mode : 'exists'
  const normalizedMode: ValuePresenceMode = ['exists', 'empty', 'not_empty'].includes(mode) ? mode as ValuePresenceMode : 'exists'
  const exists = hasWorkflowValue(resolvedInputs.value)
  const result = normalizedMode === 'exists' ? exists : normalizedMode === 'empty' ? !exists : exists

  completeBooleanLogicNode(context, node, moduleDefinition, 'system.logic_value_presence', result)
}

/** Select one of two upstream values based on a boolean condition. */
export function executeLogicConditionSelectNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const condition = normalizeBooleanValue(resolvedInputs.condition, '조건 선택 조건')
  const value = condition ? resolvedInputs.true_value : resolvedInputs.false_value
  const nodeArtifacts = {
    value: buildRuntimeArtifact(context.executionId, node.id, 'value', 'any', value, {
      kind: 'system-logic-operation',
      operationKey: 'system.logic_condition_select',
      selectedBranch: condition ? 'true' : 'false',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.logic_condition_select', nodeArtifacts)
}

/** Stop workflow execution when the condition evaluates to true. */
export function executeWorkflowStopNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const shouldStop = normalizeBooleanValue(resolvedInputs.condition, '중단 조건')
  const reason = normalizeTextValue(resolvedInputs.reason).trim()

  if (!shouldStop) {
    completeSystemNode(context, node, moduleDefinition, 'system.workflow_stop', {})
    return
  }

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    level: 'warn',
    eventType: 'workflow_stop_requested',
    message: reason ? `Workflow stop requested: ${reason}` : 'Workflow stop requested',
    details: {
      operationKey: 'system.workflow_stop',
      reason: reason || null,
    },
  })

  throw new GraphWorkflowStoppedError(reason || undefined)
}
