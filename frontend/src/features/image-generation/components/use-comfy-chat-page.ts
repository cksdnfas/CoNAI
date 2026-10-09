import { CHAT_PAGE_LIMITS, isPrivateChatPageKey, type ChatPageField } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useChatPagePermissions } from '@/features/codex-chat/use-chat-page-permissions'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { uploadWorkflowInputAsset, deleteWorkflowInputAsset } from '@/lib/api-workflow-input-assets'
import type { WorkflowFieldDraftValue } from '../image-generation-shared'
import { applyComfyChatNode, comfyNodeChatData, COMFY_NODE_PATCH_SCHEMA } from './comfy-chat-node'
import { buildMiniMaxH3DirectorNodeValue, normalizeMiniMaxH3DirectorNodeValue, parseMiniMaxH3DirectorTimeline, getMiniMaxH3DirectorAssets, createMiniMaxH3DirectorItemId, type MiniMaxH3DirectorMediaType, isMiniMaxH3DirectorInputLink } from './minimax-h3-director-dasiwa-utils'
import { fitsMiniMaxDirectorMedia, getMiniMaxDirectorFreeSlot } from './minimax-h3-director-media'
import { probeMediaDuration, probeMediaDimensions } from './minimax-h3-director-media-probe'
import { useChatPresetInsertion } from './use-chat-preset-insertion'

type Options = { enabled?: boolean; workflows?: Array<{ id: number; name: string }>; loraOptions?: string[]; onSelect?: (id: number) => void; onOpenCreate?: () => void; onOpenEdit?: (id: number, assertCurrent: () => void) => Promise<void>; onRefresh?: () => Promise<void> }
const protectedField = (field: WorkflowMarkedField) => isPrivateChatPageKey(`${field.id}.${field.label}.${field.jsonPath}`)
function mediaName(value: WorkflowFieldDraftValue | undefined) { return value && typeof value === 'object' && !Array.isArray(value) && 'fileName' in value ? String(value.fileName) : '' }

