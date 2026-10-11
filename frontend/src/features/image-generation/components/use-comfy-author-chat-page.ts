import { useState } from 'react'
import { copyChatPageData, isPrivateChatPageKey, type ChatPageData } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { GenerationWorkflowDetail, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { convertComfyUiWorkflow, type ComfyWorkflowCheckResult } from '@/lib/api-image-generation-workflows'
import { getErrorMessage } from '../image-generation-shared'
import { buildWorkflowMarkedFieldFromInput, isComfyUiWorkflowJson, parseWorkflowDefinition, suggestWorkflowMarkedFields, type ParsedWorkflowGraph } from './comfy-workflow-authoring-graph'
import { comfyNodeChatData } from './comfy-chat-node'

export type ComfyAuthorDraft = { name: string; description: string; workflowJson: string; markedFields: WorkflowMarkedField[]; isPublicPage: boolean; publicSlug: string; publicQueueMaxCount: string }
/** The editor's server check as the chat reads it: the result for the current JSON, still running, or failed. */
export type ComfyAuthorCheck = { result: ComfyWorkflowCheckResult | null; pending: boolean; error: string | null }
const numericBounds = Object.fromEntries(['resolution_mp', 'width', 'height', 'duration', 'frame_rate'].map((key) => [key, pageObject({ min: pageNumber(), max: pageNumber() })]))
const fieldConfig = pageObject({ label: pageText(160), description: pageText(), type: pageChoice(['text', 'textarea', 'number', 'select', 'image', 'node']), required: { type: 'boolean' }, min: pageNumber(), max: pageNumber(), step: pageNumber(0.000001), placeholder: pageText(300), options: pageArray(pageText(300), 512), dropdown_list_name: pageText(200), model_preview_folder: pageChoice(['', 'checkpoints', 'loras', 'diffusion_models', 'unet_gguf']), default_value: pageText(), default_collapsed: { type: 'boolean' }, simple_upload_only: { type: 'boolean' }, node_visible_fields: pageArray(pageChoice(['mode', 'width', 'height', 'duration', 'frame_rate', 'ref_image_size', 'timeline_data', 'prompt']), 8), node_hidden_controls: pageArray(pageChoice(['resolution', 'resolution.input_scaling', 'postprocess.simple', 'postprocess.model', 'postprocess.model.model_name', 'postprocess.rtx']), 6), node_numeric_bounds: pageObject(numericBounds), node_items: pageArray(pageObject({ key: pageText(100), label: pageText(160), lora: pageText(300) }, ['key', 'label']), 64) })
/** Seed inputs the backend rolls per run (backend comfyui/seedControl COMFY_SEED_INPUT_NAMES) and the `_meta` key that keeps one. */
const SEED_INPUT_KEYS = ['seed', 'noise_seed']
const FIXED_SEEDS_META_KEY = 'conai_fixed_seeds'
const fixedSeedSchema = pageObject({ nodeId: pageText(100), inputKey: pageChoice(SEED_INPUT_KEYS), fixed: { type: 'boolean' } }, ['nodeId', 'inputKey', 'fixed'])
const schema = pageObject({ name: pageText(200), description: pageText(), workflowJson: pageText(200000), isPublicPage: { type: 'boolean' }, publicSlug: pageText(100), publicQueueMaxCount: pageNumber(1, 32, true), registerFields: pageArray(pageObject({ nodeId: pageText(100), inputKey: pageText(200), id: pageText(200), config: fieldConfig }, ['nodeId', 'inputKey']), 128), updateFields: pageArray(pageObject({ id: pageText(200), config: fieldConfig }, ['id', 'config']), 128), removeFieldIds: pageArray(pageText(200), 128), fieldOrder: pageArray(pageText(200), 128), fixedSeeds: pageArray(fixedSeedSchema, 64) })
/** Issues per server in the page view (the view is resent on every request); issueCount keeps the full number. */
const CHECK_ISSUE_LIMIT = 15

type NodeMeta = Record<string, unknown> & { [FIXED_SEEDS_META_KEY]?: unknown }
type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; _meta?: NodeMeta }

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

/** Preserve protected native inputs (and node `_meta` the chat never sees) when replacing the public graph document. */
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
      // Titles, positions and fixed seeds live in `_meta`, which the chat's node list leaves out.
      if (typeof node.class_type === 'string' && node._meta && next[id]?.class_type === node.class_type && next[id]._meta === undefined) next[id]._meta = node._meta
    }
  }
  return JSON.stringify(next, null, 2)
}

