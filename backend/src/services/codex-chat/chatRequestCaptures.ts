import { getUserSettingsDb } from '../../database/userSettingsDb'
import { loadChatSettings } from './chatSettings'
import type { ChatCompletionTarget } from './llmChatCompletion'

/** Remove custom request fields and connection secrets recursively, including echoed values. */
export function redactChatRequestBody(body: unknown, target?: ChatCompletionTarget): string {
  const extra = target?.generation.extraParams ?? {}
  const secrets = [target?.apiKey, target?.endpoint].filter((value): value is string => !!value)
  const redact = (value: unknown, key = ''): unknown => {
    if (Object.prototype.hasOwnProperty.call(extra, key) || /^(?:extra_?params|headers|authorization|api_?key|endpoint|base_?url)$/i.test(key)) return '[가림]'
    if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join('[가림]'), value)
    if (Array.isArray(value)) return value.map((item) => redact(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]))
    return value
  }
  return JSON.stringify(redact(body))
}

export function saveChatRequestCapture(messageId: number, body: string | undefined) {
  const settings = loadChatSettings().diagnostics
  if (!settings.enabled || !settings.captureRaw || body === undefined) return
  const db = getUserSettingsDb()
  db.transaction(() => {
    const message = db.prepare('SELECT thread_id, active_alternative FROM codex_chat_messages WHERE id = ?').get(messageId) as { thread_id: number; active_alternative: number } | undefined
    if (!message) return
    db.prepare('INSERT OR REPLACE INTO chat_request_captures (message_id, alternative, body, created_at) VALUES (?, ?, ?, ?)').run(messageId, message.active_alternative, body, new Date().toISOString())
    db.prepare(`DELETE FROM chat_request_captures WHERE message_id IN (SELECT id FROM codex_chat_messages WHERE thread_id = ?)
      AND rowid NOT IN (SELECT c.rowid FROM chat_request_captures c JOIN codex_chat_messages m ON m.id = c.message_id
        WHERE m.thread_id = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT ?)`).run(message.thread_id, message.thread_id, settings.captureLimit)
  }).immediate()
}

export function readChatRequestCapture(messageId: number, alternative: number): unknown {
  const row = getUserSettingsDb().prepare('SELECT body FROM chat_request_captures WHERE message_id = ? AND alternative = ?').get(messageId, alternative) as { body: string } | undefined
  return row ? JSON.parse(row.body) : undefined
}