/** Normal and public ComfyUI pages share this exact input and complex-node adapter. */
export function useComfyChatPage(workflow: { id: number; name: string } | null | undefined, marked: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>, ownerId: number | null, onChange: (id: string, value: WorkflowFieldDraftValue) => void, options: Options = {}) {
  const { t } = useI18n()
  const permissions = useChatPagePermissions()
  const active = workflow?.id === ownerId
  const safe = active ? marked.filter((field) => !protectedField(field)) : []
  const nodeFields = safe.filter((field) => field.type === 'node' && ['minimax_h3_director_dasiwa', 'power_lora_loader_rgthree'].includes(field.node_editor ?? ''))
  const mediaFields = safe.filter((field) => field.type === 'image' || (field.node_editor === 'minimax_h3_director_dasiwa' && (field.node_visible_fields ?? ['timeline_data']).includes('timeline_data') && !isMiniMaxH3DirectorInputLink(normalizeMiniMaxH3DirectorNodeValue(draft[field.id]).timeline_data)))
  const media = useChatPageMedia(mediaFields.map((field) => field.id))
  const promptTargets = safe.filter((field) => field.type === 'text' || field.type === 'textarea').map((field) => field.id)
  const presets = useChatPresetInsertion(promptTargets)
  const commit = useChatDraftTransaction(draft, (next) => { for (const [id, value] of Object.entries(next)) onChange(id, value) })
  const fields: ChatPageField[] = safe.filter((field) => field.type !== 'image' && field.type !== 'node').slice(0, CHAT_PAGE_LIMITS.fields).flatMap((field) => {
    const value = draft[field.id] ?? ''
    if (typeof value !== 'string' && !(Array.isArray(value) && value.every((part) => typeof part === 'string'))) return []
    const select = field.type === 'select' && !!field.options?.length && field.options.length <= CHAT_PAGE_LIMITS.options
    return [{ id: field.id, label: field.label, type: field.type === 'number' ? 'number' as const : select ? 'select' as const : 'text' as const, value,
      ...(field.type === 'number' ? { min: field.min, max: field.max, integer: Number.isInteger(field.step) && (field.step ?? 0) >= 1, allowEmpty: !field.required } : {}), ...(select ? { options: field.options } : {}) }]
  })
  const workflowChoices = options.workflows?.slice(0, 512) ?? []
  useChatPageRegistration(options.enabled !== false ? {
    kind: 'comfyui', title: workflow ? t({ ko: 'ComfyUI · {name}', en: 'ComfyUI · {name}' }, { name: workflow.name }).slice(0, 160) : 'ComfyUI', resourceId: workflow ? String(workflow.id) : 'comfy-picker', fields, localRevision: JSON.stringify(draft),
    data: { workflows: workflowChoices.map((item) => ({ id: item.id, name: item.name })), nodes: nodeFields.map((field) => comfyNodeChatData(field, draft[field.id])), media: media.candidates, presets: presets.candidates,
      options: { ...Object.fromEntries(safe.filter((field) => field.options?.length).map((field) => [field.id, field.options!.slice(0, 512)])), loras: (options.loraOptions ?? []).slice(0, 512) }, selected: { workflowId: workflow?.id ?? 0, name: workflow?.name ?? '', images: mediaFields.map((field) => ({ fieldId: field.id, label: field.label, name: mediaName(draft[field.id]) })) } },
    actions: [...media.actions, ...presets.actions,
      ...(nodeFields.length ? [pageAction('comfy.node', t({ ko: 'H3·LoRA 노드 입력', en: 'Edit H3 or LoRA inputs' }), t({ ko: 'nodes에 나온 노드별 schema에 맞춰 patch를 입력해. 타임라인은 기존 미디어 ID만 편집하고 새 미디어는 media.attach로 등록해.', en: 'Match patch to the node-specific schema in nodes. Edit existing timeline media IDs; attach new media with media.attach.' }), pageObject({ fieldId: pageChoice(nodeFields.map((field) => field.id)), patch: COMFY_NODE_PATCH_SCHEMA }, ['fieldId', 'patch']))] : []),
      ...(options.onSelect && workflowChoices.length ? [pageAction('comfy.select', t({ ko: '워크플로 선택', en: 'Select workflow' }), t({ ko: '등록된 워크플로를 선택해. 선택한 화면이 바로 돌아오니 이어서 입력을 채워.', en: 'Select a registered workflow; the new screen comes back so you can fill its inputs next.' }), pageObject({ id: pageChoice(workflowChoices.map((item) => item.id)) }, ['id']))] : []),
      ...(options.onRefresh ? [pageAction('comfy.refresh', t({ ko: '워크플로·선택 목록 최신화', en: 'Refresh workflow and options' }), t({ ko: '서버에 저장된 최신 워크플로와 선택 목록을 다시 읽어.', en: 'Reload the latest saved workflow and input options.' }))] : []),
      ...(permissions.canUpdateWorkflows && options.onOpenCreate ? [pageAction('comfy.open_create', t({ ko: '워크플로 등록 편집기 열기', en: 'Open workflow registration editor' }), t({ ko: '새 워크플로 편집기를 열어. 열린 편집기가 바로 돌아오니 이어서 JSON·marked field를 입력해.', en: 'Open the new workflow editor; the editor comes back so you can enter JSON and marked fields next.' }))] : []),
      ...(permissions.canUpdateWorkflows && options.onOpenEdit && workflow ? [pageAction('comfy.open_edit', t({ ko: '현재 워크플로 편집기 열기', en: 'Open selected workflow editor' }), t({ ko: '현재 워크플로의 JSON과 marked field 편집기를 열어.', en: 'Open the selected workflow JSON and marked-field editor.' }))] : []),
    ],
    apply: (patch) => {
      // Validate the whole patch, including long select lists, before invoking any ordinary input handler.
      for (const [id, value] of Object.entries(patch)) { const field = safe.find((item) => item.id === id); if (!field || (field.type === 'select' && !field.options?.includes(String(value)))) throw new Error('현재 선택 목록에 없는 입력이야.') }
      for (const [id, value] of Object.entries(patch)) onChange(id, value as WorkflowFieldDraftValue)
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'comfy.select') { options.onSelect?.(Number(args.id)); return }
      if (id === 'comfy.open_create') { options.onOpenCreate?.(); return }
      if (id === 'comfy.open_edit' && workflow) { await options.onOpenEdit?.(workflow.id, assertCurrent); return }
      if (id === 'comfy.refresh') { await options.onRefresh?.(); return }
      const field = safe.find((item) => item.id === args.fieldId)
      if (!field) throw new Error('입력 필드가 바뀌었어.')
      const next = { ...draft }
      if (id === 'comfy.node') next[field.id] = applyComfyChatNode(field, draft[field.id], args.patch, options.loraOptions)
      else if (id === 'preset.insert') { const before = draft[field.id]; next[field.id] = presets.value(args, Array.isArray(before) ? before.join('\n\n') : String(before ?? '')) }
      else if (field.type === 'image') { next[field.id] = id === 'media.clear' ? '' : await (await media.load(args)).toImage(); assertCurrent() }
      else if (field.node_editor === 'minimax_h3_director_dasiwa') {
        const node = normalizeMiniMaxH3DirectorNodeValue(draft[field.id])
        const timeline = parseMiniMaxH3DirectorTimeline(node.timeline_data).timeline
        if (id === 'media.clear') next[field.id] = buildMiniMaxH3DirectorNodeValue(node, {}, { ...timeline, items: args.itemId ? timeline.items.filter((item) => item.id !== args.itemId) : [] })
        else if (id === 'media.attach') {
          const loaded = await media.load(args); assertCurrent()
          const type = loaded.blob.type.split('/')[0] as MiniMaxH3DirectorMediaType
          if (node.mode === 'T2VA' || (node.mode !== 'REF2VA' && type !== 'image')) throw new Error('현재 H3 모드에는 이 미디어 종류를 등록할 수 없어.')
          const file = new File([loaded.blob], loaded.fileName, { type: loaded.blob.type })
          const [duration, dimensions] = await Promise.all([probeMediaDuration(file, type), probeMediaDimensions(file, type)])
          assertCurrent()
          if (type !== 'image' && (duration === null || duration < 2)) throw new Error('H3 영상·오디오 참조는 최소 2초 길이가 필요해.')
          const frameSlots = node.mode === 'L2VA' ? [1] : node.mode === 'I2VA' || node.mode === 'Image Inpaint' ? [0] : [0, 1]
          const slot = args.slot === undefined ? node.mode === 'REF2VA' ? getMiniMaxDirectorFreeSlot(timeline.items, type) : frameSlots.find((slot) => !timeline.items.some((item) => item.enabled !== false && item.type === type && item.slot === slot)) ?? null : Number(args.slot)
          if (node.mode !== 'REF2VA' && slot !== null && !frameSlots.includes(slot)) throw new Error('현재 H3 모드의 프레임 슬롯이 아니야.')
          if (slot === null || timeline.items.some((item) => item.enabled !== false && item.type === type && item.slot === slot)) throw new Error('미디어 슬롯이 가득 찼거나 이미 사용 중이야.')
          const itemId = createMiniMaxH3DirectorItemId(type)
          const item = { id: itemId, type, value: loaded.fileName, enabled: true, order: timeline.items.length, slot, start: Number(args.start ?? slot), duration: Number(args.duration ?? (duration === null ? 1 : Math.min(duration, 15))), ...(duration === null ? {} : { source_duration: duration, trim_start: 0, trim_end: Math.min(duration, 15) }), ...(dimensions ?? {}), ...(type === 'video' ? { media_mode: 'video' as const } : {}) }
          if (!fitsMiniMaxDirectorMedia([...timeline.items, item])) throw new Error('H3 참조 미디어 개수 제한을 넘었어.')
          const asset = await uploadWorkflowInputAsset(file)
          try { assertCurrent(); next[field.id] = buildMiniMaxH3DirectorNodeValue(node, {}, { ...timeline, items: [...timeline.items, { ...item, value: asset.fileName }] }, { ...getMiniMaxH3DirectorAssets(node), [itemId]: asset }); return commit(next) }
          catch (error) { void deleteWorkflowInputAsset(asset.id); throw error }
        } else throw new Error('등록되지 않은 미디어 작업이야.')
      } else throw new Error('등록되지 않은 ComfyUI 작업이야.')
      assertCurrent()
      return commit(next)
    },
  } : null)
}