/** Every literal seed input the backend would roll, with whether the workflow keeps it fixed. */
function readSeedInputs(workflowJson: string, markedFields: WorkflowMarkedField[]) {
  if (!workflowJson.trim() || isComfyUiWorkflowJson(workflowJson)) return []
  let workflow: Record<string, WorkflowNode>
  try { workflow = parseWorkflowDefinition(workflowJson) as Record<string, WorkflowNode> } catch { return [] }
  return Object.entries(workflow).flatMap(([nodeId, node]) => {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') return []
    const fixed = Array.isArray(node._meta?.[FIXED_SEEDS_META_KEY]) ? node._meta[FIXED_SEEDS_META_KEY] as unknown[] : []
    return SEED_INPUT_KEYS.flatMap((inputKey) => {
      const value = node.inputs![inputKey]
      if (typeof value !== 'number' || !Number.isFinite(value)) return []
      const markedFieldId = markedFields.find((field) => field.jsonPath === `${nodeId}.inputs.${inputKey}`)?.id ?? null
      return [{ nodeId, classType: String(node.class_type ?? ''), inputKey, value, fixed: fixed.includes(inputKey) && value >= 0, markedFieldId }]
    })
  })
}

/** Mark or unmark seed inputs as fixed in `_meta.conai_fixed_seeds`, the same key a converted ComfyUI "fixed" seed carries. */
function applyFixedSeeds(workflowJson: string, entries: ChatPageData[]) {
  const workflow = parseWorkflowDefinition(workflowJson) as Record<string, WorkflowNode>
  for (const raw of entries) {
    const entry = pageRecord(raw)
    const nodeId = String(entry.nodeId)
    const inputKey = String(entry.inputKey)
    const node = Object.hasOwn(workflow, nodeId) ? workflow[nodeId] : undefined
    if (!node?.inputs || typeof node.inputs[inputKey] !== 'number') throw new Error('고정할 시드 입력이 없어. seedInputs에 나온 노드와 입력만 쓸 수 있어.')
    if (entry.fixed === true && (node.inputs[inputKey] as number) < 0) throw new Error('음수 시드는 고정할 수 없어. 0 이상의 숫자를 먼저 넣어줘.')
    const meta: NodeMeta = { ...(node._meta ?? {}) }
    const current = Array.isArray(meta[FIXED_SEEDS_META_KEY]) ? (meta[FIXED_SEEDS_META_KEY] as unknown[]).filter((item): item is string => typeof item === 'string') : []
    const fixed = entry.fixed === true ? [...new Set([...current, inputKey])] : current.filter((item) => item !== inputKey)
    if (fixed.length > 0) meta[FIXED_SEEDS_META_KEY] = fixed
    else delete meta[FIXED_SEEDS_META_KEY]
    node._meta = meta
  }
  return JSON.stringify(workflow, null, 2)
}

/** The server check, bounded for the page view. */
function checkChatData(check: ComfyAuthorCheck | undefined, hasGraph: boolean): ChatPageData {
  if (!hasGraph) return { state: 'none' }
  if (check?.result) {
    return {
      state: check.pending ? 'checking' : 'done',
      servers: check.result.servers.map((server) => ({ serverId: server.server_id, name: server.server_name, status: server.status, issueCount: server.issues.length, issues: server.issues.slice(0, CHECK_ISSUE_LIMIT).map((issue) => ({ nodeId: issue.node_id, message: issue.message.slice(0, 200) })) })),
      unusedNodeIds: check.result.unused_node_ids ?? [],
      outputNodeIds: check.result.output_node_ids ?? [],
    }
  }
  if (check?.error) return { state: 'failed', error: check.error.slice(0, 400) }
  return { state: 'checking' }
}

