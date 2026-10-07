import type { ChatWorkflowDataType, ChatWorkflowField, ChatWorkflowModule, ChatWorkflowNode, ChatWorkflowOperation, ChatWorkflowPort, ChatWorkflowSnapshot, ChatWorkflowValue, ChatWorkflowChange } from '../types/chatWorkflow'

export const CHAT_WORKFLOW_LIMITS = { nodes: 128, edges: 512, operations: 80, text: 8000, snapshot: 120000, jsonDepth: 6 } as const
const PRIVATE_KEY = /password|secret|credential|api[ _-]?key|authorization|bearer|token|headers|(?:file|source|output|save)[ _-]?path|(?:^|[_.-])(?:code|script|url|endpoint)(?:$|[_.-])|비밀번호|암호|인증키|토큰|저장.?경로/i
export function isProtectedWorkflowKey(key: string) { return PRIVATE_KEY.test(key) || key.split(/[.:]/).some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)) }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('워크플로 항목이 올바르지 않아.'); return value as Record<string, unknown> }
function text(value: unknown, max: number = CHAT_WORKFLOW_LIMITS.text): string { if (typeof value !== 'string' || value.length > max) throw new Error('워크플로 텍스트가 올바르지 않거나 너무 길어.'); return value }
function id(value: unknown): string { const result = text(value, 100); if (!/^[\w:.-]{1,100}$/.test(result) || isProtectedWorkflowKey(result)) throw new Error('노드·포트 ID가 올바르지 않아.'); return result }
function nodeId(value: unknown): string { const result = text(value, 100); if (!/^[\w-]{1,100}$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) throw new Error('노드 ID가 올바르지 않아.'); return result }
function numeric(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error('노드 좌표가 올바르지 않아.'); return value }
function position(value: unknown) { const raw = object(value); return { x: numeric(raw.x), y: numeric(raw.y) } }

/** Bounded JSON copying, including protection against secrets hidden inside a JSON field. */
export function copyChatWorkflowValue(value: unknown, depth = 0): ChatWorkflowValue {
  if (depth > CHAT_WORKFLOW_LIMITS.jsonDepth) throw new Error('JSON 입력이 너무 깊어.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') { const result = text(value); if (/^data:.*;base64,/i.test(result)) throw new Error('미디어 데이터는 채팅 입력에서 제외해.'); return result }
  if (Array.isArray(value)) { if (value.length > 128) throw new Error('JSON 목록이 너무 커.'); return value.map((entry) => copyChatWorkflowValue(entry, depth + 1)) }
  const raw = object(value)
  if (Object.keys(raw).length > 64) throw new Error('JSON 항목이 너무 많아.')
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => { if (isProtectedWorkflowKey(key)) throw new Error('인증·코드·경로 항목은 채팅 입력에서 제외해.'); return [key, copyChatWorkflowValue(entry, depth + 1)] }))
}

type EditorModule = {
  id: number; name: string; description?: string | null; engine_type: string; version: number
  exposed_inputs: Array<{ key: string; label: string; data_type: ChatWorkflowDataType; required?: boolean; multiple?: boolean; default_value?: unknown; description?: string }>
  output_ports: Array<{ key: string; label: string; data_type: ChatWorkflowDataType; multiple?: boolean; description?: string }>
  ui_schema?: Array<{ key: string; label: string; data_type: ChatWorkflowDataType | 'select'; options?: Array<string | { value: string; label: string }>; min?: number; max?: number; node_editor?: string; description?: string; default_value?: unknown }> | null
  template_defaults: Record<string, unknown>; internal_fixed_values?: Record<string, unknown> | null
}

