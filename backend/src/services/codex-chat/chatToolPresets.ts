import { getUserSettingsDb } from '../../database/userSettingsDb'
import { getMcpToolScope } from '../../mcp/context'
import { ChatProfileError } from './chatProfileError'
import { CHAT_SCOPES, type ChatScope } from './chatSettings'

/**
 * A tool preset: a named MCP grant (scopes + optional tool allowlist) kept on its own, so chat profiles link it by id
 * the way they link lorebooks and display blocks. Editing the preset reaches every linked profile; a profile without
 * a preset keeps its own scopes and allowlist ("direct" setup).
 */
export type ChatToolPreset = {
  id: number
  name: string
  scopes: ChatScope[]
  /** Only these tools (within the scopes); null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  /** Profiles that link this preset. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

const PRESET_NAME_MAX_LENGTH = 80
const TOOL_NAME_PATTERN = /^[a-z0-9_]{1,64}$/

/** The file a preset is exported as (and imported from); a bare preset or an array of either is accepted too. */
export const TOOL_PRESET_FILE_MARK = 'conai_tool_preset'

type PresetRow = { id: number; name: string; scopes: string; tool_allowlist: string | null; created_date: string; updated_date: string }

function parseJsonList(value: unknown): unknown[] | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  return Array.isArray(value) ? value : null
}

export function normalizePresetScopes(value: unknown): ChatScope[] {
  const list = parseJsonList(value) ?? []
  const scopes = CHAT_SCOPES.filter((scope) => list.includes(scope))
  return scopes.length > 0 ? [...scopes] : ['read']
}

/** Tool names the server knows within these scopes; null (every tool) stays null, and an empty list stays empty. */
export function normalizePresetAllowlist(value: unknown, scopes: ChatScope[]): string[] | null {
  const list = parseJsonList(value)
  if (!list) return null
  const names = list.filter((name): name is string => typeof name === 'string' && TOOL_NAME_PATTERN.test(name))
  return [...new Set(names)].filter((name) => {
    const scope = getMcpToolScope(name)
    return scope !== null && (scopes as string[]).includes(scope)
  })
}

function presetName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().slice(0, PRESET_NAME_MAX_LENGTH) : ''
  if (!name) throw new ChatProfileError('프리셋 이름을 적어줘.')
  return name
}

function linkedProfiles() {
  return getUserSettingsDb().prepare('SELECT id, name, tool_preset_id FROM llm_chat_profiles WHERE tool_preset_id IS NOT NULL ORDER BY sort_order ASC, id ASC').all() as Array<{ id: number; name: string; tool_preset_id: number }>
}

function toPreset(row: PresetRow, profiles: ReturnType<typeof linkedProfiles>): ChatToolPreset {
  const scopes = normalizePresetScopes(row.scopes)
  return {
    id: row.id,
    name: row.name,
    scopes,
    toolAllowlist: normalizePresetAllowlist(row.tool_allowlist, scopes),
    profiles: profiles.filter((profile) => profile.tool_preset_id === row.id).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export const ChatToolPresetStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_tool_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as PresetRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toPreset(row, profiles))
  },

  find(presetId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_tool_presets WHERE id = ?').get(presetId) as PresetRow | undefined
    return row ? toPreset(row, linkedProfiles()) : null
  },

  /** The grant a preset gives, or null when the preset is gone (the profile then falls back to its own columns). */
  grantOf(presetId: number | null): { scopes: ChatScope[]; toolAllowlist: string[] | null } | null {
    if (presetId === null) return null
    const row = getUserSettingsDb().prepare('SELECT scopes, tool_allowlist FROM chat_tool_presets WHERE id = ?').get(presetId) as Pick<PresetRow, 'scopes' | 'tool_allowlist'> | undefined
    if (!row) return null
    const scopes = normalizePresetScopes(row.scopes)
    return { scopes, toolAllowlist: normalizePresetAllowlist(row.tool_allowlist, scopes) }
  },

  /** The id when that preset exists, else null. */
  existing(presetId: unknown): number | null {
    const id = Number(presetId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const row = getUserSettingsDb().prepare('SELECT id FROM chat_tool_presets WHERE id = ?').get(id) as { id: number } | undefined
    return row ? row.id : null
  },

  create(input: { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }) {
    const scopes = normalizePresetScopes(input.scopes)
    const allowlist = normalizePresetAllowlist(input.toolAllowlist, scopes)
    const result = getUserSettingsDb().prepare('INSERT INTO chat_tool_presets (name, scopes, tool_allowlist) VALUES (?, ?, ?)')
      .run(presetName(input.name), JSON.stringify(scopes), allowlist ? JSON.stringify(allowlist) : null)
    return ChatToolPresetStore.find(Number(result.lastInsertRowid)) as ChatToolPreset
  },

  update(presetId: number, patch: { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }) {
    const current = ChatToolPresetStore.find(presetId)
    if (!current) return null
    const scopes = patch.scopes === undefined ? current.scopes : normalizePresetScopes(patch.scopes)
    const allowlist = normalizePresetAllowlist(patch.toolAllowlist === undefined ? current.toolAllowlist : patch.toolAllowlist, scopes)
    getUserSettingsDb().prepare('UPDATE chat_tool_presets SET name = ?, scopes = ?, tool_allowlist = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(
      patch.name === undefined ? current.name : presetName(patch.name),
      JSON.stringify(scopes),
      allowlist ? JSON.stringify(allowlist) : null,
      presetId,
    )
    return ChatToolPresetStore.find(presetId)
  },

  /** A preset in use cannot go: the profiles would silently lose their tools. Unlink them (or pick another) first. */
  delete(presetId: number) {
    const current = ChatToolPresetStore.find(presetId)
    if (!current) return false
    if (current.profiles.length > 0) {
      throw new ChatProfileError(`프로필 ${current.profiles.length}개가 이 프리셋을 쓰고 있어. 먼저 그 프로필의 프리셋을 바꿔줘.`)
    }
    return getUserSettingsDb().prepare('DELETE FROM chat_tool_presets WHERE id = ?').run(presetId).changes > 0
  },
}

/** What a preset file holds: the export shape, a bare preset, or an array of either. */
export function readToolPresetFile(value: unknown): Array<{ name: string; scopes: ChatScope[]; toolAllowlist: string[] | null }> {
  const items = Array.isArray(value) ? value : [value]
  const read = items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const inner = record.preset && typeof record.preset === 'object' ? record.preset as Record<string, unknown> : record
    if (!Array.isArray(inner.scopes)) return []
    const scopes = normalizePresetScopes(inner.scopes)
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, PRESET_NAME_MAX_LENGTH) : typeof inner.name === 'string' ? inner.name.trim().slice(0, PRESET_NAME_MAX_LENGTH) : ''
    return [{ name: name || '도구 프리셋', scopes, toolAllowlist: normalizePresetAllowlist(inner.toolAllowlist, scopes) }]
  })
  if (read.length === 0) throw new ChatProfileError('가져올 도구 프리셋이 없어. 내보낸 프리셋 JSON을 골라줘.')
  return read.slice(0, 50)
}
