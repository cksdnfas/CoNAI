import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'

const LLM_CHAT_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'llm-chat.json')

export const LLM_CHAT_CONTEXT_TURNS_RANGE = { min: 1, max: 200 } as const
export const LLM_CHAT_TOOL_ROUNDS_RANGE = { min: 1, max: 20 } as const
const SUMMARY_PROMPT_MAX_LENGTH = 4000

export const DEFAULT_LLM_CHAT_SUMMARY_PROMPT = [
  '아래는 지금까지의 대화 요약과, 그 뒤에 이어진 대화야.',
  '두 내용을 합쳐서 이후 대화에 필요한 정보만 남긴 새 요약을 써줘.',
  '인물·관계·약속·설정·진행 중인 일·사용자의 선호, 그리고 이미지나 기록 ID처럼 다시 쓸 값은 빠뜨리지 마.',
  '요약만 출력하고 다른 말은 붙이지 마.',
].join('\n')

export type LlmChatSettings = {
  enabled: boolean
  /** Recent turns (a user message and the replies to it) sent with every request. */
  contextTurns: number
  summaryEnabled: boolean
  /** Fold older turns into the summary once this many have fallen out of the window. */
  summaryTriggerTurns: number
  summaryPrompt: string
  /** Model ↔ tool round trips allowed in one reply before it is cut off. */
  maxToolRounds: number
}

const DEFAULT_SETTINGS: LlmChatSettings = {
  enabled: false,
  contextTurns: 20,
  summaryEnabled: false,
  summaryTriggerTurns: 6,
  summaryPrompt: DEFAULT_LLM_CHAT_SUMMARY_PROMPT,
  maxToolRounds: 8,
}

function clampInteger(value: unknown, range: { min: number; max: number }, fallback: number) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(range.max, Math.max(range.min, Math.round(number))) : fallback
}

function normalizeSettings(value: unknown): LlmChatSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const summaryPrompt = typeof record.summaryPrompt === 'string' ? record.summaryPrompt.trim().slice(0, SUMMARY_PROMPT_MAX_LENGTH) : ''
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    contextTurns: clampInteger(record.contextTurns, LLM_CHAT_CONTEXT_TURNS_RANGE, DEFAULT_SETTINGS.contextTurns),
    summaryEnabled: typeof record.summaryEnabled === 'boolean' ? record.summaryEnabled : DEFAULT_SETTINGS.summaryEnabled,
    summaryTriggerTurns: clampInteger(record.summaryTriggerTurns, LLM_CHAT_CONTEXT_TURNS_RANGE, DEFAULT_SETTINGS.summaryTriggerTurns),
    summaryPrompt: summaryPrompt || DEFAULT_SETTINGS.summaryPrompt,
    maxToolRounds: clampInteger(record.maxToolRounds, LLM_CHAT_TOOL_ROUNDS_RANGE, DEFAULT_SETTINGS.maxToolRounds),
  }
}

let cachedSettings: LlmChatSettings | null = null

export function loadLlmChatSettings(): LlmChatSettings {
  if (!cachedSettings) {
    try {
      cachedSettings = normalizeSettings(JSON.parse(fs.readFileSync(LLM_CHAT_SETTINGS_FILE_PATH, 'utf8')))
    } catch {
      cachedSettings = { ...DEFAULT_SETTINGS }
    }
  }
  return { ...cachedSettings }
}

export function updateLlmChatSettings(patch: Partial<Record<keyof LlmChatSettings, unknown>>): LlmChatSettings {
  const next = normalizeSettings({ ...loadLlmChatSettings(), ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) })
  fs.mkdirSync(path.dirname(LLM_CHAT_SETTINGS_FILE_PATH), { recursive: true })
  fs.writeFileSync(LLM_CHAT_SETTINGS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8')
  cachedSettings = next
  return loadLlmChatSettings()
}
