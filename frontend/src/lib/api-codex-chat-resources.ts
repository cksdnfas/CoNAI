// Chat display blocks, tool and generation presets, and skills.
// Lower layer than api-codex-chat.ts, which re-exports this file: import only from api-codex-chat-core and the modules before this one, never from api-codex-chat.ts.

import { requestApiData } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import { getDownloadFileName, prepareDownloadTarget, readDownloadBlob, saveDownloadBlob } from '@/lib/download-utils'
import type { ChatSkillSectionChange, ChatSkillSectionFields } from '@conai/shared'
import { JSON_HEADERS, requestRevisionChecked } from './api-codex-chat-core'
import type { ChatScope } from './api-codex-chat-core'

export const CHAT_BLOCKS_QUERY_KEY = ['codex-chat-blocks'] as const
export const CHAT_SKILLS_QUERY_KEY = ['codex-chat-skills'] as const
export const CHAT_TOOL_PRESETS_QUERY_KEY = ['codex-chat-tool-presets'] as const
export const CHAT_GENERATION_PRESETS_QUERY_KEY = ['codex-chat-generation-presets'] as const

export type ChatTypeface = 'sans' | 'serif' | 'mono'

/** A rule the server holds a block field to when the model writes it (hand edits are free). */
export interface ChatBlockField {
  tone?: import('@conai/shared').ChatBlockTone
  name: string
  /** What people read for this field (chips, change log); the model keeps writing `name`. */
  label?: string
  min: number | null
  max: number | null
  /** Largest change per reply (numbers). */
  step: number | null
  /** Allowed values; empty: any. */
  values: string[]
  readonly: boolean
}

/** A designed card: the model writes ```key + JSON values, the chat fills `template` ({{field}} slots) styled by `css`. */
export interface ChatDisplayBlock {
  id: string
  key: string
  /** The shared block's name, for people (the status panel title). */
  name?: string
  /** When the model should use it (sent in the system prompt). */
  instruction: string
  /** Example JSON values: the format shown to the model, and the editor preview's data. */
  example: string
  template: string
  css: string
  /** How the values move; the model reads it with the current values. */
  rules: string
  /** One-line template of the folded status strip (`{{place}} · HP {{hp}}`); empty picks the first scalar fields. */
  summary: string
  /** Rules the server enforces on the model's updates, by field. */
  fields: ChatBlockField[]
  enabled: boolean
}

/** One field a reply or a hand edit changed; `from` / `to` are absent when the field was added / removed. */
export interface ChatBlockChange {
  field: string
  from?: unknown
  to?: unknown
}

/** The display block state of a chat: current values per block and what each message changed. */
export interface ChatBlocksState {
  state: Record<string, Record<string, unknown>>
  changes: Record<number, Record<string, ChatBlockChange[]>>
  edits: Record<string, Record<string, ChatBlockChange[]>>
}

