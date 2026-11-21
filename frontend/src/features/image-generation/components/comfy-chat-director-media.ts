import type { ChatPageData } from '@conai/shared'
import type { WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { deleteWorkflowInputAsset, uploadWorkflowInputAsset } from '@/lib/api-workflow-input-assets'
import { buildMiniMaxH3DirectorNodeValue, createMiniMaxH3DirectorItemId, normalizeMiniMaxH3DirectorNodeValue, parseMiniMaxH3DirectorTimeline, type MiniMaxH3DirectorAssetRef, type MiniMaxH3DirectorMediaType } from './minimax-h3-director-dasiwa-utils'
import { fitsMiniMaxDirectorMedia, getMiniMaxDirectorFreeSlot } from './minimax-h3-director-media'
import { probeMediaDimensions, probeMediaDuration } from './minimax-h3-director-media-probe'

/**
 * The page assistant's media.attach / media.clear on an H3 Director field, shared by the ComfyUI page and the RefMod
 * entry draft. `assets` reads the node's assets an attach keeps: the generation page passes the workflow-input getter
 * (getMiniMaxH3DirectorAssets), the RefMod entry draft the wide one (getMiniMaxH3DirectorAssetRefs) so its own entry
 * files stay. `commit` applies the new node value; a new upload is deleted again when that does not land.
 */
export async function applyMiniMaxDirectorChatMedia(input: {
  id: string
  value: unknown
  args: Record<string, ChatPageData>
  load: (args: Record<string, ChatPageData>) => Promise<{ blob: Blob; fileName: string }>
  assertCurrent: () => void
  assets: (node: unknown) => Record<string, MiniMaxH3DirectorAssetRef>
  commit: (value: Record<string, unknown>) => WorkflowUndo
}): Promise<WorkflowUndo> {
  const { id, args, assertCurrent, commit } = input
  const node = normalizeMiniMaxH3DirectorNodeValue(input.value)
  const timeline = parseMiniMaxH3DirectorTimeline(node.timeline_data).timeline
  if (id === 'media.clear') {
    const next = buildMiniMaxH3DirectorNodeValue(node, {}, { ...timeline, items: args.itemId ? timeline.items.filter((item) => item.id !== args.itemId) : [] })
    assertCurrent()
    return commit(next)
  }
  if (id !== 'media.attach') throw new Error('등록되지 않은 미디어 작업이야.')
  const loaded = await input.load(args); assertCurrent()
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
  try {
    assertCurrent()
    return commit(buildMiniMaxH3DirectorNodeValue(node, {}, { ...timeline, items: [...timeline.items, { ...item, value: asset.fileName }] }, { ...input.assets(node), [itemId]: asset }))
  } catch (error) { void deleteWorkflowInputAsset(asset.id); throw error }
}
