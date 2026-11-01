import type { McpRequester } from '../../mcp/context'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { canRequesterViewImages } from '../../middleware/imageAccess'
import { ImageSafetyService } from '../imageSafetyService'
import { placeholdersFor, sortedUniqueChunks } from '../../utils/sqlInChunks'
import { profileContentLimit, ratingRestrictedHashesUnder } from './chatContentRating'
import { chatProfileRequester } from './chatProfilePermissions'
import { ChatProfileStore } from './chatProfiles'
import { collectCodexChatMedia, type CodexChatMediaItem } from './codexChatMedia'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { readChatResultMediaEvidence } from './chatResultMediaGrants'

/** Existing global viewers retain their library scope; delegation uses only positive invocation/queue evidence. */
export function collectChatResultMedia(requester: McpRequester, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[]): CodexChatMediaItem[] {
  if (canRequesterViewImages(requester)) return collectCodexChatMedia(messages)
  return collectScopedChatResultMedia(requester, thread, messages)
}

function collectScopedChatResultMedia(requester: McpRequester, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[]): CodexChatMediaItem[] {
  if (requester.accountId === null || thread.account_id !== requester.accountId) return []
  const byProfile = new Map<number, CodexChatMessageRecord[]>()
  for (const message of messages) {
    if (message.role !== 'assistant' || message.thread_id !== thread.id || !message.routing?.replyId || message.routing.agent) continue
    const profileId = thread.kind === 'group' ? message.speaker_profile_id : thread.profile_id
    if (profileId === null || (thread.kind === 'direct' && message.speaker_profile_id !== null && message.speaker_profile_id !== profileId)) continue
    const group = byProfile.get(profileId) ?? []
    group.push(message)
    byProfile.set(profileId, group)
  }
  const db = getUserSettingsDb()
  const result = new Map<string, CodexChatMediaItem>()
  for (const [profileId, group] of byProfile) {
    try {
      if (!canRequesterViewImages(chatProfileRequester(requester, { threadId: thread.id, profileId, kind: thread.kind }))) continue
    } catch { continue }
    const profile = ChatProfileStore.find(profileId)
    if (!profile?.isEnabled) continue
    const evidence = readChatResultMediaEvidence(requester, thread.id, profileId, group.map((message) => message.routing!.replyId!))
    const media = collectCodexChatMedia(group.map((message) => ({
      ...message,
      tool_calls: [
        { id: 'proved-lookup', tool: 'chat_result', status: 'completed' as const, arguments: null, summary: null,
          historyIds: [], compositeHashes: evidence.get(message.routing!.replyId!)?.found ?? [], generated: false },
        { id: 'linked-generation', tool: 'generation_result', status: 'completed' as const, arguments: null, summary: null,
          historyIds: evidence.get(message.routing!.replyId!)?.historyIds ?? [], compositeHashes: [], generated: true },
      ],
    })))
    const restricted = ratingRestrictedHashesUnder(profileContentLimit(profile), media.map((item) => item.compositeHash))
    const hidden = new Set<string>()
    for (const chunk of sortedUniqueChunks(media.map((item) => item.compositeHash))) {
      const rows = db.prepare(`SELECT composite_hash, rating_score FROM main_db.media_metadata WHERE composite_hash IN (${placeholdersFor(chunk)})`).all(...chunk) as Array<{ composite_hash: string; rating_score: number | null }>
      for (const row of rows) if (ImageSafetyService.isHidden(row.rating_score)) hidden.add(row.composite_hash)
    }
    for (const item of media) {
      if (restricted.has(item.compositeHash) || hidden.has(item.compositeHash)) continue
      const existing = result.get(item.compositeHash)
      if (!existing || (existing.source === 'found' && item.source === 'generated')) {
        result.set(item.compositeHash, { ...item, resultMediaUrl: `/api/codex-chat/threads/${thread.id}/messages/${item.messageId}/media/${item.compositeHash}` })
      }
    }
  }
  return [...result.values()].sort((a, b) => b.messageId - a.messageId)
}

export function chatResultMediaMap(requester: McpRequester, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[]) {
  return Object.fromEntries(collectChatResultMedia(requester, thread, messages).map((item) => [item.compositeHash, {
    mimeType: item.mimeType, width: item.width, height: item.height, historyId: item.historyId,
    postprocessStatus: item.postprocessStatus, ...(item.resultMediaUrl ? { resultMediaUrl: item.resultMediaUrl } : {}),
  }]))
}

/** One message lookup, never the whole transcript. Generation links also cover jobs finished after that reply. */
export function resolveChatResultMedia(requester: McpRequester, threadId: number, messageId: number, compositeHash: string) {
  if (requester.accountId === null) return null
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  const message = thread && CodexChatStore.findMessage(thread.id, messageId)
  if (!thread || !message || message.role !== 'assistant' || !message.routing?.replyId || message.routing.agent) return null
  // Even global viewers use this endpoint only for a recorded result of its live profile.
  return collectScopedChatResultMedia(requester, thread, [message]).find((item) => item.compositeHash === compositeHash) ?? null
}