/** A shared display block (status card); profiles link it by id, so editing it reaches every linked profile. */
export interface ChatSharedBlock {
  id: number
  name: string
  block: ChatDisplayBlock
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

/** The file a block exports as; import also takes a bare block or an array of either. */
export const CHAT_BLOCK_FILE_MARK = 'conai_display_block'

/** A tool preset (MCP scopes + tool allowlist) to load into a profile; loading copies it, so the preset can change freely. */
export interface ChatToolPreset {
  id: number
  name: string
  scopes: ChatScope[]
  /** Only these tools; null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  createdDate: string
  updatedDate: string
}

export type ChatToolPresetInput = { name: string; scopes: ChatScope[]; toolAllowlist: string[] | null }

/** The file a tool preset exports as; import also takes a bare preset or an array of either. */
export const CHAT_TOOL_PRESET_FILE_MARK = 'conai_tool_preset'

export type ChatNaiPresetSize = { label: string; width: number; height: number }

/** The fixed NovelAI setup of a generation preset; the model fills only the scene prompt (and a size when several are allowed). */
export interface ChatNaiPresetConfig {
  model: string
  sampler: string
  noiseSchedule: string
  steps: number
  scale: number
  varietyPlus: boolean
  transparentBackground: boolean
  promptPrefix: string
  promptSuffix: string
  negativePrompt: string
  sizes: ChatNaiPresetSize[]
  characters: Array<{ prompt: string; uc: string; center_x: number; center_y: number }>
  useCoords: boolean
  vibes: Array<{ encoded: string; strength: number; information_extracted: number }>
  characterRefs: Array<{ image: string; type: string; strength: number; fidelity: number }>
  characterReference?: 'none' | 'replace' | 'append'
}

/** One ComfyUI workflow with fixed inputs; the model fills the exposed marked fields. */
export interface ChatComfyPresetConfig {
  workflowId: number
  serverId: number | null
  serverTag: string | null
  fixedInputs: Record<string, unknown>
  exposedFieldIds: string[]
  referenceField?: string | null
  /** The text field that takes a character asset's slot prompt; null: found on its own when clear. */
  promptField?: string | null
}

export type ChatGenerationPresetKind = 'nai' | 'comfyui'

/** A generation preset; each one a profile links becomes a generate_image tool, and free-form generation is withheld. */
export interface ChatGenerationPreset {
  id: number
  name: string
  /** What the model is told the preset is for. */
  instruction: string
  kind: ChatGenerationPresetKind
  nai: ChatNaiPresetConfig | null
  comfyui: ChatComfyPresetConfig | null
  prompting: ChatPresetPrompting
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
  /** How the preset can make character assets (admin list only). */
  assetSupport?: ChatPresetAssetSupport
  /** Why the preset's tool cannot run now: workflow gone, a fixed value outside its dropdown (admin list only). */
  problem?: string | null
}

/**
 * `reference`: draws from the reference image (NAI character reference or a ComfyUI image input); `appearance`: a
 * text-to-image workflow, drawing from the appearance text alone; null: cannot make assets (`problem` says why).
 */
export type ChatPresetAssetSupport = { mode: 'reference' | 'appearance' | null; problem: string | null; promptChoices: Array<{ id: string; label: string }>; imageChoices: Array<{ id: string; label: string }> }

/**
 * How a preset's scene prompt is written. `inline`: the chat model fills the tool while it replies; `after`: it only
 * asks for a picture, and the prompt is written from the finished reply. The writer gets the guide (text and one
 * section of a shared skill; `skillName` / `title` null once that skill or section is gone) and the chat's latest
 * `previousImages`.
 */
export interface ChatPresetPrompting {
  timing: 'inline' | 'after'
  guide: string
  guideSkill: { skillId: number; path: string; skillName: string | null; title: string | null; updatedDate: string | null } | null
  previousImages: number
}

/** What the editor keeps and saves: the guide section by skill id and path (null unlinks). */
export type ChatPresetPromptingInput = Pick<ChatPresetPrompting, 'timing' | 'guide' | 'previousImages'> & { guideSkill: { skillId: number; path: string } | null }

export const CHAT_PRESET_PREVIOUS_IMAGES_MAX = 4

export type ChatGenerationPresetInput = { name: string; instruction: string; kind: ChatGenerationPresetKind; nai: ChatNaiPresetConfig | null; comfyui: ChatComfyPresetConfig | null; prompting?: ChatPresetPromptingInput }

/** The file a generation preset exports as; import also takes a bare preset or an array of either. */
export const CHAT_GENERATION_PRESET_FILE_MARK = 'conai_generation_preset'

export function listChatBlocks() {
  return requestApiData<ChatSharedBlock[]>('/api/codex-chat/admin/blocks')
}

export function createChatBlock(input: { name: string; block: ChatDisplayBlock }) {
  return requestApiData<ChatSharedBlock>('/api/codex-chat/admin/blocks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a block JSON file; every block in it becomes a shared block. */
export function importChatBlocks(contents: unknown) {
  return requestApiData<ChatSharedBlock[]>('/api/codex-chat/admin/blocks/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatBlock(blockId: number, patch: { name?: string; block?: ChatDisplayBlock }) {
  return requestApiData<ChatSharedBlock>(`/api/codex-chat/admin/blocks/${blockId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatBlock(blockId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/blocks/${blockId}`, { method: 'DELETE' })
}

export type ChatSkillSource = 'user' | 'import' | 'plugin'
type ChatSkillUsage = { loadCount: number; lastLoadedAt: string | null }

/** One section of a stored skill, with how often use_skill loaded it. */
export type ChatSkillSection = ChatSkillSectionFields & ChatSkillUsage & { updatedDate: string }

interface ChatSkillBase extends ChatSkillUsage {
  id: number
  name: string
  description: string
  category: string
  /** `plugin`: read-only, owned by `pluginId`; `enabled` false while that plugin is off. */
  source: ChatSkillSource
  pluginId: string | null
  enabled: boolean
  revision: number
  /** Profiles that link this skill. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

/**
 * A shared skill: a package profiles link by id. The chat model sees the name and the description (when to use it);
 * use_skill returns the overview (`instructions`) with a table of the sections, then each section it asks for.
 */
export interface ChatSkill extends ChatSkillBase {
  instructions: string
  sections: ChatSkillSection[]
}

/** A list row: no overview or section text, only their lengths. */
export interface ChatSkillSummary extends ChatSkillBase {
  instructionsLength: number
  sections: Array<Pick<ChatSkillSection, 'path' | 'title' | 'summary' | 'loadCount' | 'lastLoadedAt'> & { length: number; tokens: number }>
}

/** A skill's own contents: what a draft, a preview, a stored version and an import carry. */
export type ChatSkillSnapshot = { name: string; description: string; category: string; instructions: string; sections: ChatSkillSectionFields[] }

/** What use_skill would return for a draft: the system prompt line, the first result, each section's result. */
export type ChatSkillPreview = {
  index: string
  overview: string
  sections: Array<{ path: string; text: string }>
  tokens: { index: number; overview: number; sections: Record<string, number> }
  warnings: string[]
}

export type ChatSkillVersionSummary = { revision: number; savedDate: string; name: string; sectionCount: number }

export const chatSkillQueryKey = (skillId: number) => [...CHAT_SKILLS_QUERY_KEY, 'detail', skillId] as const
export const chatSkillVersionsQueryKey = (skillId: number) => [...CHAT_SKILLS_QUERY_KEY, 'versions', skillId] as const

export function listChatSkills() {
  return requestApiData<ChatSkillSummary[]>('/api/codex-chat/admin/skills')
}

export function getChatSkill(skillId: number, signal?: AbortSignal) {
  return requestApiData<ChatSkill>(`/api/codex-chat/admin/skills/${skillId}`, { signal, cache: 'no-store' })
}

export function createChatSkill(input: Pick<ChatSkillSnapshot, 'name' | 'description' | 'instructions'> & Partial<Pick<ChatSkillSnapshot, 'category' | 'sections'>> & { source?: 'user' | 'import' }) {
  return requestApiData<ChatSkill>('/api/codex-chat/admin/skills', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** `sections` replaces them all in order; `sectionChanges` edits single ones (refused once their `before` is stale). */
export function updateChatSkill(skillId: number, patch: Partial<ChatSkillSnapshot> & { sectionChanges?: ChatSkillSectionChange[]; revision?: number }) {
  return requestRevisionChecked<ChatSkill>(`/api/codex-chat/admin/skills/${skillId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatSkill(skillId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/skills/${skillId}`, { method: 'DELETE' })
}

export function previewChatSkill(draft: ChatSkillSnapshot & { skillId?: number }, signal?: AbortSignal) {
  return requestApiData<ChatSkillPreview>('/api/codex-chat/admin/skills/preview', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(draft), signal })
}

/** Earlier revisions, newest first. */
export function listChatSkillVersions(skillId: number) {
  return requestApiData<{ current: number; versions: ChatSkillVersionSummary[] }>(`/api/codex-chat/admin/skills/${skillId}/versions`, { cache: 'no-store' })
}

export function getChatSkillVersion(skillId: number, revision: number) {
  return requestApiData<{ revision: number; savedDate: string; snapshot: ChatSkillSnapshot }>(`/api/codex-chat/admin/skills/${skillId}/versions/${revision}`)
}

/** Saves revision `from`'s contents as a new revision; `revision` is the one the person looked at. */
export function restoreChatSkill(skillId: number, from: number, revision: number) {
  return requestRevisionChecked<ChatSkill>(`/api/codex-chat/admin/skills/${skillId}/restore`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ from, revision }) })
}

/** The skill as an Agent Skills ZIP (`<slug>/SKILL.md` + `references/*.md`). */
export async function downloadChatSkillExport(skillId: number, name: string) {
  const fallback = `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'skill'}.zip`
  const target = await prepareDownloadTarget(fallback)
  if (!target) return
  const response = await fetch(buildApiUrl(`/api/codex-chat/admin/skills/${skillId}/export`), { credentials: 'include', headers: { Accept: 'application/zip' } })
  const blob = await readDownloadBlob(response)
  await saveDownloadBlob(target, blob, getDownloadFileName(response.headers.get('Content-Disposition'), fallback))
}

/** Reads an Agent Skills `.zip` or a `SKILL.md` into a draft; nothing is saved. */
export function importChatSkillFile(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<{ draft: ChatSkillSnapshot; warnings: string[] }>('/api/codex-chat/admin/skills/import', { method: 'POST', body })
}

export function listChatToolPresets() {
  return requestApiData<ChatToolPreset[]>('/api/codex-chat/admin/tool-presets')
}

export function createChatToolPreset(input: ChatToolPresetInput) {
  return requestApiData<ChatToolPreset>('/api/codex-chat/admin/tool-presets', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a preset JSON file; every preset in it becomes a tool preset. */
export function importChatToolPresets(contents: unknown) {
  return requestApiData<ChatToolPreset[]>('/api/codex-chat/admin/tool-presets/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatToolPreset(presetId: number, patch: Partial<ChatToolPresetInput>) {
  return requestApiData<ChatToolPreset>(`/api/codex-chat/admin/tool-presets/${presetId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatToolPreset(presetId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/tool-presets/${presetId}`, { method: 'DELETE' })
}

export function listChatGenerationPresets() {
  return requestApiData<ChatGenerationPreset[]>('/api/codex-chat/admin/generation-presets')
}

export function createChatGenerationPreset(input: ChatGenerationPresetInput) {
  return requestApiData<ChatGenerationPreset>('/api/codex-chat/admin/generation-presets', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a preset JSON file; every preset in it becomes a generation preset. */
export function importChatGenerationPresets(contents: unknown) {
  return requestApiData<ChatGenerationPreset[]>('/api/codex-chat/admin/generation-presets/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatGenerationPreset(presetId: number, patch: Partial<ChatGenerationPresetInput>) {
  return requestApiData<ChatGenerationPreset>(`/api/codex-chat/admin/generation-presets/${presetId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatGenerationPreset(presetId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/generation-presets/${presetId}`, { method: 'DELETE' })
}
