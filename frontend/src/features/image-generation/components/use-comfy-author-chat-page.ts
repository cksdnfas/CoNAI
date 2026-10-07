import { copyChatPageData, isPrivateChatPageKey, type ChatPageData } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { GenerationWorkflowDetail, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { buildWorkflowMarkedFieldFromInput, parseWorkflowDefinition, type ParsedWorkflowGraph } from './comfy-workflow-authoring-graph'
import { comfyNodeChatData } from './comfy-chat-node'

export type ComfyAuthorDraft = { name: string; description: string; workflowJson: string; markedFields: WorkflowMarkedField[]; isPublicPage: boolean; publicSlug: string; publicQueueMaxCount: string }
const numericBounds = Object.fromEntries(['resolution_mp', 'width', 'height', 'duration', 'frame_rate'].map((key) => [key, pageObject({ min: pageNumber(), max: pageNumber() })]))
const fieldConfig = pageObject({ label: pageText(160), description: pageText(), type: pageChoice(['text', 'textarea', 'number', 'select', 'image', 'node']), required: { type: 'boolean' }, min: pageNumber(), max: pageNumber(), step: pageNumber(0.000001), placeholder: pageText(300), options: pageArray(pageText(300), 512), dropdown_list_name: pageText(200), model_preview_folder: pageChoice(['', 'checkpoints', 'loras', 'diffusion_models', 'unet_gguf']), default_value: pageText(), default_collapsed: { type: 'boolean' }, simple_upload_only: { type: 'boolean' }, node_visible_fields: pageArray(pageChoice(['mode', 'width', 'height', 'duration', 'frame_rate', 'ref_image_size', 'timeline_data', 'prompt']), 8), node_hidden_controls: pageArray(pageChoice(['resolution', 'resolution.input_scaling', 'postprocess.simple', 'postprocess.model', 'postprocess.model.model_name', 'postprocess.rtx']), 6), node_numeric_bounds: pageObject(numericBounds), node_items: pageArray(pageObject({ key: pageText(100), label: pageText(160), lora: pageText(300) }, ['key', 'label']), 64) })
const schema = pageObject({ name: pageText(200), description: pageText(), workflowJson: pageText(200000), isPublicPage: { type: 'boolean' }, publicSlug: pageText(100), publicQueueMaxCount: pageNumber(1, 32, true), registerFields: pageArray(pageObject({ nodeId: pageText(100), inputKey: pageText(200), id: pageText(200), config: fieldConfig }, ['nodeId', 'inputKey']), 128), updateFields: pageArray(pageObject({ id: pageText(200), config: fieldConfig }, ['id', 'config']), 128), removeFieldIds: pageArray(pageText(200), 128), fieldOrder: pageArray(pageText(200), 128) })

function configureField(field: WorkflowMarkedField, input: ChatPageData) {
  const config = pageRecord(input)
  const next = { ...field, ...config } as WorkflowMarkedField
  if (config.default_value !== undefined && next.type === 'node') {
    const value: unknown = JSON.parse(String(config.default_value))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('노드 기본값은 JSON 객체로 입력해줘.')
    next.default_value = copyChatPageData(value) as Record<string, unknown>
  }
  for (const bound of Object.values(next.node_numeric_bounds ?? {})) if (bound.min !== undefined && bound.max !== undefined && bound.min > bound.max) throw new Error('노드 숫자 범위를 확인해줘.')
  return next
}

/** Preserve protected native inputs when replacing the public graph document. */
function reviewedWorkflowJson(input: string, previous: string) {
  const next = parseWorkflowDefinition(input)
  if (!Object.keys(next).length || Object.keys(next).length > 128) throw new Error('워크플로 JSON은 노드 1~128개를 지원해.')
  for (const [id, node] of Object.entries(next)) {
    if (!/^[\w-]+$/.test(id) || !node || typeof node.class_type !== 'string' || !node.class_type.trim() || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) throw new Error('ComfyUI API 형식의 노드 ID·class_type·inputs가 필요해.')
    copyChatPageData(node.inputs)
    for (const value of Object.values(node.inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'number' && (!Object.hasOwn(next, String(value[0])) || !Number.isInteger(value[1]) || value[1] < 0)) throw new Error('워크플로에 없는 노드 연결이야.')
  }
  if (previous.trim()) {
    const old = parseWorkflowDefinition(previous)
    for (const [id, node] of Object.entries(old)) {
      for (const [key, value] of Object.entries(node.inputs ?? {})) {
        let protectedInput = isPrivateChatPageKey(key)
        try { copyChatPageData(value) } catch { protectedInput = true }
        if (protectedInput) { if (!next[id] || next[id].class_type !== node.class_type) throw new Error('보호된 설정이 있는 노드는 기존 편집기에서 수정해줘.'); next[id].inputs![key] = value }
      }
    }
  }
  return JSON.stringify(next, null, 2)
}

export function useComfyAuthorChatPage(input: { enabled: boolean; draft: ComfyAuthorDraft; setDraft: (draft: ComfyAuthorDraft) => void; graph: ParsedWorkflowGraph | null; saved: GenerationWorkflowDetail | null; save: (revision?: string) => Promise<void> }) {
  const { enabled, draft, setDraft, graph, saved, save } = input
  const { t } = useI18n()
  const commit = useChatDraftTransaction(draft, setDraft)
  const nodes = (graph?.nodes ?? []).map((node) => ({ id: node.id, classType: node.data.classType, title: node.data.title, inputs: node.data.editableInputs.filter((item) => !isPrivateChatPageKey(item.key)).map((item) => ({ key: item.key, label: item.label, type: item.inferredType, jsonPath: item.jsonPath ?? `${node.id}.inputs.${item.key}`, value: (() => { try { if (item.inferredType === 'node') { const field = buildWorkflowMarkedFieldFromInput(node.id, node.data.title, node.data.classType, item); return comfyNodeChatData(field, item.value) } if (['timeline_data', 'builder_state'].includes(item.key)) return null; return copyChatPageData(item.value) } catch { return null } })() })) }))
  const markedFields = draft.markedFields.map((field) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'default_value')))) as ChatPageData)
  useChatPageRegistration(enabled ? {
    kind: 'comfy_author', title: t({ ko: 'ComfyUI 워크플로 등록·수정', en: 'ComfyUI workflow registration and editing' }), priority: 100, resourceId: String(saved?.id ?? 'new-comfy'), localRevision: JSON.stringify(draft),
    fields: [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: draft.name }, { id: 'description', label: t({ ko: '설명', en: 'Description' }), type: 'text', value: draft.description },
      { id: 'isPublicPage', label: t({ ko: '공유 페이지 사용', en: 'Enable shared page' }), type: 'boolean', value: draft.isPublicPage }, { id: 'publicSlug', label: t({ ko: '공유 주소 이름', en: 'Shared slug' }), type: 'text', value: draft.publicSlug },
      { id: 'publicQueueMaxCount', label: t({ ko: '공유 큐 등록 상한', en: 'Shared queue count limit' }), type: 'number', value: draft.publicQueueMaxCount, min: 1, max: 32, integer: true },
    ],
    data: { nodes, markedFields, selected: { id: saved?.id ?? 0, name: draft.name, description: draft.description, isPublicPage: draft.isPublicPage, publicSlug: draft.publicSlug, publicQueueMaxCount: draft.publicQueueMaxCount, nodeCount: nodes.length, markedFields, revision: saved?.assistant_revision ?? '' } },
    actions: [
      pageAction('comfy.author', t({ ko: '워크플로·marked field 편집', en: 'Edit workflow and marked fields' }), t({ ko: 'ComfyUI API JSON 입력, registerFields로 노드 입력 등록, updateFields로 설정 수정, removeFieldIds로 표시 필드 해제를 지원해. 연결은 실제 노드 ID를 사용해.', en: 'Set ComfyUI API JSON, register node inputs with registerFields, edit settings with updateFields, or unmark fields with removeFieldIds. Connections use actual node IDs.' }), schema),
      pageAction(saved ? 'comfy.save' : 'comfy.register', t(saved ? { ko: '워크플로 수정 저장', en: 'Save workflow changes' } : { ko: '워크플로 등록 저장', en: 'Register workflow' }), t({ ko: '현재 편집 초안의 JSON과 marked field를 서버에 저장해. 생성을 실행하지 않아.', en: 'Save the current JSON and marked-field draft to the server without generation.' }), pageObject({}), 'save'),
    ],
    apply: (patch) => setDraft({ ...draft, ...patch } as ComfyAuthorDraft),
    applyAction: async (id, args, assertCurrent, revision) => {
      assertCurrent()
      if (id === 'comfy.save' || id === 'comfy.register') { await save(revision); return }
      if (id !== 'comfy.author') throw new Error('등록되지 않은 워크플로 편집 작업이야.')
      const next = { ...draft, markedFields: [...draft.markedFields] }
      if (args.workflowJson !== undefined) next.workflowJson = reviewedWorkflowJson(String(args.workflowJson), draft.workflowJson)
      if (args.name !== undefined) next.name = String(args.name)
      if (args.description !== undefined) next.description = String(args.description)
      if (args.isPublicPage !== undefined) next.isPublicPage = Boolean(args.isPublicPage)
      if (args.publicSlug !== undefined) next.publicSlug = String(args.publicSlug)
      if (args.publicQueueMaxCount !== undefined) next.publicQueueMaxCount = String(args.publicQueueMaxCount)
      if (args.removeFieldIds) { const ids = args.removeFieldIds as string[]; if (ids.some((id) => !next.markedFields.some((field) => field.id === id))) throw new Error('해제할 marked field가 없어.'); next.markedFields = next.markedFields.filter((field) => !ids.includes(field.id)) }
      for (const raw of (args.updateFields ?? []) as ChatPageData[]) { const update = pageRecord(raw); const existing = next.markedFields.find((field) => field.id === update.id); if (!existing) throw new Error('수정할 marked field가 없어.'); const changed = configureField(existing, update.config); next.markedFields = next.markedFields.map((field) => field.id === update.id ? changed : field) }
      // Resolve registration through the native graph parser and marked-field factory.
      if (args.registerFields) {
        const parsed = parseWorkflowDefinition(next.workflowJson)
        for (const raw of args.registerFields as ChatPageData[]) {
          const entry = pageRecord(raw); const nodeId = String(entry.nodeId); const key = String(entry.inputKey)
          if (isPrivateChatPageKey(key)) throw new Error('보호된 입력은 marked field로 등록할 수 없어.')
          const currentGraph = next.workflowJson === draft.workflowJson ? graph : null
          const node = currentGraph?.nodes.find((node) => node.id === nodeId)
          const nativeInput = node?.data.editableInputs.find((item) => item.key === key)
          const source = parsed[nodeId]
          if (!source || (!nativeInput && !Object.hasOwn(source.inputs ?? {}, key))) throw new Error('등록할 노드 입력이 없어. JSON 변경을 먼저 적용하고 새 요청으로 등록해줘.')
          const field = buildWorkflowMarkedFieldFromInput(nodeId, node?.data.title ?? source.class_type ?? nodeId, source.class_type ?? '', nativeInput ?? { key, label: key, value: source.inputs![key], inferredType: typeof source.inputs![key] === 'number' ? 'number' : 'text' })
          if (entry.id !== undefined) { const id = String(entry.id); if (!/^[\w-]+$/.test(id) || isPrivateChatPageKey(id)) throw new Error('표시 필드 ID가 올바르지 않아.'); field.id = id }
          if (entry.config) Object.assign(field, configureField(field, entry.config))
          if (next.markedFields.some((item) => item.id === field.id || item.jsonPath === field.jsonPath)) throw new Error('같은 marked field가 이미 등록됐어.')
          next.markedFields.push(field)
        }
      }
      if (next.markedFields.length > 128) throw new Error('marked field는 최대 128개까지 편집할 수 있어.')
      if (args.fieldOrder) { const order = args.fieldOrder as string[]; if (order.length !== next.markedFields.length || new Set(order).size !== order.length || order.some((id) => !next.markedFields.some((field) => field.id === id))) throw new Error('표시 순서는 현재 모든 marked field ID를 한 번씩 입력해줘.'); next.markedFields = order.map((id) => next.markedFields.find((field) => field.id === id)!) }
      for (const field of next.markedFields) if ((field.min !== undefined && field.max !== undefined && field.min > field.max) || (field.step !== undefined && field.step <= 0)) throw new Error('marked field 숫자 범위를 확인해줘.')
      assertCurrent()
      return commit(next)
    },
  } : null)
}
