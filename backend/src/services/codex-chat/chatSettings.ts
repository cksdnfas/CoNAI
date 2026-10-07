import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'

const CHAT_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'chat.json')
/** Before chat profiles: Codex chat and LLM chat each had their own settings file. */
const LEGACY_CODEX_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'codex-chat.json')
const LEGACY_LLM_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'llm-chat.json')

export type ChatSettings = {
  /** Master switch for every chat profile (Codex and API LLM). */
  enabled: boolean
  diagnostics: { enabled: boolean; captureRaw: boolean; captureLimit: number }
}

export const DEFAULT_CHAT_DIAGNOSTICS = { enabled: true, captureRaw: false, captureLimit: 20 }
export const MAX_CHAT_CAPTURE_LIMIT = 200

function diagnosticsOf(value: unknown, fallback = DEFAULT_CHAT_DIAGNOSTICS): ChatSettings['diagnostics'] {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    captureRaw: typeof input.captureRaw === 'boolean' ? input.captureRaw : fallback.captureRaw,
    captureLimit: typeof input.captureLimit === 'number' && Number.isFinite(input.captureLimit)
      ? Math.max(1, Math.min(MAX_CHAT_CAPTURE_LIMIT, Math.floor(input.captureLimit))) : fallback.captureLimit,
  }
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Legacy Codex chat settings, read once to seed the "Codex" profile. */
export function readLegacyCodexChatSettings() {
  return readJson(LEGACY_CODEX_SETTINGS_FILE_PATH)
}

let cachedSettings: ChatSettings | null = null

export function loadChatSettings(): ChatSettings {
  if (!cachedSettings) {
    const stored = readJson(CHAT_SETTINGS_FILE_PATH)
    if (stored) {
      cachedSettings = { enabled: stored.enabled === true, diagnostics: diagnosticsOf(stored.diagnostics) }
    } else {
      // First run after the profile change: chat stays on if either old switch was on.
      const legacyEnabled = readJson(LEGACY_CODEX_SETTINGS_FILE_PATH)?.enabled === true || readJson(LEGACY_LLM_SETTINGS_FILE_PATH)?.enabled === true
      cachedSettings = { enabled: legacyEnabled, diagnostics: { ...DEFAULT_CHAT_DIAGNOSTICS } }
    }
  }
  return { ...cachedSettings, diagnostics: { ...cachedSettings.diagnostics } }
}

export function updateChatSettings(patch: { enabled?: boolean; diagnostics?: Partial<ChatSettings['diagnostics']> }): ChatSettings {
  const current = loadChatSettings()
  const next: ChatSettings = { enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled, diagnostics: diagnosticsOf(patch.diagnostics, current.diagnostics) }
  fs.mkdirSync(path.dirname(CHAT_SETTINGS_FILE_PATH), { recursive: true })
  fs.writeFileSync(CHAT_SETTINGS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8')
  cachedSettings = next
  return loadChatSettings()
}

/** MCP scopes a chat may grant. Backup/restore stay out: restore overwrites data and neither belongs in a chat. */
export const CHAT_SCOPES = ['read', 'generate', 'organize', 'configure'] as const
export type ChatScope = typeof CHAT_SCOPES[number]
