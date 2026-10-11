import { getBuiltinNodeFamily, getWorkflowModuleBaseDisplayName, listBuiltinNodeVariants, type BuiltinNodeModule } from './workflowNodeVariants'

type VariantPort = { key: string; label?: string; data_type: string; multiple?: boolean }
type VariantField = VariantPort & { options?: Array<string | { value: string }>; min?: number; max?: number }
export type VariantWorkflowModule = BuiltinNodeModule & {
  id: number
  name?: string
  exposed_inputs: VariantPort[]
  output_ports: VariantPort[]
  ui_schema?: VariantField[] | null
}
export type VariantWorkflowGraph = {
  nodes: Array<{ id: string; module_id: number; label?: string; input_values?: Record<string, unknown>; run_input?: { enabled: boolean } }>
  edges: Array<{ id: string; source_node_id: string; source_port_key: string; target_node_id: string; target_port_key: string }>
  metadata?: { exposed_inputs?: Array<{ node_id: string; port_key: string; data_type: string; module_id?: number; module_name?: string }> }
}

function compatible(source: string, target: string) {
  return source === target || source === 'any' || target === 'any'
    || (source === 'text' && target === 'prompt') || (source === 'prompt' && target === 'text')
}
function hasValue(value: unknown) { return value !== undefined && value !== null && value !== '' }
function inputPort(module: VariantWorkflowModule, key: string): VariantPort | undefined {
  const direct = module.exposed_inputs.find((port) => port.key === key)
  if (direct) return direct
  const operation = module.internal_fixed_values?.operation_key ?? module.template_defaults?.operation_key
  const parentKey = operation === 'system.random_text_choice' && key.startsWith('options.') ? 'options'
    : operation === 'system.api_request' && key.startsWith('values.') ? 'values'
      : operation === 'system.api_request' && key.startsWith('headers.') ? 'headers' : null
  const parent = parentKey && module.exposed_inputs.find((port) => port.key === parentKey)
  return parent && key.length > parentKey!.length + 1 ? { ...parent, key, data_type: parentKey === 'headers' ? 'text' : 'any', multiple: false } : undefined
}
function field(module: VariantWorkflowModule, key: string): VariantField | undefined {
  return module.ui_schema?.find((entry) => entry.key === key) ?? inputPort(module, key)
}
function acceptsValue(source: VariantField, target: VariantField, value: unknown) {
  const sourceType = source.data_type === 'select' ? 'text' : source.data_type
  const targetType = target.data_type === 'select' ? 'text' : target.data_type
  if (!compatible(sourceType, targetType)) return false
  if (target.options?.length && !target.options.some((option) => (typeof option === 'string' ? option : option.value) === value)) return false
  if (targetType === 'number') {
    const numeric = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
    if (!Number.isFinite(numeric) || target.min !== undefined && numeric < target.min || target.max !== undefined && numeric > target.max) return false
  }
  if (targetType === 'boolean' && typeof value !== 'boolean') return false
  if ((targetType === 'text' || targetType === 'prompt') && typeof value !== 'string') return false
  return true
}

/** An explicit variant change never drops stored values, links or public run inputs. Callers may clear them first. */
export function applyBuiltinNodeVariant<T extends VariantWorkflowGraph>(
  graph: T,
  modules: readonly VariantWorkflowModule[],
  nodeId: string,
  variantId: string,
): T {
  const node = graph.nodes.find((entry) => entry.id === nodeId)
  const source = node && modules.find((entry) => entry.id === node.module_id)
  const family = source && getBuiltinNodeFamily(source)
  const selection = family && listBuiltinNodeVariants(modules, family.id).find((entry) => entry.variant.id === variantId)
  if (!node || !source || !selection) throw new Error('같은 기본 노드 그룹에서 사용할 수 있는 변형을 선택해줘.')
  const { module: target, variant } = selection
  const values = node.input_values ?? {}
  const nextValues: Record<string, unknown> = {}
  const impacts = new Set<string>()
  const sourceInput = source.exposed_inputs[0]
  const targetInput = target.exposed_inputs[0]
  const publicInput = node.run_input?.enabled === true || values.__workflow_input_enabled === true || values.__workflow_input_enabled === 'true'
  const sameRunInput = family?.id === 'value' && sourceInput && targetInput
    && sourceInput.key === targetInput.key && sourceInput.data_type === targetInput.data_type
  if (publicInput && !sameRunInput) impacts.add('실행 입력으로 공개된 값의 포트·타입')
  for (const exposed of graph.metadata?.exposed_inputs ?? []) {
    if (exposed.node_id !== nodeId) continue
    const port = inputPort(target, exposed.port_key)
    if (!port || exposed.data_type !== port.data_type) impacts.add(`실행 입력 ${exposed.port_key}`)
  }
  for (const [key, value] of Object.entries(values)) {
    if (Object.prototype.hasOwnProperty.call(variant.inputValues, key)) continue
    if (source.id === target.id || key.startsWith('__workflow_input_') || key === '__advanced_output_ports_enabled') {
      nextValues[key] = value
      continue
    }
    const from = field(source, key), to = field(target, key)
    if (from && to && (!hasValue(value) || acceptsValue(from, to, value))) nextValues[key] = value
    else if (hasValue(value)) impacts.add(`입력 ${from?.label ?? key}`)
  }
  const moduleByNode = new Map(graph.nodes.map((entry) => [entry.id, entry.id === nodeId ? target : modules.find((candidate) => candidate.id === entry.module_id)]))
  for (const edge of graph.edges) {
    if (edge.source_node_id !== nodeId && edge.target_node_id !== nodeId) continue
    const fromModule = moduleByNode.get(edge.source_node_id), toModule = moduleByNode.get(edge.target_node_id)
    const from = fromModule?.output_ports.find((port) => port.key === edge.source_port_key)
    const to = toModule && inputPort(toModule, edge.target_port_key)
    const count = graph.edges.filter((entry) => entry.target_node_id === edge.target_node_id && entry.target_port_key === edge.target_port_key).length
    if (!from || !to || !compatible(from.data_type, to.data_type) || !to.multiple && count > 1) {
      impacts.add(`연결 ${edge.source_port_key} → ${edge.target_port_key}`)
    }
  }
  if (impacts.size) throw new Error(`변형을 바꾸면 유지할 수 없는 항목이 있어: ${[...impacts].join(', ')}. 해당 값·연결을 직접 정리하거나 실행 입력 공개를 해제한 뒤 다시 선택해줘.`)
  Object.assign(nextValues, variant.inputValues)
  const label = node.label?.trim()
  const defaultLabel = source.id !== target.id && label && (label === source.name || label === getWorkflowModuleBaseDisplayName(source))
  return {
    ...graph,
    nodes: graph.nodes.map((entry) => entry.id === nodeId ? { ...entry, module_id: target.id, input_values: nextValues, ...(defaultLabel ? { label: getWorkflowModuleBaseDisplayName(target) } : {}) } : entry),
    ...(graph.metadata ? { metadata: {
      ...graph.metadata,
      ...(graph.metadata.exposed_inputs ? { exposed_inputs: graph.metadata.exposed_inputs.map((entry) => entry.node_id === nodeId
        ? { ...entry, module_id: target.id, ...(target.name ? { module_name: target.name } : {}) } : entry) } : {}),
    } } : {}),
  }
}
