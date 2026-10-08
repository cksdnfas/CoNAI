import { getUserSettingsDb } from '../../database/userSettingsDb'
import { getMcpToolScope, CHAT_ROOM_TOOLS } from '../../mcp/context'
import { ChatProfileError } from './chatProfileError'
import { CHAT_SCOPES, type ChatScope } from './chatSettings'

/**
 * A tool preset: a named MCP setup (scopes + optional tool allowlist) to load into a profile. Loading copies it, so
 * editing or deleting the preset never changes a profile.
 */
export type ChatToolPreset = {
  id: number
  name: string
  scopes: ChatScope[]
  /** Only these tools (within the scopes); null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
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
    if (CHAT_ROOM_TOOLS.has(name)) return true
    const scope = getMcpToolScope(name)
    return scope !== null && (scopes as string[]).includes(scope)
  })
}

function presetName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().slice(0, PRESET_NAME_MAX_LENGTH) : ''
  if (!name) throw new ChatProfileError('프리셋 이름을 적어줘.')
  return name
}

/** A preset is a template: loading it copies its scopes and tools into a profile, which keeps them after the preset changes. */
function toPreset(row: PresetRow): ChatToolPreset {
  const scopes = normalizePresetScopes(row.scopes)
  return {
    id: row.id,
    name: row.name,
    scopes,
    toolAllowlist: normalizePresetAllowlist(row.tool_allowlist, scopes),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export const ChatToolPresetStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_tool_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as PresetRow[]
    return rows.map(toPreset)
  },

  find(presetId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_tool_presets WHERE id = ?').get(presetId) as PresetRow | undefined
    return row ? toPreset(row) : null
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

  /** Profiles keep the tools they loaded, so a preset can always go. */
  delete(presetId: number) {
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
