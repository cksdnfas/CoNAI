import { triggerBlobDownload } from '@/lib/api-client'
import { CHAT_GENERATION_PRESET_FILE_MARK, type ChatGenerationPresetInput } from '@/lib/api-codex-chat'

/** The export shape of one generation preset: a marker, the name and instruction, and the kind-specific setup. */
export function chatGenerationPresetFileContents(preset: ChatGenerationPresetInput) {
  return { [CHAT_GENERATION_PRESET_FILE_MARK]: 1, name: preset.name, instruction: preset.instruction, preset: { kind: preset.kind, nai: preset.nai, comfyui: preset.comfyui } }
}

export function downloadChatGenerationPresetFile(preset: ChatGenerationPresetInput) {
  const safeName = (preset.name || 'generation').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'generation'
  const blob = new Blob([JSON.stringify(chatGenerationPresetFileContents(preset), null, 2)], { type: 'application/json' })
  triggerBlobDownload(blob, `${safeName}.generation.json`)
}

/** A picked file's JSON (one preset, an export, or an array of either); the server validates the presets. */
export async function readChatGenerationPresetFile(file: File): Promise<unknown> {
  const text = await file.text()
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
