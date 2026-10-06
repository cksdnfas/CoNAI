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
      cachedSettings = { enabled: stored.enabled === true }
    } else {
      // First run after the profile change: chat stays on if either old switch was on.
      const legacyEnabled = readJson(LEGACY_CODEX_SETTINGS_FILE_PATH)?.enabled === true || readJson(LEGACY_LLM_SETTINGS_FILE_PATH)?.enabled === true
      cachedSettings = { enabled: legacyEnabled }
    }
  }
  return { ...cachedSettings }
}

export function updateChatSettings(patch: Partial<ChatSettings>): ChatSettings {
  const next: ChatSettings = { enabled: typeof patch.enabled === 'boolean' ? patch.enabled : loadChatSettings().enabled }
  fs.mkdirSync(path.dirname(CHAT_SETTINGS_FILE_PATH), { recursive: true })
  fs.writeFileSync(CHAT_SETTINGS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8')
  cachedSettings = next
  return loadChatSettings()
}

/** MCP scopes a chat may grant. Backup/restore stay out: restore overwrites data and neither belongs in a chat. */
export const CHAT_SCOPES = ['read', 'generate', 'organize', 'configure'] as const
export type ChatScope = typeof CHAT_SCOPES[number]
