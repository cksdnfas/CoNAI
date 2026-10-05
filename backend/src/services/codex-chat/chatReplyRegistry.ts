import type { ChatExecutionContext, ChatMessageRouting, ChatRecipient } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'

export type ReplyRouteInput = { messageId?: number; recipients?: ChatRecipient[] }
type ReplyHandler = { context: ChatExecutionContext; signal: AbortSignal; route: (input: ReplyRouteInput) => ChatMessageRouting }
const replies = new Map<string, ReplyHandler>()

export function registerChatReply(context: ChatExecutionContext, signal: AbortSignal, route: ReplyHandler['route']) {
  if (!context.replyId) throw new Error('Missing reply identity')
  const entry = { context, signal, route }
  replies.set(context.replyId, entry)
  return () => { if (replies.get(context.replyId!) === entry) replies.delete(context.replyId!) }
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
  getUserSettingsDb().prepare('INSERT OR IGNORE INTO chat_generation_links (job_id, thread_id, reply_id) VALUES (?, ?, ?)').run(jobId, context.threadId, context.replyId)
}