/** The same public interface is derived from the live server definition and the editor's definition. */
export function describeChatWorkflowModule(module: EditorModule): ChatWorkflowModule {
  const operation = module.internal_fixed_values?.operation_key ?? module.template_defaults.operation_key
  const protectedField = (field: { key: string; label: string; description?: string }) => [field.key, field.label, field.description ?? ''].some(isProtectedWorkflowKey)
  const port = (entry: EditorModule['exposed_inputs'][number]): ChatWorkflowPort => ({ key: entry.key, label: entry.label.slice(0, 160), dataType: entry.data_type, required: entry.required === true, multiple: entry.multiple === true, connectable: !protectedField(entry) })
  const schemas = new Map((module.ui_schema ?? []).map((field) => [field.key, field]))
  const keys = [...new Set([...module.exposed_inputs.map((field) => field.key), ...schemas.keys()])]
  const fields: ChatWorkflowField[] = keys.map((key) => {
    const input = module.exposed_inputs.find((entry) => entry.key === key)
    const schema = schemas.get(key)
    const source = schema ?? input!
    const type = schema?.data_type ?? input!.data_type
    const options = schema?.options?.map((option) => typeof option === 'string' ? option : option.value)
    return { key, label: source.label.slice(0, 160), type,
      editable: !protectedField(source) && !schema?.node_editor && !['image', 'video', 'audio', 'mask'].includes(type) && (type !== 'select' || !!options?.length && options.length <= 100),
      hasDefault: source.default_value !== undefined || module.template_defaults[key] !== undefined || module.internal_fixed_values?.[key] !== undefined,
      ...(schema?.min !== undefined ? { min: schema.min } : {}), ...(schema?.max !== undefined ? { max: schema.max } : {}),
      ...(type === 'select' && options && options.length <= 100 ? { options } : {}),
    }
  })
  return { id: module.id, name: module.name.slice(0, 160), description: (module.description ?? '').slice(0, 500), engine: module.engine_type, version: module.version,
    operation: typeof operation === 'string' ? operation : null, inputs: module.exposed_inputs.map(port), outputs: module.output_ports.map(port), fields,
    runInputCapable: module.engine_type === 'system' && typeof operation === 'string' && /^system\.constant_(text|prompt|json|image|number|boolean)$/.test(operation),
  }
}

export function sanitizeChatWorkflowInputs(input: Record<string, unknown>, module: ChatWorkflowModule) {
  const values: Record<string, ChatWorkflowValue> = {}
  for (const field of module.fields.filter((entry) => entry.editable)) {
    if (input[field.key] === undefined) continue
    try { values[field.key] = copyChatWorkflowValue(input[field.key]) } catch { /* Protected or oversized values remain in the local editor only. */ }
  }
  return values
}

export function normalizeChatWorkflowSnapshot(value: unknown): ChatWorkflowSnapshot {
  const raw = object(value)
  const revision = nodeId(raw.revision)
  if (revision.length < 8 || !Array.isArray(raw.nodes) || raw.nodes.length > CHAT_WORKFLOW_LIMITS.nodes || !Array.isArray(raw.edges) || raw.edges.length > CHAT_WORKFLOW_LIMITS.edges) throw new Error('워크플로 편집 상태가 올바르지 않거나 너무 커.')
  const nodeIds = new Set<string>(), edgeIds = new Set<string>()
  const nodes: ChatWorkflowNode[] = raw.nodes.map((entry) => {
    const node = object(entry), key = nodeId(node.id)
    if (nodeIds.has(key) || !Number.isSafeInteger(node.module_id) || Number(node.module_id) < 1) throw new Error('노드 ID나 모듈이 올바르지 않아.')
    nodeIds.add(key)
    const inputs = object(node.input_values)
    const input_values = Object.fromEntries(Object.entries(inputs).map(([field, data]) => [id(field), copyChatWorkflowValue(data)]))
    const run = node.run_input === undefined ? undefined : object(node.run_input)
    return { id: key, module_id: Number(node.module_id), label: text(node.label, 200), disabled: node.disabled === true, position: position(node.position), input_values,
      ...(run ? { run_input: { enabled: run.enabled === true, label: text(run.label, 160), description: text(run.description) } } : {}),
    }
  })
  const edges = raw.edges.map((entry) => {
    const edge = object(entry), key = nodeId(edge.id), source = nodeId(edge.source_node_id), target = nodeId(edge.target_node_id)
    if (edgeIds.has(key) || !nodeIds.has(source) || !nodeIds.has(target)) throw new Error('연결 ID나 대상 노드가 올바르지 않아.')
    edgeIds.add(key)
    // Existing protected connections can be displayed, but a proposal cannot create new ones.
    return { id: key, source_node_id: source, source_port_key: text(edge.source_port_key, 100), target_node_id: target, target_port_key: text(edge.target_port_key, 100) }
  })
  const result = { revision, name: text(raw.name, 160), description: text(raw.description), nodes, edges }
  if (JSON.stringify(result).length > CHAT_WORKFLOW_LIMITS.snapshot) throw new Error('워크플로 편집 정보가 너무 커.')
  return result
}