export function useComfyAuthorChatPage(input: { enabled: boolean; dirty?: boolean; draft: ComfyAuthorDraft; setDraft: (draft: ComfyAuthorDraft) => void; graph: ParsedWorkflowGraph | null; saved: GenerationWorkflowDetail | null; save: (revision?: string) => Promise<void>; check?: ComfyAuthorCheck; runCheck?: () => Promise<void>; unusedNodeIds?: ReadonlySet<string> }) {
  const { enabled, dirty, draft, setDraft, graph, saved, save, check, runCheck, unusedNodeIds } = input
  const { t } = useI18n()
  const commit = useChatDraftTransaction(draft, setDraft)
  // Warnings of the last editor-workflow conversion comfy.author ran (dropped, renamed or guessed widget values).
  const [conversion, setConversion] = useState<{ workflowJson: string; warnings: string[] } | null>(null)
  const nodes = (graph?.nodes ?? []).map((node) => ({ id: node.id, classType: node.data.classType, title: node.data.title, inputs: node.data.editableInputs.filter((item) => !isPrivateChatPageKey(item.key)).map((item) => ({ key: item.key, label: item.label, type: item.inferredType, jsonPath: item.jsonPath ?? `${node.id}.inputs.${item.key}`, value: (() => { try { if (item.inferredType === 'node') { const field = buildWorkflowMarkedFieldFromInput(node.id, node.data.title, node.data.classType, item); return comfyNodeChatData(field, item.value) } if (['timeline_data', 'builder_state'].includes(item.key)) return null; return copyChatPageData(item.value) } catch { return null } })() })) }))
  const markedFields = draft.markedFields.map((field) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'default_value')))) as ChatPageData)
  const suggested = graph ? suggestWorkflowMarkedFields({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, data: { ...node.data, unused: unusedNodeIds?.has(node.id) ?? false } })) }, new Set(draft.markedFields.map((field) => field.jsonPath))).filter((field) => !isPrivateChatPageKey(`${field.id}.${field.jsonPath}`)) : []
  const seedInputs = readSeedInputs(draft.workflowJson, draft.markedFields)
  useChatPageRegistration(enabled ? {
    kind: 'comfy_author', title: t({ ko: 'ComfyUI 워크플로 등록·수정', en: 'ComfyUI workflow registration and editing' }), priority: 100, resourceId: String(saved?.id ?? 'new-comfy'), localRevision: JSON.stringify(draft), dirty,
    fields: [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: draft.name }, { id: 'description', label: t({ ko: '설명', en: 'Description' }), type: 'text', value: draft.description },
      { id: 'isPublicPage', label: t({ ko: '공유 페이지 사용', en: 'Enable shared page' }), type: 'boolean', value: draft.isPublicPage }, { id: 'publicSlug', label: t({ ko: '공유 주소 이름', en: 'Shared slug' }), type: 'text', value: draft.publicSlug },
      { id: 'publicQueueMaxCount', label: t({ ko: '공유 큐 등록 상한', en: 'Shared queue count limit' }), type: 'number', value: draft.publicQueueMaxCount, min: 1, max: 32, integer: true },
    ],
    data: {
      nodes, markedFields,
      selected: { id: saved?.id ?? 0, name: draft.name, description: draft.description, isPublicPage: draft.isPublicPage, publicSlug: draft.publicSlug, publicQueueMaxCount: draft.publicQueueMaxCount, nodeCount: nodes.length, markedFields, revision: saved?.assistant_revision ?? '' },
      check: checkChatData(check, graph !== null),
      suggestedFields: suggested.map((field) => ({ jsonPath: field.jsonPath, label: field.label, type: field.type })),
      seedInputs,
      ...(conversion && conversion.workflowJson === draft.workflowJson ? { conversion: { converted: true, warnings: conversion.warnings.slice(0, 40) } } : {}),
    },
    actions: [
      pageAction('comfy.author', t({ ko: '워크플로·marked field 편집', en: 'Edit workflow and marked fields' }), t({ ko: 'workflowJson은 ComfyUI API JSON이나 ComfyUI 편집기 워크플로(먼저 API 형식으로 바꿔)를 받아. registerFields로 노드 입력 등록, updateFields로 설정 수정, removeFieldIds로 표시 필드 해제, fixedSeeds로 시드 고정·해제를 지원해. 연결은 실제 노드 ID를 사용해.', en: 'workflowJson takes ComfyUI API JSON or a ComfyUI editor workflow (converted to the API format first). Register node inputs with registerFields, edit settings with updateFields, unmark fields with removeFieldIds, and fix or unfix seeds with fixedSeeds. Connections use actual node IDs.' }), schema),
      ...(runCheck ? [pageAction('comfy.check', t({ ko: '서버 검사', en: 'Check on servers' }), t({ ko: '현재 JSON을 실행 가능한 ComfyUI 서버와 대조해(없는 노드·모델, 범위 밖 값, 출력에 닿지 않는 노드). 결과는 data.check에 들어와.', en: 'Check the current JSON against the ComfyUI servers that may run it (missing nodes or models, out-of-range values, nodes that never reach an output). The result lands in data.check.' }))] : []),
      ...(suggested.length > 0 ? [pageAction('comfy.suggest_fields', t({ ko: '추천 필드 표시', en: 'Mark suggested fields' }), t({ ko: 'data.suggestedFields의 입력을 marked field로 등록해. jsonPaths를 비우면 전부 등록해.', en: 'Mark the inputs in data.suggestedFields as fields; leave jsonPaths empty for all of them.' }), pageObject({ jsonPaths: pageArray(pageChoice(suggested.map((field) => field.jsonPath)), suggested.length) }))] : []),
      pageAction(saved ? 'comfy.save' : 'comfy.register', t(saved ? { ko: '워크플로 수정 저장', en: 'Save workflow changes' } : { ko: '워크플로 등록 저장', en: 'Register workflow' }), t({ ko: '현재 편집 초안의 JSON과 marked field를 서버에 저장해. 생성을 실행하지 않아.', en: 'Save the current JSON and marked-field draft to the server without generation.' }), pageObject({}), 'save'),
    ],
    apply: (patch) => setDraft({ ...draft, ...patch } as ComfyAuthorDraft),
    applyAction: async (id, args, assertCurrent, revision) => {
      assertCurrent()
      if (id === 'comfy.save' || id === 'comfy.register') { await save(revision); return }
      if (id === 'comfy.check') {
        if (!graph || !runCheck) throw new Error('먼저 검사할 수 있는 API 형식 워크플로를 넣어줘.')
        await runCheck()
        return
      }
      if (id === 'comfy.suggest_fields') {
        const wanted = Array.isArray(args.jsonPaths) && args.jsonPaths.length > 0 ? new Set(args.jsonPaths.map(String)) : null
        const picked = suggested.filter((field) => !wanted || wanted.has(field.jsonPath))
        if (picked.length === 0) throw new Error('추가할 추천 필드가 없어.')
        const next = { ...draft, markedFields: [...draft.markedFields, ...picked.filter((field) => !draft.markedFields.some((item) => item.jsonPath === field.jsonPath || item.id === field.id))] }
        if (next.markedFields.length > 128) throw new Error('marked field는 최대 128개까지 편집할 수 있어.')
        return commit(next)
      }
      if (id !== 'comfy.author') throw new Error('등록되지 않은 워크플로 편집 작업이야.')
      const next = { ...draft, markedFields: [...draft.markedFields] }
      if (args.workflowJson !== undefined) {
        let source = String(args.workflowJson)
        // A ComfyUI editor ("Save") workflow goes through the same conversion as one pasted into the editor.
        if (isComfyUiWorkflowJson(source)) {
          let converted: Awaited<ReturnType<typeof convertComfyUiWorkflow>>
          try { converted = await convertComfyUiWorkflow(source) }
          catch (error) { throw new Error(getErrorMessage(error, '일반 워크플로를 API 형식으로 바꾸지 못했어. ComfyUI에서 Workflow → Export (API)로 내보낸 JSON을 넣어줘.'), { cause: error }) }
          assertCurrent()
          source = converted.workflow_json
          next.workflowJson = reviewedWorkflowJson(source, draft.workflowJson)
          setConversion({ workflowJson: next.workflowJson, warnings: converted.warnings })
        } else next.workflowJson = reviewedWorkflowJson(source, draft.workflowJson)
      }
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
          if (!source || (!nativeInput && !Object.hasOwn(source.inputs ?? {}, key))) throw new Error('등록할 노드 입력이 없어. JSON 변경을 먼저 적용한 뒤 바뀐 화면에서 등록해줘.')
          const field = buildWorkflowMarkedFieldFromInput(nodeId, node?.data.title ?? source.class_type ?? nodeId, source.class_type ?? '', nativeInput ?? { key, label: key, value: source.inputs![key], inferredType: typeof source.inputs![key] === 'number' ? 'number' : 'text' })
          if (entry.id !== undefined) { const id = String(entry.id); if (!/^[\w-]+$/.test(id) || isPrivateChatPageKey(id)) throw new Error('표시 필드 ID가 올바르지 않아.'); field.id = id }
          if (entry.config) Object.assign(field, configureField(field, entry.config))
          if (next.markedFields.some((item) => item.id === field.id || item.jsonPath === field.jsonPath)) throw new Error('같은 marked field가 이미 등록됐어.')
          next.markedFields.push(field)
        }
      }
      if (args.fixedSeeds) next.workflowJson = applyFixedSeeds(next.workflowJson, args.fixedSeeds as ChatPageData[])
      if (next.markedFields.length > 128) throw new Error('marked field는 최대 128개까지 편집할 수 있어.')
      if (args.fieldOrder) { const order = args.fieldOrder as string[]; if (order.length !== next.markedFields.length || new Set(order).size !== order.length || order.some((id) => !next.markedFields.some((field) => field.id === id))) throw new Error('표시 순서는 현재 모든 marked field ID를 한 번씩 입력해줘.'); next.markedFields = order.map((id) => next.markedFields.find((field) => field.id === id)!) }
      for (const field of next.markedFields) if ((field.min !== undefined && field.max !== undefined && field.min > field.max) || (field.step !== undefined && field.step <= 0)) throw new Error('marked field 숫자 범위를 확인해줘.')
      assertCurrent()
      return commit(next)
    },
  } : null)
}
