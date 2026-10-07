import { getUserSettingsDb } from '../../database/userSettingsDb'
import { createHash } from 'crypto'
import { WorkflowModel } from '../../models/Workflow'
import { ChatProfileError } from './chatProfileError'

/**
 * A generation preset: everything a chat bot's image generation needs except what the model should decide. Linked
 * by chat profiles (like lorebooks); each linked preset becomes one `generate_image` tool whose input schema holds
 * only the exposed fields, and while a profile has any preset the free-form generation and workflow discovery tools
 * are withheld. Editing a preset reaches every linked profile.
 */
export type ChatGenerationPresetKind = 'nai' | 'comfyui'

export type ChatNaiPresetSize = { label: string; width: number; height: number }

export type ChatNaiPresetConfig = {
  model: string
  sampler: string
  noiseSchedule: string
  steps: number
  scale: number
  varietyPlus: boolean
  transparentBackground: boolean
  /** Fixed text put before the model's scene tags (quality, artist, style). */
  promptPrefix: string
  /** Fixed text put after the scene tags. */
  promptSuffix: string
  negativePrompt: string
  /** Allowed sizes; one is fixed, two or more are offered to the model as a choice. */
  sizes: ChatNaiPresetSize[]
  /** Fixed per-character prompts (NAI v4+). */
  characters: Array<{ prompt: string; uc: string; center_x: number; center_y: number }>
  useCoords: boolean
  vibes: Array<{ encoded: string; strength: number; information_extracted: number }>
  characterRefs: Array<{ image: string; type: string; strength: number; fidelity: number }>
}

export type ChatComfyPresetConfig = {
  workflowId: number
  serverId: number | null
  serverTag: string | null
  /** Values for the marked fields the model does not fill (the workflow's defaults cover the rest). */
  fixedInputs: Record<string, unknown>
  /** Marked fields the model fills. */
  exposedFieldIds: string[]
}

export type ChatGenerationPreset = {
  id: number
  name: string
  /** What the model is told the preset is for (shown in the tool description), e.g. "캐릭터 전신 일러스트". */
  instruction: string
  kind: ChatGenerationPresetKind
  nai: ChatNaiPresetConfig | null
  comfyui: ChatComfyPresetConfig | null
  /** Profiles that link this preset. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatGenerationPresetInput = { name?: unknown; instruction?: unknown; kind?: unknown; nai?: unknown; comfyui?: unknown }

export const PROFILE_MAX_GENERATION_PRESETS = 8
const NAME_MAX_LENGTH = 80
const INSTRUCTION_MAX_LENGTH = 400
const TEXT_MAX_LENGTH = 8000
const LIST_MAX = 8

/** The file a preset is exported as (and imported from); a bare preset or an array of either is accepted too. */
export const GENERATION_PRESET_FILE_MARK = 'conai_generation_preset'

const DEFAULT_NAI: ChatNaiPresetConfig = {
  model: 'nai-diffusion-4-5-curated',
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  steps: 28,
  scale: 5,
  varietyPlus: false,
  transparentBackground: false,
  promptPrefix: '',
  promptSuffix: '',
  negativePrompt: '',
  sizes: [{ label: 'Portrait 832×1216', width: 832, height: 1216 }],
  characters: [],
  useCoords: false,
  vibes: [],
  characterRefs: [],
}

type PresetRow = { id: number; name: string; instruction: string; kind: string; config: string; created_date: string; updated_date: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback
}

function number(value: unknown, range: { min: number; max: number }, fallback: number, integer = false) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback
  const clamped = Math.min(range.max, Math.max(range.min, parsed))
  return integer ? Math.round(clamped) : clamped
}

function sizeOf(value: unknown): ChatNaiPresetSize | null {
  if (!isRecord(value)) return null
  const width = number(value.width, { min: 64, max: 4096 }, 0, true)
  const height = number(value.height, { min: 64, max: 4096 }, 0, true)
  if (!width || !height) return null
  return { label: text(value.label, 40) || `${width}×${height}`, width, height }
}

