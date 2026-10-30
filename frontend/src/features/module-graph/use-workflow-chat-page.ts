import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useReactFlow } from '@xyflow/react'
import { applyChatWorkflowOperations, describeChatWorkflowModule, normalizeChatWorkflowSnapshot, replayWorkflowLocalInputs, sanitizeChatWorkflowInputs, type ChatWorkflowSnapshot } from '@conai/shared'
import { useChatPage, useChatPageRegistration, type WorkflowPageProposal } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import { pageAction } from '@/features/codex-chat/page-action-helpers'
import type { GraphWorkflowExposedInput, ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { createRandomUuid } from '@/lib/random-uuid'
import { buildGraphEditorSnapshot, buildGraphPayload } from './module-graph-flow'
import { buildHandleId, buildModuleEdgePresentation, findNodePort, getModulePortCompatibility } from './module-graph-ports'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-types'
import { buildWorkflowRunInputDefaults, deriveWorkflowExposedInputsFromNodes, isWorkflowInputEnabledForNode, WORKFLOW_INPUT_DESCRIPTION_KEY, WORKFLOW_INPUT_LABEL_KEY } from './module-graph-workflow-inputs'

type Draft = { name: string; description: string; nodes: ModuleGraphNode[]; edges: ModuleGraphEdge[]; runInputs: Record<string, unknown> }
type Params = Draft & {
  enabled: boolean; dirty: boolean; currentSnapshot: string; editorSessionId: string; selectedGraphId: number | null; debugMode: boolean; modules: ModuleDefinitionRecord[]
  setNodes: Dispatch<SetStateAction<ModuleGraphNode[]>>; setEdges: Dispatch<SetStateAction<ModuleGraphEdge[]>>
  setName: Dispatch<SetStateAction<string>>; setDescription: Dispatch<SetStateAction<string>>
  setRunInputs: Dispatch<SetStateAction<Record<string, unknown>>>; setExposedInputs: Dispatch<SetStateAction<GraphWorkflowExposedInput[]>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>; setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  canSave: boolean; save: () => Promise<boolean>
}

/** Private inputs participate in concurrency checks locally, but never enter the chat snapshot. */
function signature(snapshot: string, draft: Pick<Draft, 'name' | 'description' | 'runInputs'>) {
  // The editor snapshot trims these fields, but even whitespace-only changes invalidate chat proposals.
  return `${snapshot}\n${JSON.stringify([draft.name, draft.description, draft.runInputs])}`
}

/** A typed native-editor adapter; saving uses the editor's own revision-checked handler. */
export function useWorkflowChatPage(params: Params) {
  const { t } = useI18n()
  const flow = useReactFlow()
  const connected = useChatPage()?.enabled === true
  const modules = useMemo(() => params.modules.map(describeChatWorkflowModule), [params.modules])
  const moduleSignature = useMemo(() => JSON.stringify(modules), [modules])
  const { enabled, currentSnapshot, name, description, runInputs } = params
  // Serializing the whole graph is only worth it while a chat is connected to this page, and only when it changed.
  const draftSignature = useMemo(
    () => enabled && connected ? signature(currentSnapshot, { name, description, runInputs }) : '',
    [enabled, connected, currentSnapshot, name, description, runInputs],
  )
  const revision = useMemo(() => ({ draftSignature, moduleSignature, id: createRandomUuid() }), [draftSignature, moduleSignature]).id
  const snapshot = useMemo<ChatWorkflowSnapshot | null>(() => {
    if (!params.enabled || !connected) return null
    try {
      const catalog = new Map(modules.map((module) => [module.id, module]))
      const graph = buildGraphPayload(params.nodes, params.edges)
      if (graph.edges.length !== params.edges.length) return null
      return normalizeChatWorkflowSnapshot({ revision, name: params.name, description: params.description, edges: graph.edges, nodes: graph.nodes.map((node, index) => {
        const module = catalog.get(node.module_id)
        if (!module) throw new Error('활성 모듈이 없어.')
        const original = params.nodes[index]
        return { ...node, disabled: node.disabled === true, input_values: sanitizeChatWorkflowInputs(node.input_values, module), ...(module.runInputCapable ? { run_input: { enabled: isWorkflowInputEnabledForNode(original), label: String(node.input_values[WORKFLOW_INPUT_LABEL_KEY] ?? ''), description: String(node.input_values[WORKFLOW_INPUT_DESCRIPTION_KEY] ?? '') } } : {}) }
      }) })
    } catch { return null }
  }, [connected, params.enabled, params.nodes, params.edges, params.name, params.description, modules, revision])
  const live = useRef({ params, snapshot, modules, draftSignature, moduleSignature })
  useLayoutEffect(() => { live.current = { params, snapshot, modules, draftSignature, moduleSignature } })

  const applyWorkflow = (proposal: WorkflowPageProposal) => {
    const current = live.current
    const original = current.params
    if (!original.enabled || !current.snapshot || current.snapshot.revision !== proposal.revision) throw new Error('워크플로 편집 상태가 바뀌었어.')
    const catalog = new Map(current.modules.map((module) => [module.id, module]))
    if (proposal.modules.some((module) => JSON.stringify(module) !== JSON.stringify(catalog.get(module.id)))) throw new Error('모듈 정의가 바뀌었어. 새로 제안받아줘.')
    const transaction = applyChatWorkflowOperations(current.snapshot, current.modules, proposal.operations)
    const moduleRecords = new Map(original.modules.map((module) => [module.id, module]))
    const oldNodes = new Map(original.nodes.map((node) => [node.id, node]))
    const localGraph = buildGraphPayload(original.nodes, original.edges)
    const local = replayWorkflowLocalInputs({ ...localGraph, nodes: localGraph.nodes.map((node, index) => ({ ...node, run_input: { enabled: isWorkflowInputEnabledForNode(original.nodes[index]) } })) }, original.modules, transaction.operations)
    const localNodes = new Map(local.nodes.map((node) => [node.id, node]))
    const replaced = new Set(transaction.operations.flatMap((operation) => operation.type === 'set_variant' || operation.type === 'add_node' ? [operation.nodeId] : []))
    const nodes: ModuleGraphNode[] = transaction.graph.nodes.map((node) => {
      const old = oldNodes.get(node.id)
      const module = moduleRecords.get(node.module_id)
      if (!module) throw new Error('등록된 모듈을 찾지 못했어.')
      // Native values omitted from the chat snapshot must pass the same lossless variant check.
      const localNode = localNodes.get(node.id)
      if (!localNode || localNode.module_id !== node.module_id) throw new Error('노드 변형의 편집 결과가 일치하지 않아.')
      const inputValues = localNode.input_values ?? {}
      return { ...old, id: node.id, type: 'module', position: node.position, data: { ...(replaced.has(node.id) ? {} : old?.data), module, label: node.label, disabled: node.disabled, inputValues } }
    })
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const edges: ModuleGraphEdge[] = transaction.graph.edges.map((edge) => {
      const source = findNodePort(nodeMap.get(edge.source_node_id), 'out', edge.source_port_key)
      const target = findNodePort(nodeMap.get(edge.target_node_id), 'in', edge.target_port_key)
      // Native port activation rules (including mode-dependent ports) are checked before any setter.
      if (!source || !target || getModulePortCompatibility(source.data_type, target.data_type) === 'incompatible') throw new Error('현재 노드 설정에서 사용할 수 없는 포트 연결이 있어.')
      return { id: edge.id, source: edge.source_node_id, target: edge.target_node_id, sourceHandle: buildHandleId('out', edge.source_port_key), targetHandle: buildHandleId('in', edge.target_port_key), ...buildModuleEdgePresentation(source, target) }
    })
    const exposed = deriveWorkflowExposedInputsFromNodes(nodes)
    const defaults = buildWorkflowRunInputDefaults(exposed)
    const runInputs = exposed.reduce<Record<string, unknown>>((result, field) => {
      const value = original.runInputs[field.id] !== undefined ? original.runInputs[field.id] : defaults[field.id]
      if (value !== undefined) result[field.id] = value
      return result
    }, {})
    const next: Draft = { name: transaction.graph.name, description: transaction.graph.description, nodes, edges, runInputs }
    const expectedSnapshot = buildGraphEditorSnapshot({
      name: next.name, description: next.description, nodes: next.nodes, edges: next.edges,
      workflowMetadata: { exposed_inputs: deriveWorkflowExposedInputsFromNodes(next.nodes), debug_mode: original.debugMode },
    })
    const expectedSignature = signature(expectedSnapshot, next)
    const before: Draft = { name: original.name, description: original.description, nodes: original.nodes, edges: original.edges, runInputs: original.runInputs }
    const write = (draft: Draft) => {
      original.setNodes(draft.nodes); original.setEdges(draft.edges)
      original.setName(draft.name); original.setDescription(draft.description)
      original.setExposedInputs(deriveWorkflowExposedInputsFromNodes(draft.nodes)); original.setRunInputs(draft.runInputs)
      original.setSelectedNodeId(null); original.setSelectedEdgeId(null)
      requestAnimationFrame(() => { void flow.fitView({ padding: 0.2, duration: 180 }) })
    }
    const isCurrent = () => live.current.params.enabled && live.current.params.editorSessionId === original.editorSessionId && live.current.draftSignature === expectedSignature && live.current.moduleSignature === current.moduleSignature
    write(next)
    return { isCurrent, restore: () => { if (!isCurrent()) throw new Error('적용 뒤 워크플로가 바뀌었어.'); write(before) } }
  }

  useChatPageRegistration(params.enabled && (!connected || snapshot) ? {
    title: t({ ko: '노드 워크플로 편집기', en: 'Node workflow editor' }), kind: 'workflow', resourceId: `workflow:${params.selectedGraphId ?? 'draft'}:${params.editorSessionId}`,
    fields: [], ...(snapshot ? { workflow: snapshot } : {}), dirty: params.dirty, apply: () => {}, applyWorkflow,
    // A new draft is saved through the register dialog (name and folder), so it offers no save card that could only fail.
    actions: params.canSave && params.selectedGraphId !== null ? [pageAction('workflow.save', t({ ko: '워크플로 저장', en: 'Save workflow' }), t({ ko: '열린 워크플로를 저장해.', en: 'Save the open workflow.' }), undefined, 'save')] : [],
    applyAction: async (id, _args, assertCurrent) => {
      assertCurrent()
      if (id !== 'workflow.save') throw new Error('등록되지 않은 워크플로 작업이야.')
      if (params.selectedGraphId === null) throw new Error(t({ ko: '새 워크플로는 등록 창에서 이름과 폴더를 선택한 뒤 저장해줘.', en: 'Save a new workflow in the register dialog after choosing its name and folder.' }))
      if (!await params.save()) throw new Error('워크플로를 저장하지 못했어.')
    },
  } : null)
}
