import { triggerBlobDownload } from '@/lib/api-client'
import { CHAT_BLOCK_FILE_MARK, type ChatDisplayBlock } from '@/lib/api-codex-chat'

/** The export shape of one shared display block: a marker, the name and the block itself (without its local id). */
export function chatBlockFileContents(name: string, block: ChatDisplayBlock) {
  const { key, instruction, example, rules, summary, fields, template, css } = block
  return { [CHAT_BLOCK_FILE_MARK]: 1, name, block: { key, instruction, example, rules, summary, fields, template, css } }
}

export function downloadChatBlockFile(name: string, block: ChatDisplayBlock) {
  const safeName = (name || block.key || 'block').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'block'
  const blob = new Blob([JSON.stringify(chatBlockFileContents(name, block), null, 2)], { type: 'application/json' })
  triggerBlobDownload(blob, `${safeName}.block.json`)
}

/** A picked file's JSON (one block, an export, or an array of either); the server validates the blocks. */
export async function readChatBlockFile(file: File): Promise<unknown> {
  const text = await file.text()
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
