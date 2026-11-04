import { triggerBlobDownload } from '@/lib/api-client'
import type { ChatLoreEntry } from '@/lib/api-codex-chat'

export function downloadChatLorebookFile(name: string, entries: ChatLoreEntry[]) {
  const filename = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'lorebook'
  triggerBlobDownload(new Blob([JSON.stringify({ name, entries }, null, 2)], { type: 'application/json' }), `${filename}.lorebook.json`)
}
