import fs from 'fs'
import path from 'path'
import { CHAT_CAPTURE_LIMITS, normalizeLoreKeyLanguage, TOOL_ROUND_LIMITS } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import { writeJsonFileAtomic } from '../../utils/jsonFile'

const CHAT_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'chat.json')
/** Before chat profiles: Codex chat and LLM chat each had their own settings file. */
const LEGACY_CODEX_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'codex-chat.json')
const LEGACY_LLM_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'llm-chat.json')

export type ChatSettings = {
  /** Master switch for every chat profile (Codex and API LLM). */
  enabled: boolean
  diagnostics: { enabled: boolean; captureRaw: boolean; captureLimit: number }
  /** save_lore entries go into the chat's book right away (a chat can turn it off for itself); off: a person saves each card. */
  loreAutoSave: boolean
  /**
   * The one language besides English every lorebook's keywords are kept in (entries' `localKeys`); null: English
   * only. App-wide so chat books made mid-conversation need no setup.
   */
  loreKeyLanguage: string | null
  /**
   * Who runs the `web_search` tool for every chat profile (chatWebResearch): a Codex or Claude Code run with only its
   * own web search, under `model` (null: the engine's default). Off: no profile gets the web tools. `dailyLimit`: searches
   * per account in 24 hours (null: no limit; administrators have none).
   */
  webResearch: WebResearchSettings
  /**
   * Every pi chat run (profiles on the pi runtime) also gets pi's `codemode` tool: one script calls several CoNAI tools
   * and returns only what it picks out (piChatCompletion). Off by default: a small model may not write scripts well.
   */
  piCodemode: boolean
  /**
   * The one tool limit: model ↔ tool round trips one reply may take, for every chat profile, engine runtime (API, pi,
   * Claude Code), plugin profile run and research, web research and one pi codemode script's calls. Past it the tools go
   * and the model answers with what it has. Codex runs its own agent loop and has no such cap.
   */
  toolRoundLimit: number
}

export { TOOL_ROUND_LIMITS }

function toolRoundLimitOf(value: unknown, fallback: number = TOOL_ROUND_LIMITS.default) {
  return Number.isInteger(value) && (value as number) >= TOOL_ROUND_LIMITS.min && (value as number) <= TOOL_ROUND_LIMITS.max ? value as number : fallback
}

export const WEB_RESEARCH_ENGINES = ['off', 'codex', 'claude'] as const
export type WebResearchEngine = typeof WEB_RESEARCH_ENGINES[number]
export type WebResearchSettings = { engine: WebResearchEngine; model: string | null; dailyLimit: number | null }
export const DEFAULT_WEB_RESEARCH: WebResearchSettings = { engine: 'off', model: null, dailyLimit: null }
export const WEB_RESEARCH_MAX_DAILY_LIMIT = 1000

function webResearchOf(value: unknown, fallback = DEFAULT_WEB_RESEARCH): WebResearchSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const engine = WEB_RESEARCH_ENGINES.includes(input.engine as WebResearchEngine) ? input.engine as WebResearchEngine : fallback.engine
  const model = input.model === undefined ? fallback.model : typeof input.model === 'string' && /^[\w.:/-]{1,100}$/.test(input.model.trim()) ? input.model.trim() : null
  const limit = input.dailyLimit
  const dailyLimit = limit === undefined ? fallback.dailyLimit : Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= WEB_RESEARCH_MAX_DAILY_LIMIT ? limit as number : null
  return { engine, model, dailyLimit }
}

export const DEFAULT_LORE_KEY_LANGUAGE: string | null = null

export const DEFAULT_CHAT_DIAGNOSTICS: ChatSettings['diagnostics'] = { enabled: true, captureRaw: false, captureLimit: CHAT_CAPTURE_LIMITS.default }
export const MAX_CHAT_CAPTURE_LIMIT = CHAT_CAPTURE_LIMITS.max

function diagnosticsOf(value: unknown, fallback = DEFAULT_CHAT_DIAGNOSTICS): ChatSettings['diagnostics'] {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    captureRaw: typeof input.captureRaw === 'boolean' ? input.captureRaw : fallback.captureRaw,
    captureLimit: typeof input.captureLimit === 'number' && Number.isFinite(input.captureLimit)
      ? Math.max(CHAT_CAPTURE_LIMITS.min, Math.min(MAX_CHAT_CAPTURE_LIMIT, Math.floor(input.captureLimit))) : fallback.captureLimit,
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
      cachedSettings = { enabled: stored.enabled === true, diagnostics: diagnosticsOf(stored.diagnostics), loreAutoSave: stored.loreAutoSave !== false,
        loreKeyLanguage: stored.loreKeyLanguage === undefined ? DEFAULT_LORE_KEY_LANGUAGE : normalizeLoreKeyLanguage(stored.loreKeyLanguage),
        webResearch: webResearchOf(stored.webResearch), piCodemode: stored.piCodemode === true, toolRoundLimit: toolRoundLimitOf(stored.toolRoundLimit) }
    } else {
      // First run after the profile change: chat stays on if either old switch was on.
      const legacyEnabled = readJson(LEGACY_CODEX_SETTINGS_FILE_PATH)?.enabled === true || readJson(LEGACY_LLM_SETTINGS_FILE_PATH)?.enabled === true
      cachedSettings = { enabled: legacyEnabled, diagnostics: { ...DEFAULT_CHAT_DIAGNOSTICS }, loreAutoSave: true, loreKeyLanguage: DEFAULT_LORE_KEY_LANGUAGE, webResearch: { ...DEFAULT_WEB_RESEARCH }, piCodemode: false, toolRoundLimit: TOOL_ROUND_LIMITS.default }
    }
  }
  return { ...cachedSettings, diagnostics: { ...cachedSettings.diagnostics }, webResearch: { ...cachedSettings.webResearch } }
}

/** The app-wide tool round limit (ChatSettings.toolRoundLimit), read when a reply or run starts. */
export function chatToolRoundLimit() {
  return loadChatSettings().toolRoundLimit
}

export function updateChatSettings(patch: { enabled?: boolean; diagnostics?: Partial<ChatSettings['diagnostics']>; loreAutoSave?: boolean; loreKeyLanguage?: string | null; webResearch?: Partial<WebResearchSettings>; piCodemode?: boolean; toolRoundLimit?: number }): ChatSettings {
  const current = loadChatSettings()
  const next: ChatSettings = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    diagnostics: diagnosticsOf(patch.diagnostics, current.diagnostics),
    loreAutoSave: typeof patch.loreAutoSave === 'boolean' ? patch.loreAutoSave : current.loreAutoSave,
    loreKeyLanguage: patch.loreKeyLanguage === undefined ? current.loreKeyLanguage : normalizeLoreKeyLanguage(patch.loreKeyLanguage),
    webResearch: patch.webResearch === undefined ? current.webResearch : webResearchOf(patch.webResearch, current.webResearch),
    piCodemode: typeof patch.piCodemode === 'boolean' ? patch.piCodemode : current.piCodemode,
    toolRoundLimit: toolRoundLimitOf(patch.toolRoundLimit, current.toolRoundLimit),
  }
  writeJsonFileAtomic(CHAT_SETTINGS_FILE_PATH, next)
  cachedSettings = next
  return loadChatSettings()
}

/** MCP scopes a chat may grant. Backup/restore stay out: restore overwrites data and neither belongs in a chat. */
export const CHAT_SCOPES = ['read', 'generate', 'organize', 'configure'] as const
export type ChatScope = typeof CHAT_SCOPES[number]
