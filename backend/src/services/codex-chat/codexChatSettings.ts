import fs from 'fs'
import path from 'path'
import { isCodexReasoningEffort, type CodexReasoningEffort, type McpHttpScope } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'

const CODEX_CHAT_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'codex-chat.json')
const MODEL_MAX_LENGTH = 200

/** Scopes the chat may grant. Backup/restore stay out: restore overwrites data and neither belongs in a chat. */
export const CODEX_CHAT_SCOPES = ['read', 'generate', 'organize'] as const satisfies readonly McpHttpScope[]
export type CodexChatScope = typeof CODEX_CHAT_SCOPES[number]

export type CodexChatSettings = {
  enabled: boolean
  scopes: CodexChatScope[]
  /** Codex agent model override; empty uses the CLI default. */
  model: string
  /** Empty uses the server CLI/model default. */
  reasoningEffort: CodexReasoningEffort | ''
}

const DEFAULT_SETTINGS: CodexChatSettings = {
  enabled: false,
  scopes: [...CODEX_CHAT_SCOPES],
  model: '',
  reasoningEffort: '',
}

function normalizeScopes(value: unknown, fallback: CodexChatScope[]): CodexChatScope[] {
  if (!Array.isArray(value)) {
    return fallback
  }
  return CODEX_CHAT_SCOPES.filter((scope) => value.includes(scope))
}

function normalizeSettings(value: unknown): CodexChatSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    scopes: normalizeScopes(record.scopes, DEFAULT_SETTINGS.scopes),
    model: typeof record.model === 'string' ? record.model.trim().slice(0, MODEL_MAX_LENGTH) : DEFAULT_SETTINGS.model,
    reasoningEffort: isCodexReasoningEffort(record.reasoningEffort) ? record.reasoningEffort : DEFAULT_SETTINGS.reasoningEffort,
  }
}

let cachedSettings: CodexChatSettings | null = null
const changeListeners = new Set<(settings: CodexChatSettings) => void>()

export function loadCodexChatSettings(): CodexChatSettings {
  if (cachedSettings) {
    return { ...cachedSettings, scopes: [...cachedSettings.scopes] }
  }

  try {
    cachedSettings = normalizeSettings(JSON.parse(fs.readFileSync(CODEX_CHAT_SETTINGS_FILE_PATH, 'utf8')))
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS, scopes: [...DEFAULT_SETTINGS.scopes] }
  }
  return loadCodexChatSettings()
}

/** Merge a partial update, persist it and notify listeners (the chat service restarts sessions on scope/model changes). */
export function updateCodexChatSettings(patch: Partial<Record<keyof CodexChatSettings, unknown>>): CodexChatSettings {
  const current = loadCodexChatSettings()
  const next = normalizeSettings({
    enabled: patch.enabled ?? current.enabled,
    scopes: patch.scopes ?? current.scopes,
    model: patch.model ?? current.model,
    reasoningEffort: patch.reasoningEffort ?? current.reasoningEffort,
  })

  fs.mkdirSync(path.dirname(CODEX_CHAT_SETTINGS_FILE_PATH), { recursive: true })
  fs.writeFileSync(CODEX_CHAT_SETTINGS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8')
  cachedSettings = next

  for (const listener of changeListeners) {
    listener(loadCodexChatSettings())
  }
  return loadCodexChatSettings()
}

export function onCodexChatSettingsChange(listener: (settings: CodexChatSettings) => void) {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}