export function normalizeNaiPresetConfig(value: unknown): ChatNaiPresetConfig {
  const raw = isRecord(value) ? value : {}
  const sizes = (Array.isArray(raw.sizes) ? raw.sizes : []).map(sizeOf).filter((size): size is ChatNaiPresetSize => size !== null).slice(0, LIST_MAX)
  const seen = new Set<string>()
  const uniqueSizes = sizes.filter((size) => {
    const key = size.label.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    model: text(raw.model, 80) || DEFAULT_NAI.model,
    sampler: text(raw.sampler, 80) || DEFAULT_NAI.sampler,
    noiseSchedule: text(raw.noiseSchedule, 40) || DEFAULT_NAI.noiseSchedule,
    steps: number(raw.steps, { min: 1, max: 50 }, DEFAULT_NAI.steps, true),
    scale: number(raw.scale, { min: 0, max: 30 }, DEFAULT_NAI.scale),
    varietyPlus: raw.varietyPlus === true,
    transparentBackground: raw.transparentBackground === true,
    promptPrefix: text(raw.promptPrefix, TEXT_MAX_LENGTH),
    promptSuffix: text(raw.promptSuffix, TEXT_MAX_LENGTH),
    negativePrompt: text(raw.negativePrompt, TEXT_MAX_LENGTH),
    sizes: uniqueSizes.length > 0 ? uniqueSizes : [...DEFAULT_NAI.sizes],
    characters: (Array.isArray(raw.characters) ? raw.characters : []).flatMap((entry) => {
      if (!isRecord(entry)) return []
      const prompt = text(entry.prompt, TEXT_MAX_LENGTH)
      if (!prompt) return []
      return [{ prompt, uc: text(entry.uc, TEXT_MAX_LENGTH), center_x: number(entry.center_x, { min: 0, max: 1 }, 0.5), center_y: number(entry.center_y, { min: 0, max: 1 }, 0.5) }]
    }).slice(0, LIST_MAX),
    useCoords: raw.useCoords === true,
    vibes: (Array.isArray(raw.vibes) ? raw.vibes : []).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.encoded !== 'string' || !entry.encoded.trim()) return []
      return [{ encoded: entry.encoded.trim(), strength: number(entry.strength, { min: 0, max: 1 }, 0.6), information_extracted: number(entry.information_extracted, { min: 0, max: 1 }, 1) }]
    }).slice(0, LIST_MAX),
    characterRefs: (Array.isArray(raw.characterRefs) ? raw.characterRefs : []).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.image !== 'string' || !entry.image.startsWith('data:image/')) return []
      const type = entry.type === 'style' || entry.type === 'character&style' ? entry.type : 'character'
      return [{ image: entry.image, type, strength: number(entry.strength, { min: 0, max: 1 }, 0.6), fidelity: number(entry.fidelity, { min: 0, max: 1 }, 1) }]
    }).slice(0, LIST_MAX),
  }
}

export function normalizeComfyPresetConfig(value: unknown): ChatComfyPresetConfig {
  const raw = isRecord(value) ? value : {}
  const workflowId = number(raw.workflowId, { min: 1, max: Number.MAX_SAFE_INTEGER }, 0, true)
  if (!workflowId) throw new ChatProfileError('ComfyUI 프리셋에는 워크플로가 필요해.')
  const serverId = number(raw.serverId, { min: 1, max: Number.MAX_SAFE_INTEGER }, 0, true) || null
  const serverTag = text(raw.serverTag, 64) || null
  return {
    workflowId,
    serverId,
    serverTag: serverId ? null : serverTag,
    fixedInputs: isRecord(raw.fixedInputs) ? raw.fixedInputs : {},
    exposedFieldIds: [...new Set((Array.isArray(raw.exposedFieldIds) ? raw.exposedFieldIds : []).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 50),
  }
}

function presetName(value: unknown) {
  const name = text(value, NAME_MAX_LENGTH)
  if (!name) throw new ChatProfileError('프리셋 이름을 적어줘.')
  return name
}

function kindOf(value: unknown): ChatGenerationPresetKind {
  if (value === 'nai' || value === 'comfyui') return value
  throw new ChatProfileError('프리셋 종류는 nai 또는 comfyui여야 해.')
}

export function normalizeGenerationPresetIds(value: unknown): number[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, PROFILE_MAX_GENERATION_PRESETS)
}

function linkedProfiles() {
  const rows = getUserSettingsDb().prepare("SELECT id, name, generation_preset_ids FROM llm_chat_profiles WHERE generation_preset_ids IS NOT NULL AND generation_preset_ids != '[]' ORDER BY sort_order ASC, id ASC").all() as Array<{ id: number; name: string; generation_preset_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, presetIds: normalizeGenerationPresetIds(row.generation_preset_ids) }))
}

function parseConfig(row: PresetRow): Pick<ChatGenerationPreset, 'kind' | 'nai' | 'comfyui'> {
  let raw: unknown = null
  try { raw = JSON.parse(row.config) } catch { raw = null }
  const kind: ChatGenerationPresetKind = row.kind === 'comfyui' ? 'comfyui' : 'nai'
  if (kind === 'comfyui') {
    try {
      return { kind, nai: null, comfyui: normalizeComfyPresetConfig(raw) }
    } catch {
      return { kind, nai: null, comfyui: { workflowId: 0, serverId: null, serverTag: null, fixedInputs: {}, exposedFieldIds: [] } }
    }
  }
  return { kind, nai: normalizeNaiPresetConfig(raw), comfyui: null }
}

