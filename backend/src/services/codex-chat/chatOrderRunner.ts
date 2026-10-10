import { randomUUID } from 'crypto'
import type { ChatExecutionContext } from '@conai/shared'
import { isChatOwnTool, type McpRequester } from '../../mcp/context'
import { inlineTextsForChat, loadAttachedImages } from './chatAttachments'
import { ChatFlagError } from './chatFlags'
import { ChatGroupStore, groupLimitsOf } from './chatGroupStore'
import { ChatSummaryStore } from './chatMemory'
import { chatOrderDirective, chatOrderDone, chatOrdersOf, parseChatOrderKind } from './chatOrders'
import { beginChatOrderRun } from './chatOrderRuns'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { ChatReplyError, quoteMessage } from './chatReplies'
import { registerChatReply } from './chatReplyRegistry'
import { loadChatSettings } from './chatSettings'
import { userPersonaForThread } from './chatUserProfiles'
import { canUseChatProfile, resolveChatAccess } from './codexChatAccess'
import { withGenerationOutcomes } from './codexChatMedia'
import { CodexChatError, CodexChatService, runCodexOrderTurn, type CodexChatStreamEvent } from './codexChatService'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { buildGroupLlmMessages, groupSummaryOn } from './groupChatContext'
import { GroupChatService } from './groupChatService'
import { appendUserDirective, buildChatMessages, resolveContextConfig, sendableMessages, splitTurns } from './llmChatContext'
import { runLlmOrderTurn, type GroupReplyResult } from './llmChatService'
import { withServerContextLimit } from './serverContextLimit'

/**
 * Orders from a reply's bar (see chatOrders), carried out on that reply. The character that wrote it does the job in
 * its name (the reply id it was written under), seeing the conversation as it stood at that reply — the chat's
 * window setting counted back from it: the context turns of a direct chat, the room's window. Nothing new is written
 * to the chat: generated images and sounds attach to the reply as its own jobs, lore and choice cards show on it, and
 * the calls that went through are added to its tool calls.
 */

const TRANSCRIPT_TOOL_ARGUMENTS = 600

/** The conversation as a Codex order reads it: each message with its id, speaker and what its tools did. */
function orderTranscript(window: CodexChatMessageRecord[], nameOf: (message: CodexChatMessageRecord) => string) {
  return window.map((message) => {
    const calls = message.tool_calls.filter((call) => call.status === 'completed').map((call) => `${call.tool} ${JSON.stringify(call.arguments ?? {}).slice(0, TRANSCRIPT_TOOL_ARGUMENTS)}`)
    const media = [...new Set([...(message.mediaAttachments ?? []).map((item) => item.compositeHash), ...message.tool_calls.flatMap((call) => call.compositeHashes)])]
    return [`[message_id=${message.id}] ${nameOf(message)}: ${message.content.trim()}`, ...calls.map((call) => `(도구: ${call})`), ...(media.length ? [`(이미지: ${media.map((hash) => `image:${hash}`).join(', ')})`] : [])].join('\n')
  }).join('\n\n')
}

/** The speaker of the reply: a room's member that wrote it, a direct chat's profile; checked like a reply of theirs. */
function orderProfile(requester: McpRequester, thread: CodexChatThreadRecord, target: CodexChatMessageRecord): ChatProfile {
  const profileId = thread.kind === 'group' ? target.speaker_profile_id : thread.profile_id
  const profile = profileId == null ? null : ChatProfileStore.find(profileId)
  if (!profile?.isEnabled || !canUseChatProfile(resolveChatAccess(requester.accountId), profile) || (thread.kind === 'group' && !ChatGroupStore.member(thread.id, profile.id))) {
    throw new ChatFlagError('이 답변을 쓴 캐릭터가 지금 응답할 수 없어.', 409)
  }
  return profile
}

/**
 * Carry out the order `value` on the reply `messageId`. Streams the calls it makes (`tool`), then `done` with the
 * reply as it is now. Holds the chat while it runs; fails (ChatFlagError / CodexChatError) when the order cannot be
 * given there or the character did not do the job.
 */