function fieldValue(field: ChatWorkflowField, input: unknown): ChatWorkflowValue {
  if (!field.editable) throw new Error(`${field.label}: 보호된 입력은 직접 편집해줘.`)
  if (field.type === 'number') {
    if ((typeof input !== 'number' && typeof input !== 'string') || String(input).trim() === '') throw new Error(`${field.label}: 숫자가 필요해.`)
    const value = Number(input)
    if (!Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) throw new Error(`${field.label}: 숫자 범위를 확인해줘.`)
    return value
  }
  if (field.type === 'boolean') { if (typeof input !== 'boolean') throw new Error(`${field.label}: 불리언 값이 필요해.`); return input }
  if (field.type === 'select') { const value = text(input); if (!field.options?.includes(value)) throw new Error(`${field.label}: 선택 목록에 없는 값이야.`); return value }
  if (field.type === 'text' || field.type === 'prompt') return text(input)
  if (typeof input === 'string' && (field.type === 'json' || field.type === 'any' && /^\s*[\[{]/.test(input))) { try { return copyChatWorkflowValue(JSON.parse(input)) } catch { throw new Error(`${field.label}: 안전한 JSON 값이 필요해.`) } }
  return copyChatWorkflowValue(input)
}

function compatible(source: ChatWorkflowDataType, target: ChatWorkflowDataType) { return source === target || source === 'any' || target === 'any' || (source === 'text' && target === 'prompt') || (source === 'prompt' && target === 'text') }
function inputPort(module: ChatWorkflowModule, key: string): ChatWorkflowPort | undefined {
  const direct = module.inputs.find((port) => port.key === key)
  if (direct) return direct
  if (module.operation === 'system.random_text_choice' && key.startsWith('options.') && key.length > 8) { const parent = module.inputs.find((port) => port.key === 'options'); if (parent) return { ...parent, key, dataType: 'any', multiple: false, required: false } }
  if (module.operation === 'system.api_request') {
    const prefix = key.startsWith('values.') ? 'values' : key.startsWith('headers.') ? 'headers' : null
    const parent = module.inputs.find((port) => port.key === prefix)
    if (prefix && parent && key.length > prefix.length + 1) return { ...parent, key, dataType: prefix === 'headers' ? 'text' : 'any', multiple: false, required: false, connectable: parent.connectable && !isProtectedWorkflowKey(key) }
  }
  return undefined
}
const shown = (value: unknown) => value === undefined ? '(모듈 기본값)' : typeof value === 'string' ? value : JSON.stringify(value)

/** Apply a typed transaction to a copy. The original editor state is never mutated on any error. */
export function applyChatWorkflowOperations(snapshot: ChatWorkflowSnapshot, modules: ChatWorkflowModule[], input: unknown) {
  if (!Array.isArray(input) || input.length === 0 || input.length > CHAT_WORKFLOW_LIMITS.operations) throw new Error('워크플로 변경 목록이 올바르지 않아.')
  const graph = normalizeChatWorkflowSnapshot(snapshot)
  const before = JSON.stringify(graph)
  const moduleMap = new Map(modules.map((module) => [module.id, module]))
  const seenNodes = new Set(graph.nodes.map((node) => node.id)), seenEdges = new Set(graph.edges.map((edge) => edge.id))
  const operations: ChatWorkflowOperation[] = [], changes: ChatWorkflowChange[] = []
  const findNode = (key: unknown) => { const node = graph.nodes.find((entry) => entry.id === nodeId(key)); if (!node) throw new Error('대상 노드가 없어. 편집기를 다시 읽어줘.'); return node }
  const findModule = (key: number) => { const module = moduleMap.get(key); if (!module) throw new Error('등록된 활성 모듈을 찾지 못했어.'); return module }
  const findField = (node: ChatWorkflowNode, key: unknown) => { const field = findModule(node.module_id).fields.find((entry) => entry.key === id(key)); if (!field) throw new Error('선언되지 않은 노드 입력이야.'); if (!field.editable) throw new Error(`${field.label}: 보호된 입력은 직접 편집해줘.`); return field }
  const addChange = (title: string, old: unknown, next: unknown) => changes.push({ title, before: shown(old), after: shown(next) })
  for (const entry of input) {
    const raw = object(entry)
    if (raw.type === 'add_node') {
      const key = nodeId(raw.nodeId), module = findModule(Number(raw.moduleId))
      if (seenNodes.has(key)) throw new Error('이미 사용한 노드 ID야. 새 ID를 사용해줘.')
      seenNodes.add(key)
      const node: ChatWorkflowNode = { id: key, module_id: module.id, label: raw.label === undefined ? module.name : text(raw.label, 200), disabled: false, position: raw.position === undefined ? { x: 80 + graph.nodes.length % 4 * 420, y: 80 + Math.floor(graph.nodes.length / 4) * 400 } : position(raw.position), input_values: {} }
      graph.nodes.push(node); operations.push({ type: 'add_node', nodeId: key, moduleId: module.id, label: node.label, position: node.position }); addChange(`노드 추가 · ${node.label}`, '(없음)', module.name)
    } else if (raw.type === 'remove_node') {
      const node = findNode(raw.nodeId), removed = graph.edges.filter((edge) => edge.source_node_id === node.id || edge.target_node_id === node.id)
      graph.nodes = graph.nodes.filter((item) => item.id !== node.id); graph.edges = graph.edges.filter((edge) => !removed.includes(edge))
      for (const edge of removed) seenEdges.delete(edge.id)
      operations.push({ type: 'remove_node', nodeId: node.id }); addChange(`노드 삭제 · 연결 ${removed.length}개도 삭제`, node.label, '(삭제)')
    } else if (raw.type === 'set_node') {
      const node = findNode(raw.nodeId), op: Extract<ChatWorkflowOperation, { type: 'set_node' }> = { type: 'set_node', nodeId: node.id }
      if (raw.label !== undefined) { op.label = text(raw.label, 200); addChange(`노드 이름 · ${node.id}`, node.label, op.label); node.label = op.label }
      if (raw.disabled !== undefined) { if (typeof raw.disabled !== 'boolean') throw new Error('노드 비활성 값이 올바르지 않아.'); op.disabled = raw.disabled; addChange(`노드 비활성 · ${node.label}`, node.disabled, op.disabled); node.disabled = op.disabled }
      if (raw.position !== undefined) { op.position = position(raw.position); addChange(`노드 배치 · ${node.label}`, node.position, op.position); node.position = op.position }
      if (Object.keys(op).length === 2) throw new Error('변경할 노드 속성이 없어.')
      operations.push(op)
    } else if (raw.type === 'set_input' || raw.type === 'clear_input') {
      const node = findNode(raw.nodeId), field = findField(node, raw.key)
      const old = node.input_values[field.key]
      if (raw.type === 'set_input') { const value = fieldValue(field, raw.value); node.input_values[field.key] = value; operations.push({ type: 'set_input', nodeId: node.id, key: field.key, value }); addChange(`${node.label} · ${field.label}`, old, value) }
      else { delete node.input_values[field.key]; operations.push({ type: 'clear_input', nodeId: node.id, key: field.key }); addChange(`${node.label} · ${field.label}`, old, undefined) }
    } else if (raw.type === 'connect') {
      const key = nodeId(raw.edgeId), source = findNode(raw.sourceNodeId), target = findNode(raw.targetNodeId), sourceKey = id(raw.sourcePort), targetKey = id(raw.targetPort)
      const output = findModule(source.module_id).outputs.find((port) => port.key === sourceKey), port = inputPort(findModule(target.module_id), targetKey)
      if (source.id === target.id || !output || !port || !output.connectable || !port.connectable || !compatible(output.dataType, port.dataType)) throw new Error('없는 포트, 보호된 포트 또는 맞지 않는 타입은 연결할 수 없어.')
      if (seenEdges.has(key) || graph.edges.some((edge) => edge.source_node_id === source.id && edge.source_port_key === sourceKey && edge.target_node_id === target.id && edge.target_port_key === targetKey)) throw new Error('중복 연결이야.')
      if (!port.multiple && graph.edges.some((edge) => edge.target_node_id === target.id && edge.target_port_key === targetKey)) throw new Error('단일 입력에 이미 연결이 있어. 기존 연결 삭제를 먼저 제안해줘.')
      seenEdges.add(key); graph.edges.push({ id: key, source_node_id: source.id, source_port_key: sourceKey, target_node_id: target.id, target_port_key: targetKey })
      operations.push({ type: 'connect', edgeId: key, sourceNodeId: source.id, sourcePort: sourceKey, targetNodeId: target.id, targetPort: targetKey }); addChange('연결 추가', '(없음)', `${source.label} · ${output.label} → ${target.label} · ${port.label}`)
    } else if (raw.type === 'disconnect') {
      const key = nodeId(raw.edgeId), edge = graph.edges.find((item) => item.id === key)
      if (!edge) throw new Error('삭제할 연결이 없어.')
      seenEdges.delete(key)
      graph.edges = graph.edges.filter((item) => item.id !== key); operations.push({ type: 'disconnect', edgeId: key }); addChange('연결 삭제', `${edge.source_node_id}.${edge.source_port_key} → ${edge.target_node_id}.${edge.target_port_key}`, '(삭제)')
    } else if (raw.type === 'set_workflow') {
      const op: Extract<ChatWorkflowOperation, { type: 'set_workflow' }> = { type: 'set_workflow' }
      if (raw.name !== undefined) { op.name = text(raw.name, 160); if (!op.name.trim()) throw new Error('워크플로 이름을 입력해줘.'); addChange('워크플로 이름', graph.name, op.name); graph.name = op.name }
      if (raw.description !== undefined) { op.description = text(raw.description); addChange('워크플로 설명', graph.description, op.description); graph.description = op.description }
      if (Object.keys(op).length === 1) throw new Error('변경할 워크플로 속성이 없어.')
      operations.push(op)
    } else if (raw.type === 'set_run_input') {
      const node = findNode(raw.nodeId), module = findModule(node.module_id)
      if (!module.runInputCapable || typeof raw.enabled !== 'boolean') throw new Error('상수 입력 노드에서만 실행 입력을 설정할 수 있어.')
      const run = { enabled: raw.enabled, label: raw.label === undefined ? node.run_input?.label ?? '' : text(raw.label, 160), description: raw.description === undefined ? node.run_input?.description ?? '' : text(raw.description) }
      addChange(`실행 입력 · ${node.label}`, node.run_input ?? { enabled: false }, run); node.run_input = run
      operations.push({ type: 'set_run_input', nodeId: node.id, ...run })
    } else throw new Error('지원하지 않는 워크플로 변경이야.')
  }
  normalizeChatWorkflowSnapshot(graph)
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0])), outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]))
  const connections = new Set<string>(), singleInputs = new Set<string>()
  for (const edge of graph.edges) {
    const source = findNode(edge.source_node_id), target = findNode(edge.target_node_id)
    const output = findModule(source.module_id).outputs.find((port) => port.key === edge.source_port_key), port = inputPort(findModule(target.module_id), edge.target_port_key)
    if (!output || !port || !compatible(output.dataType, port.dataType)) throw new Error('그래프에 올바르지 않은 연결이 있어.')
    const tuple = JSON.stringify([source.id, output.key, target.id, port.key]), targetKey = JSON.stringify([target.id, port.key])
    if (connections.has(tuple) || !port.multiple && singleInputs.has(targetKey)) throw new Error('그래프에 중복 연결이나 단일 입력의 다중 연결이 있어.')
    connections.add(tuple); if (!port.multiple) singleInputs.add(targetKey)
    incoming.set(target.id, incoming.get(target.id)! + 1); outgoing.get(source.id)!.push(target.id)
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([key]) => key)
  let visited = 0
  for (let index = 0; index < queue.length; index++) { const key = queue[index]; visited++; for (const next of outgoing.get(key)!) { incoming.set(next, incoming.get(next)! - 1); if (incoming.get(next) === 0) queue.push(next) } }
  if (visited !== graph.nodes.length) throw new Error('순환 그래프는 적용할 수 없어. 연결을 확인해줘.')
  if (before === JSON.stringify(graph)) throw new Error('현재 그래프와 다른 변경이 없어.')
  const issues: string[] = []
  if (!graph.nodes.some((node) => !node.disabled && findModule(node.module_id).operation === 'system.final_result')) issues.push('최종 결과 노드가 없어. 저장·실행 전에 연결해줘.')
  for (const node of graph.nodes.filter((entry) => !entry.disabled)) {
    const module = findModule(node.module_id)
    for (const port of module.inputs.filter((entry) => entry.required || module.operation === 'system.final_result' && entry.key === 'value')) {
      const field = module.fields.find((entry) => entry.key === port.key), value = node.input_values[port.key]
      if (!graph.edges.some((edge) => edge.target_node_id === node.id && edge.target_port_key === port.key) && (value === undefined || value === null || value === '') && !field?.hasDefault && !(node.run_input?.enabled && module.runInputCapable)) issues.push(`${node.label} · ${port.label}: 입력을 확인해줘.`)
    }
  }
  return { graph, operations, changes, issues: issues.slice(0, 20) }
}