function toPreset(row: PresetRow, profiles: ReturnType<typeof linkedProfiles>): ChatGenerationPreset {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    ...parseConfig(row),
    profiles: profiles.filter((profile) => profile.presetIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function columnsOf(input: ChatGenerationPresetInput, current: ChatGenerationPreset | null) {
  const kind = input.kind === undefined && current ? current.kind : kindOf(input.kind)
  const config = kind === 'nai'
    ? normalizeNaiPresetConfig(input.nai === undefined && current ? current.nai : input.nai)
    : normalizeComfyPresetConfig(input.comfyui === undefined && current ? current.comfyui : input.comfyui)
  return {
    name: input.name === undefined && current ? current.name : presetName(input.name),
    instruction: input.instruction === undefined && current ? current.instruction : text(input.instruction, INSTRUCTION_MAX_LENGTH),
    kind,
    config: JSON.stringify(config),
  }
}

export const ChatGenerationPresetStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_generation_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as PresetRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toPreset(row, profiles))
  },

  find(presetId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_generation_presets WHERE id = ?').get(presetId) as PresetRow | undefined
    return row ? toPreset(row, linkedProfiles()) : null
  },

  /** Ids of these that still exist, in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_generation_presets WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /** The presets a profile links, in link order; a missing one is skipped. */
  resolve(ids: number[]): ChatGenerationPreset[] {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT * FROM chat_generation_presets WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as PresetRow[]
    const byId = new Map(rows.map((row) => [row.id, toPreset(row, [])]))
    return ids.flatMap((id) => { const preset = byId.get(id); return preset ? [preset] : [] })
  },

  /** Changes whenever a linked preset is edited, so a Codex process (whose tool schemas are fixed at start) is replaced. */
  signature(ids: number[]) {
    if (ids.length === 0) return ''
    return createHash('sha256').update(JSON.stringify(ChatGenerationPresetStore.resolve(ids))).digest('hex')
  },

  create(input: ChatGenerationPresetInput) {
    const columns = columnsOf(input, null)
    const result = getUserSettingsDb().prepare('INSERT INTO chat_generation_presets (name, instruction, kind, config) VALUES (?, ?, ?, ?)')
      .run(columns.name, columns.instruction, columns.kind, columns.config)
    return ChatGenerationPresetStore.find(Number(result.lastInsertRowid)) as ChatGenerationPreset
  },

  update(presetId: number, patch: ChatGenerationPresetInput) {
    const current = ChatGenerationPresetStore.find(presetId)
    if (!current) return null
    const columns = columnsOf(patch, current)
    getUserSettingsDb().prepare('UPDATE chat_generation_presets SET name = ?, instruction = ?, kind = ?, config = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
      .run(columns.name, columns.instruction, columns.kind, columns.config, presetId)
    return ChatGenerationPresetStore.find(presetId)
  },

  /** A preset in use cannot go: the profiles would silently fall back to free-form generation. */
  delete(presetId: number) {
    const current = ChatGenerationPresetStore.find(presetId)
    if (!current) return false
    if (current.profiles.length > 0) {
      throw new ChatProfileError(`프로필 ${current.profiles.length}개가 이 프리셋을 쓰고 있어. 먼저 그 프로필에서 연결을 풀어줘.`)
    }
    return getUserSettingsDb().prepare('DELETE FROM chat_generation_presets WHERE id = ?').run(presetId).changes > 0
  },
}

/** A ComfyUI preset's workflow, or the reason it cannot run (the tool reports it instead of failing silently). */
export function resolvePresetWorkflow(config: ChatComfyPresetConfig) {
  const workflow = WorkflowModel.findByIdIncludingDeleted(config.workflowId)
  if (!workflow || workflow.deleted_at) return { workflow: null, problem: `워크플로 ${config.workflowId}가 삭제됐어.` }
  if (!workflow.is_active) return { workflow: null, problem: `워크플로 "${workflow.name}"가 비활성 상태야.` }
  return { workflow, problem: null }
}

/** What a preset file holds: the export shape, a bare preset, or an array of either. */
export function readGenerationPresetFile(value: unknown): ChatGenerationPresetInput[] {
  const items = Array.isArray(value) ? value : [value]
  const read = items.flatMap((item) => {
    if (!isRecord(item)) return []
    const inner = isRecord(item.preset) ? item.preset : item
    if (inner.kind !== 'nai' && inner.kind !== 'comfyui') return []
    return [{ name: item.name ?? inner.name ?? '생성 프리셋', instruction: item.instruction ?? inner.instruction ?? '', kind: inner.kind, nai: inner.nai, comfyui: inner.comfyui }]
  })
  if (read.length === 0) throw new ChatProfileError('가져올 생성 프리셋이 없어. 내보낸 프리셋 JSON을 골라줘.')
  return read.slice(0, 20)
}
