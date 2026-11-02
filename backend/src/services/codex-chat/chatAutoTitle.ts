import { CHAT_THREAD_TITLE_MAX_LENGTH } from '@conai/shared'
import { summaryGenerationOptions } from '../llmGenerationOptions'
import { inBackground } from '../llmRequestScheduler'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { profileGenerationOptions, type ChatProfile } from './chatProfiles'
import { resolveProfileModel } from './chatModelRoles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { stripThinking } from './llmChatContext'
import { resolveChatCompletionTarget, streamChatCompletion } from './llmChatCompletion'
import { serverContextLimit, summaryContextRoom } from './serverContextLimit'

const TITLE_PROMPT = [
  'Below is the first exchange of a chat. Write a one-line title that sums it up, so the chat can be recognised in the chat list.',
  'Write a short noun phrase in the language the conversation uses: the title only, without quotes, a final period, emoji or explanation.',
].join('\n')

/** The model's answer as a title: its first line, without a "제목:" label, heading marks, quotes or a closing period. */
function titleOf(text: string) {
  const line = text.split('\n').map((entry) => entry.trim()).find(Boolean) ?? ''
  return line
    .replace(/^(#+\s*|\*\*|(제목|title)\s*[:：]\s*)+/iu, '')
    .replace(/\*\*$/u, '')
    .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/gu, '')
    .replace(/[.。]$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A new chat is first named after its opening message. Once its first reply is stored, the profile's summary model
 * names it after what was said; a chat renamed in the meantime keeps its name. Like the conversation summary, this
 * runs only while the chat's summary is on and a summary model is set; otherwise the chat keeps the message as its
 * name. The chat lists hear about the new title through `chat.thread.updated`.
 */
export function titleAfterFirstReply(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'id' | 'summary_enabled' | 'max_tokens'>, firstTitle: string, userText: string, reply: Promise<CodexChatMessageRecord | null>) {
  const summaryOn = thread.summary_enabled === null ? profile.summaryEnabled : thread.summary_enabled === 1
  const model = summaryOn ? resolveProfileModel(profile, 'summary') : null
  if (!model) return
  const threadId = thread.id
  const expectedTitle = firstTitle.slice(0, CHAT_THREAD_TITLE_MAX_LENGTH)
  const watch = CodexChatStore.watchAutomaticTitle(threadId)
  const isCurrent = () => watch.current() && CodexChatStore.findThreadById(threadId)?.title === expectedTitle
  return reply.then(async (message) => {
    const answer = message?.status === 'completed' ? (message.display_content ?? message.content).trim() : ''
    if (!answer || !isCurrent()) return
    const controller = new AbortController()
    const generation = profileGenerationOptions(profile)
    const target = resolveChatCompletionTarget(model.providerName, { model: model.model })
    const messages = [{ role: 'system' as const, content: TITLE_PROMPT }, { role: 'user' as const, content: `## User\n${userText}\n\n## Reply\n${answer}` }]
    const limit = await serverContextLimit(target)
    if (!isCurrent()) return
    const room = summaryContextRoom(limit, messages)
    if (room === false) return
    const maxTokens = thread.max_tokens ?? profile.maxTokens
    target.generation = {
      ...generation,
      reasoningEffort: summaryGenerationOptions(generation, target.thinkingSwitch).reasoningEffort,
      reasoningBudgetTokens: null,
      maxTokens: maxTokens === null || room === null ? maxTokens : Math.min(maxTokens, room),
    }
    let result
    try {
      result = await inBackground(() => streamChatCompletion({
        target,
        messages,
        signal: controller.signal,
        retry: false,
        stopLoops: true,
        usage: { purpose: 'summary', profileId: profile.id, threadId },
        // A rename or deletion while this background request waited for a connection slot makes it unnecessary.
        onRequestBody: () => { if (!isCurrent()) { controller.abort(); controller.signal.throwIfAborted() } },
      }))
    } catch (error) {
      if (controller.signal.aborted) return
      throw error
    }
    if (result.finishReason === 'length') return
    const title = titleOf(stripThinking(result.content))
    if (!title || !isCurrent() || !CodexChatStore.renameThreadIf(threadId, firstTitle, title)) return
    const updated = CodexChatStore.findThreadById(threadId)
    if (!updated) return
    publishRuntimeEvent({ name: 'chat.thread.updated', topic: 'generation-queue', visibility: 'owner', accountId: updated.account_id, payload: { threadId, title: updated.title, requestedByAccountId: updated.account_id } })
  }, () => undefined).catch((error: unknown) => {
    console.warn('[chat] automatic title failed:', error instanceof Error ? error.message : error)
  }).finally(watch.release)
}
