import type { ChatExecutionContext, ChatMessageRouting, ChatRecipient } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'

export type ReplyRouteInput = { messageId?: number; recipients?: ChatRecipient[] }
type ReplyHandler = { context: ChatExecutionContext; signal: AbortSignal; route: (input: ReplyRouteInput) => ChatMessageRouting }
const replies = new Map<string, ReplyHandler>()
const finishedListeners = new Set<(context: ChatExecutionContext) => void>()

export function onChatReplyFinished(listener: (context: ChatExecutionContext) => void) {
  finishedListeners.add(listener)
  return () => { finishedListeners.delete(listener) }
}

/** A valid user request takes precedence even while translation has not stored its user row yet. */
export function skipThreadGenerationReactions(threadId: number) {
  const db = getUserSettingsDb()
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO chat_generation_reactions (reply_id, thread_id, state)
      SELECT DISTINCT reply_id, thread_id, 'skipped' FROM chat_generation_links WHERE thread_id = ? AND reaction_target = 1`).run(threadId)
    db.prepare("UPDATE chat_generation_reactions SET state = 'skipped', updated_at = CURRENT_TIMESTAMP WHERE thread_id = ? AND state IN ('pending', 'running')").run(threadId)
  }).immediate()
}

export function registerChatReply(context: ChatExecutionContext, signal: AbortSignal, route: ReplyHandler['route']) {
  if (!context.replyId) throw new Error('Missing reply identity')
  const entry = { context, signal, route }
  replies.set(context.replyId, entry)
  return () => {
    if (replies.get(context.replyId!) !== entry) return
    replies.delete(context.replyId!)
    for (const listener of finishedListeners) listener(context)
  }
}

export function requireActiveChatReply(context: ChatExecutionContext | undefined) {
  const entry = context?.replyId ? replies.get(context.replyId) : undefined
  if (!entry || entry.context.threadId !== context?.threadId || entry.context.profileId !== context.profileId || entry.signal.aborted) {
    throw new Error('This reply has ended or was interrupted. No new action can be routed from it.')
  }
  return entry
}

export function routeChatReply(context: ChatExecutionContext | undefined, input: ReplyRouteInput) {
  return requireActiveChatReply(context).route(input)
}

/** Called at submission, before the model can stop polling or be interrupted. Never reassign an existing job. */
export function linkChatGeneration(context: ChatExecutionContext | undefined, jobId: number) {
  if (!context?.replyId) return
  const db = getUserSettingsDb()
  db.prepare(`INSERT OR IGNORE INTO chat_generation_links (job_id, thread_id, reply_id, reaction_target)
    VALUES (?, ?, ?, COALESCE((SELECT CASE WHEN t.reaction_enabled = 1 AND p.engine = 'llm' AND (t.kind = 'group' OR t.engine = 'llm') THEN 1 ELSE 0 END
    FROM codex_chat_threads t JOIN llm_chat_profiles p ON p.id = ? WHERE t.id = ?), 0))`)
    .run(jobId, context.threadId, context.replyId, context.profileId, context.threadId)
}