export async function runChatOrder(requester: McpRequester, threadId: number, messageId: number, value: unknown, listener: (event: CodexChatStreamEvent) => void): Promise<CodexChatMessageRecord> {
  const kind = parseChatOrderKind(value)
  if (!loadChatSettings().enabled) throw new CodexChatError('채팅이 꺼져 있어.', 403)
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new CodexChatError('채팅을 찾을 수 없어.', 404)
  const messages = CodexChatStore.listMessages(threadId)
  const index = messages.findIndex((message) => message.id === messageId)
  const target = messages[index]
  if (!target || target.role !== 'assistant') throw new ChatFlagError('지시는 캐릭터 답변에만 내릴 수 있어.')
  if (target.status !== 'completed') throw new ChatFlagError('끝까지 쓰인 답변에만 지시할 수 있어.', 409)
  if (kind === 'redraw' && !quoteMessage(thread, target).media) throw new ChatFlagError('이 답변에는 다시 그릴 이미지가 없어.')
  const profile = orderProfile(requester, thread, target)
  if (!chatOrdersOf(profile, resolveChatAccess(requester.accountId), thread.kind).includes(kind)) throw new ChatFlagError('이 캐릭터는 그 도구를 쓸 수 없어.', 403)
  // A choice card is answered by the next message, so only the latest reply can offer one.
  if (kind === 'choices' && index !== messages.length - 1) throw new ChatFlagError('선택지는 마지막 답변에서만 만들 수 있어.', 409)
  if (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)

  const replyId = CodexChatStore.ensureReplyId(threadId, messageId, randomUUID)
  const run = beginChatOrderRun(threadId, messageId, replyId)
  if (!run) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
  const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: thread.kind, replyId }
  let unregister = () => {}
  try {
    unregister = registerChatReply(context, run.signal, () => { throw new ChatReplyError('지시 작업에서는 답장 대상을 바꿀 수 없어.') })
    const emit = (event: CodexChatStreamEvent) => { if (event.type === 'tool') listener(event) }
    const directive = chatOrderDirective(kind, messageId)
    // The conversation as it stood at the reply. A summary that already covers the reply would tell what came after.
    const history = withGenerationOutcomes(messages.slice(0, index + 1))
    const summarized = (thread.summary_until_message_id ?? 0) >= messageId
    const group = thread.kind === 'group'
    let result: GroupReplyResult
    if (profile.engine === 'codex') {
      const sendable = sendableMessages(history)
      const window = group ? sendable.slice(-groupLimitsOf(thread).window) : splitTurns(sendable).slice(-resolveContextConfig(thread, profile).contextTurns).flat()
      const user = userPersonaForThread(thread)
      const nameOf = (message: CodexChatMessageRecord) => message.role === 'user' ? user.name : (group && message.speaker_profile_id ? ChatProfileStore.find(message.speaker_profile_id)?.name : profile.name) ?? '(나간 참가자)'
      const summary = !summarized && thread.summary?.trim() ? `## 그 전의 요약\n${thread.summary.trim()}` : ''
      result = await runCodexOrderTurn({
        chatContext: context, requester, threadId, profile, target, window, signal: run.signal, emit,
        buildInput: (reference) => [reference, '[대화 기록] 이 채팅에서 실제로 나눈 대화야. 마지막 메시지가 지시를 받은 네 답변이야.', summary, orderTranscript(window, nameOf), '[/대화 기록]', directive].filter(Boolean).join('\n\n'),
      })
    } else {
      const attachmentTexts = await inlineTextsForChat(profile, requester.accountId, history)
      const attachedImages = await loadAttachedImages(profile, requester, history)
      const done = (call: Parameters<typeof chatOrderDone>[1]) => chatOrderDone(kind, call)
      if (group) {
        const room: CodexChatThreadRecord = summarized ? { ...thread, summary_enabled: 0 } : thread
        const members = ChatGroupStore.members(threadId).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? [])
        const maxTokens = ChatGroupStore.member(threadId, profile.id)?.max_tokens ?? thread.max_tokens ?? profile.maxTokens
        result = await runLlmOrderTurn({
          chatContext: context, requester, threadId, profile, signal: run.signal, emit, done, generation: { maxTokens },
          buildMessages: (tools) => appendUserDirective(buildGroupLlmMessages({
            profile, thread: room, members, messages: history, routing: target.routing ?? undefined, windowLimit: groupLimitsOf(thread).window, tools, maxTokens,
            withTools: tools.some((tool) => !isChatOwnTool(tool.function.name)), segments: groupSummaryOn(room) ? ChatSummaryStore.list(threadId) : undefined,
            attachmentTexts, attachedImages,
          }), directive),
        })
      } else {
        const sized = withServerContextLimit(profile)
        const config = resolveContextConfig(thread, sized)
        if (summarized) config.summaryEnabled = false
        result = await runLlmOrderTurn({
          chatContext: context, requester, threadId, profile: sized, signal: run.signal, emit, done, generation: { maxTokens: config.maxTokens },
          buildMessages: (tools) => appendUserDirective(buildChatMessages({
            profile: sized, thread, messages: history, config, tools, segments: config.summaryEnabled ? ChatSummaryStore.list(threadId) : [],
            attachmentTexts, attachedImages,
          }), directive),
        })
      }
    }

    const calls = result.tool_calls.filter((call) => call.status === 'completed')
    if (calls.length > 0) CodexChatStore.appendReplyToolCalls(threadId, messageId, replyId, calls)
    if (!calls.some((call) => chatOrderDone(kind, call))) {
      if (run.signal.aborted || result.status === 'interrupted') throw new CodexChatError('지시를 멈췄어.', 409)
      const failed = result.tool_calls.find((call) => call.status === 'failed' && chatOrderDone(kind, call))
      throw new CodexChatError(result.error ?? (failed?.summary ? `작업이 실패했어: ${failed.summary}` : '캐릭터가 그 작업을 하지 않았어. 다시 해봐.'), 502)
    }
    const message = CodexChatStore.listMessages(threadId).find((entry) => entry.id === messageId) ?? target
    listener({ type: 'done', message })
    return message
  } finally {
    unregister()
    run.end()
  }
}
