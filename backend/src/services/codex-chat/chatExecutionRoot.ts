import { getUserSettingsDb } from '../../database/userSettingsDb'

/** A server-issued task/request identity, captured before a model or the next room member starts. */
export function chatExecutionRoot(threadId: number, sourceMessageId?: number | null) {
  const db = getUserSettingsDb()
  const source = sourceMessageId ? db.prepare('SELECT routing FROM codex_chat_messages WHERE thread_id = ? AND id = ?').get(threadId, sourceMessageId) as { routing: string | null } | undefined : undefined
  if (source?.routing) {
    try {
      const routing = JSON.parse(source.routing) as { task?: { id?: unknown } }
      if (Number.isSafeInteger(routing.task?.id) && Number(routing.task?.id) > 0) return `chat:${threadId}:task:${routing.task!.id}`
    } catch { /* Old routing is not a task binding. */ }
  }
  const user = db.prepare(`SELECT id, routing FROM codex_chat_messages WHERE thread_id = ? AND role = 'user'
    AND (? IS NULL OR id <= ?) ORDER BY id DESC LIMIT 1`).get(threadId, sourceMessageId ?? null, sourceMessageId ?? null) as { id: number; routing: string | null } | undefined
  if (user?.routing) {
    try {
      const routing = JSON.parse(user.routing) as { task?: { id?: unknown } }
      if (Number.isSafeInteger(routing.task?.id) && Number(routing.task?.id) > 0) return `chat:${threadId}:task:${routing.task!.id}`
    } catch { /* Fall back to the actual original user row. */ }
  }
  return user ? `chat:${threadId}:user:${user.id}` : `chat:${threadId}:source:${sourceMessageId ?? 'none'}`
}
