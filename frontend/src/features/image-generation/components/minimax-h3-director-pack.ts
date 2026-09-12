import type { WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import {
  buildMiniMaxH3DirectorNodeValue, createMiniMaxH3DirectorBuilderState, createMiniMaxH3DirectorItemId,
  getMiniMaxH3DirectorActiveItems, getMiniMaxH3DirectorAssets, isMiniMaxH3DirectorInputLink,
  MINIMAX_H3_DIRECTOR_MODES, normalizeMiniMaxH3DirectorBuilderState, normalizeMiniMaxH3DirectorNodeValue,
  parseMiniMaxH3DirectorTimeline, validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorMode, type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'
import { fitsMiniMaxDirectorMedia, getMiniMaxDirectorFreeSlot, getMiniMaxDirectorMediaLane, hasMiniMaxDirectorAudio, sortMiniMaxDirectorMedia } from './minimax-h3-director-media'

export type MiniMaxDirectorPackScope = 'all' | 'files' | 'prompt'
type PortableItem = Partial<MiniMaxH3DirectorTimelineItem> & Pick<MiniMaxH3DirectorTimelineItem, 'type' | 'value'> & { _rank?: number; conai_asset?: WorkflowInputAssetRef }
export type MiniMaxDirectorPack = {
  dasiwa_minimax_h3_reference_pack: true
  schema_version: 1
  model_mode: MiniMaxH3DirectorMode
  saved_at?: string
  items?: PortableItem[]
  prompt?: { prompt_mode: 'simple' | 'structured'; simple_prompt?: string; fields?: Record<string, string> }
}
const ITEM_KEYS = ['media_mode', 'audioSlot', 'trim_start', 'trim_end', 'duration', 'source_duration', 'source_width', 'source_height', 'prompt'] as const
const PROMPT_KEYS = ['imd', 'subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'soundscape', 'music'] as const

/** Parse the native reference-pack contract without accepting node connections or arbitrary draft metadata. */
export function parseMiniMaxDirectorPack(text: string): MiniMaxDirectorPack {
  const raw = JSON.parse(text)
  if (!raw || raw.dasiwa_minimax_h3_reference_pack !== true || raw.schema_version !== 1
    || !MINIMAX_H3_DIRECTOR_MODES.includes(raw.model_mode)) throw new Error('Invalid MiniMax H3 reference pack')
  const pack: MiniMaxDirectorPack = { dasiwa_minimax_h3_reference_pack: true, schema_version: 1, model_mode: raw.model_mode }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || raw.items.length > 12) throw new Error('Invalid reference item count')
    pack.items = raw.items.map((item: PortableItem) => {
      if (!item || !['image', 'video', 'audio'].includes(item.type) || typeof item.value !== 'string' || !item.value.trim()) throw new Error('Invalid reference media')
      const clean: PortableItem = { type: item.type, value: item.value }
      for (const key of ITEM_KEYS) {
        if (item[key] !== undefined) (clean as Record<string, unknown>)[key] = item[key]
      }
      if (clean.media_mode !== undefined && !['video', 'audio', 'video_audio'].includes(clean.media_mode)) throw new Error('Invalid video stream mode')
      for (const key of ['audioSlot', 'trim_start', 'trim_end', 'duration', 'source_duration', 'source_width', 'source_height'] as const) {
        if (clean[key] !== undefined && clean[key] !== null && (typeof clean[key] !== 'number' || !Number.isFinite(clean[key]) || clean[key]! < 0)) throw new Error(`Invalid ${key}`)
      }
      if (clean.prompt !== undefined && typeof clean.prompt !== 'string') throw new Error('Invalid media prompt')
      clean._rank = typeof item._rank === 'number' && Number.isInteger(item._rank) && item._rank >= 0 ? item._rank : 0
      const asset = item.conai_asset
      if (asset?.__ref === 'workflow-input-asset' && typeof asset.id === 'string' && /^[a-f0-9]{32}$/.test(asset.id)
        && typeof asset.fileName === 'string' && typeof asset.bytes === 'number') {
        clean.conai_asset = { __ref: asset.__ref, id: asset.id, fileName: asset.fileName, bytes: asset.bytes,
          ...(typeof asset.mimeType === 'string' ? { mimeType: asset.mimeType } : {}) }
      }
      return clean
    })
  }
  if (raw.prompt !== undefined) {
    if (!raw.prompt || !['simple', 'structured'].includes(raw.prompt.prompt_mode)) throw new Error('Invalid prompt pack')
    pack.prompt = { prompt_mode: raw.prompt.prompt_mode }
    if (raw.prompt.prompt_mode === 'simple') {
      if (typeof raw.prompt.simple_prompt !== 'string') throw new Error('Invalid simple prompt')
      pack.prompt.simple_prompt = raw.prompt.simple_prompt
    } else {
      pack.prompt.fields = {}
      for (const key of PROMPT_KEYS) {
        const value = raw.prompt.fields?.[key]
        if (value === undefined) continue
        if (typeof value !== 'string') throw new Error(`Invalid prompt field ${key}`)
        pack.prompt.fields[key] = value
      }
    }
  }
  if (!pack.items && !pack.prompt) throw new Error('The reference pack is empty')
  return pack
}

/** Export native JSON with optional same-CoNAI asset references; media bytes are not embedded. */
export function buildMiniMaxDirectorPack(value: Record<string, unknown>, scope: MiniMaxDirectorPackScope): MiniMaxDirectorPack {
  const node = normalizeMiniMaxH3DirectorNodeValue(value)
  if (isMiniMaxH3DirectorInputLink(node.mode) || isMiniMaxH3DirectorInputLink(node.timeline_data) || isMiniMaxH3DirectorInputLink(node.builder_state)) throw new Error('Linked Director inputs cannot be saved as a static pack')
  const pack: MiniMaxDirectorPack = { dasiwa_minimax_h3_reference_pack: true, schema_version: 1, model_mode: node.mode, saved_at: new Date().toISOString() }
  if (scope !== 'prompt') {
    const assets = getMiniMaxH3DirectorAssets(value)
    const ranks = { image: 0, video: 0, audio: 0 }
    pack.items = sortMiniMaxDirectorMedia(getMiniMaxH3DirectorActiveItems(value)).map((item) => {
      const portable: PortableItem = { type: item.type, value: item.value, _rank: ranks[item.type]++ }
      for (const key of ITEM_KEYS) if (item[key] !== undefined) (portable as Record<string, unknown>)[key] = item[key]
      if (assets[item.id]) portable.conai_asset = assets[item.id]
      return portable
    })
  }
  if (scope !== 'files') {
    const timeline = parseMiniMaxH3DirectorTimeline(node.timeline_data).timeline
    const builder = normalizeMiniMaxH3DirectorBuilderState(node.builder_state, timeline, node.mode, Number(node.duration), node.prompt)
    const fields = node.mode === 'REF2VA' ? builder.ref : builder
    const keys = node.mode === 'REF2VA' ? PROMPT_KEYS.filter((key) => key !== 'imd') : ['imd', 'soundscape', 'music'] as const
    pack.prompt = builder.prompt_mode === 'simple' ? { prompt_mode: 'simple', simple_prompt: builder.simple_prompt }
      : { prompt_mode: 'structured', fields: Object.fromEntries(keys.map((key) => [key, String(fields[key] ?? '')])) }
  }
  return pack
}

/** Prepare the entire import before publishing any change to the current editor. */
export function applyMiniMaxDirectorPack(value: Record<string, unknown>, pack: MiniMaxDirectorPack, scope: MiniMaxDirectorPackScope, append: boolean, resolvedAssets: Map<number, WorkflowInputAssetRef>) {
  const node = normalizeMiniMaxH3DirectorNodeValue(value)
  if (isMiniMaxH3DirectorInputLink(node.mode) || isMiniMaxH3DirectorInputLink(node.timeline_data) || isMiniMaxH3DirectorInputLink(node.builder_state)) throw new Error('Linked Director inputs cannot be replaced by a static pack')
  const timeline = parseMiniMaxH3DirectorTimeline(node.timeline_data).timeline
  const wantsFiles = scope !== 'prompt' && pack.items !== undefined
  const wantsPrompt = scope !== 'files' && pack.prompt !== undefined
  if (!wantsFiles && !wantsPrompt) throw new Error('The pack does not contain the selected data')
  let items = wantsFiles && !append ? [] : [...timeline.items]
  const assets = wantsFiles && !append ? {} : { ...getMiniMaxH3DirectorAssets(value) }
  if (wantsFiles) {
    // Promote the legacy closing frame before reserving its slot for appended media.
    if (pack.model_mode === 'L2VA' && !items.some((item) => item.enabled && item.type === 'image' && item.slot === 1)) {
      items = items.map((item) => item.enabled && item.type === 'image' && item.slot === 0 ? { ...item, slot: 1, start: 1 } : item)
    }
    const incoming = (pack.items ?? []).map((item, index) => ({ item, index })).sort((a, b) => (a.item._rank ?? 0) - (b.item._rank ?? 0))
    for (const { item, index } of incoming) {
      const portable = { ...item }
      delete portable._rank
      delete portable.conai_asset
      const lane = getMiniMaxDirectorMediaLane(item)
      const slot = pack.model_mode === 'REF2VA' ? getMiniMaxDirectorFreeSlot(items, lane)
        : lane !== 'image' || pack.model_mode === 'T2VA' ? null
          : (pack.model_mode === 'L2VA' ? [1] : pack.model_mode === 'FL2VA' ? [0, 1] : [0]).find((candidate) => !items.some((existing) => existing.enabled && existing.type === 'image' && existing.slot === candidate)) ?? null
      if (slot === null) throw new Error('The pack exceeds the target mode reference capacity')
      const id = createMiniMaxH3DirectorItemId(item.type)
      const next: MiniMaxH3DirectorTimelineItem = { ...portable, id, slot, start: slot, order: items.length, enabled: true, duration: item.duration ?? (item.type === 'image' ? 1 : 2) }
      delete next.audioSlot
      if (lane === 'video' && hasMiniMaxDirectorAudio(next)) {
        const audioSlot = getMiniMaxDirectorFreeSlot(items, 'audio')
        if (audioSlot === null) throw new Error('The audio reference slots are full')
        next.audioSlot = audioSlot
      }
      const asset = resolvedAssets.get(index)
      if (asset) { assets[id] = asset; next.value = asset.fileName }
      items.push(next)
    }
  }
  const active = items.filter((item) => item.enabled !== false)
  if (pack.model_mode === 'REF2VA' ? !fitsMiniMaxDirectorMedia(active)
    : active.some((item) => item.type !== 'image') || active.length > (pack.model_mode === 'T2VA' ? 0 : pack.model_mode === 'FL2VA' ? 2 : 1)) throw new Error('Existing references do not fit the saved model mode')
  let builder = normalizeMiniMaxH3DirectorBuilderState(node.builder_state, timeline, pack.model_mode, Number(node.duration), node.prompt)
  if (wantsPrompt && pack.prompt) {
    if (!append) builder = createMiniMaxH3DirectorBuilderState(pack.model_mode, Number(node.duration))
    const join = (current: string, incoming: string) => append ? [current.trim(), incoming.trim()].filter(Boolean).join('\n\n') : incoming
    builder.prompt_mode = pack.prompt.prompt_mode
    if (pack.prompt.prompt_mode === 'simple') builder.simple_prompt = join(builder.simple_prompt, pack.prompt.simple_prompt ?? '')
    else {
      for (const [key, text] of Object.entries(pack.prompt.fields ?? {})) {
        const target = pack.model_mode === 'REF2VA' ? builder.ref : builder
        target[key] = join(String(target[key] ?? ''), text)
      }
    }
  }
  const result = buildMiniMaxH3DirectorNodeValue(value, { mode: pack.model_mode }, { ...timeline, items }, assets, builder)
  const issues = validateMiniMaxH3DirectorNodeValue(result).filter((issue) => issue.code !== 'selected-model-connection')
  if (issues.length) throw new Error(issues[0].en)
  return result
}
