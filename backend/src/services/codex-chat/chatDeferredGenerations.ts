import type { ChatToolCall } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequestContext } from '../../mcp/context'

/**
 * Pictures a reply asked for under an `after` generation preset (see ChatPresetPrompting). The chat model's tool call
 * only records the request; once the reply is finished, chatGenerationPrompting writes the prompt from the finished
 * text and queues the job, which then links to the reply like any other. `pending` → `writing` → `queued`, or
 * `failed` (shown on the reply) / `skipped` (the reply is gone or was cut off).
 */
export type DeferredGenerationState = 'pending' | 'writing' | 'queued' | 'failed' | 'skipped'

export type DeferredGenerationRow = {
  id: number
  thread_id: number
  reply_id: string
  preset_id: number
  tool_name: string
  focus: string
  context: string
  state: DeferredGenerationState
  job_id: number | null
  error: string | null
}

/** Pictures one reply may ask for under `after` presets. */
export const DEFERRED_PER_REPLY_MAX = 4

const db = () => getUserSettingsDb()

export const ChatDeferredGenerationStore = {
  /** Records a request of the reply in `context` (its page snapshot left out: the writer never reads the page). */
  add(context: McpRequestContext, presetId: number, toolName: string, focus: string) {
    const chat = context.chatContext
    if (!chat?.replyId) throw new Error('This tool works only inside a chat reply.')
    const stored: McpRequestContext = { ...context, chatContext: { threadId: chat.threadId, profileId: chat.profileId, kind: chat.kind, replyId: chat.replyId } }
    return db().transaction(() => {
      const count = (db().prepare('SELECT COUNT(*) AS count FROM chat_deferred_generations WHERE thread_id = ? AND reply_id = ?').get(chat.threadId, chat.replyId) as { count: number }).count
      if (count >= DEFERRED_PER_REPLY_MAX) throw new Error(`One reply can ask for at most ${DEFERRED_PER_REPLY_MAX} pictures.`)
      return Number(db().prepare("INSERT INTO chat_deferred_generations (thread_id, reply_id, preset_id, tool_name, focus, context, state) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
        .run(chat.threadId, chat.replyId, presetId, toolName, focus, JSON.stringify(stored)).lastInsertRowid)
    }).immediate()
  },

  pendingFor(replyId: string) {
    return db().prepare("SELECT * FROM chat_deferred_generations WHERE reply_id = ? AND state = 'pending' ORDER BY id").all(replyId) as DeferredGenerationRow[]
  },

  /** Replies with requests still waiting (after a restart, or a reply that finished while the service was busy). */
  pendingReplies() {
    return (db().prepare("SELECT DISTINCT reply_id FROM chat_deferred_generations WHERE state = 'pending'").all() as Array<{ reply_id: string }>).map((row) => row.reply_id)
  },

  /** Takes a pending request for writing; false when another run already took it or it was dropped. */
  claim(id: number) {
    return db().prepare("UPDATE chat_deferred_generations SET state = 'writing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'pending'").run(id).changes > 0
  },

  settle(id: number, state: Extract<DeferredGenerationState, 'queued' | 'failed' | 'skipped'>, result: { jobId?: number; error?: string } = {}) {
    db().prepare("UPDATE chat_deferred_generations SET state = ?, job_id = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state IN ('pending', 'writing')")
      .run(state, result.jobId ?? null, result.error ? result.error.slice(0, 300) : null, id)
  },

  /** A write cut off by a restart cannot resume (its reply's run is gone): it fails where it stood. */
  failInterrupted() {
    db().prepare("UPDATE chat_deferred_generations SET state = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE state = 'writing'").run('서버가 다시 시작돼서 프롬프트를 쓰지 못했어.')
  },

  /**
   * What the transcript shows for requests not yet queued, by reply id: a placeholder while the prompt is written, or
   * the reason it was not. A queued request shows through its job like any generation.
   */
  callsFor(threadIds: number[]): Map<string, ChatToolCall[]> {
    const calls = new Map<string, ChatToolCall[]>()
    if (threadIds.length === 0) return calls
    const rows = db().prepare(`SELECT id, reply_id, state, error FROM chat_deferred_generations WHERE thread_id IN (${threadIds.map(() => '?').join(', ')}) AND state IN ('pending', 'writing', 'failed') ORDER BY id`)
      .all(...threadIds) as Array<Pick<DeferredGenerationRow, 'id' | 'reply_id' | 'state' | 'error'>>
    for (const row of rows) {
      const failed = row.state === 'failed'
      const call: ChatToolCall = {
        id: `deferred-${row.id}`, tool: 'generation_result', status: failed ? 'failed' : 'running', arguments: null, summary: row.error, historyIds: [], compositeHashes: [], generated: true,
        deferred: { state: failed ? 'failed' : 'writing', error: row.error },
      }
      calls.set(row.reply_id, [...(calls.get(row.reply_id) ?? []), call])
    }
    return calls
  },
}
