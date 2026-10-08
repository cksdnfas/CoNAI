import type { ChatJudgeItemStats, ChatJudgeLogRun, ChatJudgePreset, ChatJudgePresetInput, ChatJudgeTestTurn } from '@conai/shared'
import { triggerBlobDownload } from '@/lib/api-client'
import { requestApiData } from '@/lib/api-request'

export type { ChatJudgeItem, ChatJudgeItemStats, ChatJudgeLogRun, ChatJudgePreset, ChatJudgePresetInput, ChatJudgeTestTurn } from '@conai/shared'

export const CHAT_JUDGE_PRESETS_QUERY_KEY = ['codex-chat-judge-presets'] as const
export const CHAT_JUDGE_LOGS_QUERY_KEY = ['codex-chat-judge-logs'] as const
export const CHAT_JUDGE_STATS_QUERY_KEY = ['codex-chat-judge-stats'] as const

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const BASE = '/api/codex-chat/admin'

export function listChatJudgePresets() {
  return requestApiData<ChatJudgePreset[]>(`${BASE}/judge-presets`)
}

export function createChatJudgePreset(input: ChatJudgePresetInput) {
  return requestApiData<ChatJudgePreset>(`${BASE}/judge-presets`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a judge preset JSON file; every preset in it becomes one (without a connection). */
export function importChatJudgePresets(contents: unknown) {
  return requestApiData<ChatJudgePreset[]>(`${BASE}/judge-presets/import`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatJudgePreset(presetId: number, patch: ChatJudgePresetInput) {
  return requestApiData<ChatJudgePreset>(`${BASE}/judge-presets/${presetId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatJudgePreset(presetId: number) {
  return requestApiData<{ deleted: boolean }>(`${BASE}/judge-presets/${presetId}`, { method: 'DELETE' })
}

/** Runs a preset draft over the last `turns` messages of one of the requester's own API chats; nothing is logged. */
export function testChatJudgePreset(input: { preset: ChatJudgePresetInput; threadId: number; turns: number }, signal?: AbortSignal) {
  return requestApiData<ChatJudgeTestTurn[]>(`${BASE}/judge-presets/test`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input), signal })
}

export type ChatJudgeLogFilter = { profileId?: number; presetId?: number; itemId?: string; verdict?: string; stage?: string; threadId?: number; beforeId?: number; limit?: number; days?: number }

function query(filter: ChatJudgeLogFilter) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function listChatJudgeLogs(filter: ChatJudgeLogFilter = {}) {
  return requestApiData<ChatJudgeLogRun[]>(`${BASE}/judge-logs${query(filter)}`)
}

export function getChatJudgeStats(filter: ChatJudgeLogFilter = {}) {
  return requestApiData<ChatJudgeItemStats[]>(`${BASE}/judge-stats${query(filter)}`)
}

export const CHAT_JUDGE_PRESET_FILE_MARK = 'conai_judge_preset'

/** One preset as a JSON file: its questions and follow-up settings (connections are each server's own). */
export function downloadChatJudgePresetFile(preset: ChatJudgePresetInput) {
  const name = preset.name || 'judge'
  const contents = { [CHAT_JUDGE_PRESET_FILE_MARK]: 1, name, preset: { name, items: preset.items ?? [], followUp: preset.followUp } }
  const safeName = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'judge'
  triggerBlobDownload(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }), `${safeName}.judge.json`)
}
