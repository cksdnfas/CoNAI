import { triggerBlobDownload } from '@/lib/api-client'
import { CHAT_TOOL_PRESET_FILE_MARK, type ChatToolPresetInput } from '@/lib/api-codex-chat'

/** The export shape of one tool preset: a marker, the name, scopes and the tool list (null: every tool). */
export function chatToolPresetFileContents(preset: ChatToolPresetInput) {
  return { [CHAT_TOOL_PRESET_FILE_MARK]: 1, name: preset.name, preset: { scopes: preset.scopes, toolAllowlist: preset.toolAllowlist } }
}

export function downloadChatToolPresetFile(preset: ChatToolPresetInput) {
  const safeName = (preset.name || 'tools').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'tools'
  const blob = new Blob([JSON.stringify(chatToolPresetFileContents(preset), null, 2)], { type: 'application/json' })
  triggerBlobDownload(blob, `${safeName}.tools.json`)
}

/** A picked file's JSON (one preset, an export, or an array of either); the server validates the presets. */
export async function readChatToolPresetFile(file: File): Promise<unknown> {
  const text = await file.text()
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
