import { getUserSettingsDb } from '../../database/userSettingsDb'
import { canRequesterViewImages } from '../../middleware/imageAccess'
import { isChatMcpSource, isPublicChatPage, type McpRequestContext, type McpRequester } from '../../mcp/context'
import { placeholdersFor, sortedUniqueChunks } from '../../utils/sqlInChunks'
import { requireChatMcpAccountAccess } from './codexChatAccess'
import { chatMcpRequester } from './chatProfilePermissions'
import { requireActiveChatReply } from './chatReplyRegistry'
import { MEDIA_HASH_PATTERN } from './chatMediaLinks'
import { readMcpToolResult } from './chatToolReferences'

/**
 * Created only by the native MCP registration wrapper, after authorization and before invoking its handler.
 * Snapshot the invocation: an awaited handler must never grant its result to a later reply or profile.
 */
export function chatResultMediaRecorder(context: McpRequestContext, toolName: string) {
  const chat = context.chatContext
  const accountId = context.requester?.accountId
  if (!isChatMcpSource(context.source) || accountId == null || !chat?.replyId || isPublicChatPage(context)) return undefined
  const invocation: McpRequestContext = {
    ...context,
    requester: { accountId, accountType: context.requester!.accountType },
    chatContext: { ...chat, page: chat.page ? { ...chat.page } : undefined },
  }
  const { threadId, profileId, replyId } = invocation.chatContext!
  return (result: unknown) => {
    if (!result || typeof result !== 'object' || Array.isArray(result) || (result as { isError?: boolean }).isError) return
    const { compositeHashes } = readMcpToolResult(result as Parameters<typeof readMcpToolResult>[0], toolName)
    const hashes = compositeHashes.filter((hash) => MEDIA_HASH_PATTERN.test(hash))
    if (!hashes.length || isPublicChatPage(context) || isPublicChatPage(invocation)) return
    try {
      requireActiveChatReply(invocation.chatContext)
      requireChatMcpAccountAccess(invocation, toolName)
      const requester = chatMcpRequester(invocation)
      if (!requester || !canRequesterViewImages(requester)) return
    } catch { return }
    const db = getUserSettingsDb()
    const insert = db.prepare(`INSERT OR IGNORE INTO chat_result_media_grants
      (account_id, thread_id, profile_id, reply_id, composite_hash) VALUES (?, ?, ?, ?, ?)`)
    db.transaction(() => {
      for (const hash of hashes) insert.run(accountId, threadId, profileId, replyId, hash)
    })()
  }
}

type ResultEvidence = { found: string[]; historyIds: number[] }

/** Batch by profile/reply, not per message or per image. Imported tool records are never queried as evidence. */
export function readChatResultMediaEvidence(requester: McpRequester, threadId: number, profileId: number, replyIds: string[]) {
  const db = getUserSettingsDb()
  const evidence = new Map<string, ResultEvidence>()
  const entry = (replyId: string) => {
    let found = evidence.get(replyId)
    if (!found) { found = { found: [], historyIds: [] }; evidence.set(replyId, found) }
    return found
  }
  for (const chunk of sortedUniqueChunks(replyIds)) {
    const grants = db.prepare(`SELECT reply_id, composite_hash FROM chat_result_media_grants
      WHERE account_id = ? AND thread_id = ? AND profile_id = ? AND reply_id IN (${placeholdersFor(chunk)})`)
      .all(requester.accountId, threadId, profileId, ...chunk) as Array<{ reply_id: string; composite_hash: string }>
    for (const grant of grants) entry(grant.reply_id).found.push(grant.composite_hash)
    // Queue links are server-created independently of model/imported tool records and predate scoped delivery.
    const generated = db.prepare(`SELECT l.reply_id, h.id FROM chat_generation_links l
      JOIN generation_queue_jobs j ON j.id = l.job_id AND j.requested_by_account_id = ? AND j.requested_by_account_type = ?
      JOIN api_generation_history h ON h.queue_job_id = l.job_id AND h.requested_by_account_id = j.requested_by_account_id
        AND h.requested_by_account_type = j.requested_by_account_type
      WHERE l.thread_id = ? AND l.reply_id IN (${placeholdersFor(chunk)})
        AND h.generation_status = 'completed' AND h.composite_hash IS NOT NULL`)
      .all(requester.accountId, requester.accountType, threadId, ...chunk) as Array<{ reply_id: string; id: number }>
    for (const row of generated) entry(row.reply_id).historyIds.push(row.id)
  }
  return evidence
}
