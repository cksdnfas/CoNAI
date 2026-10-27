import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import type { ChatProfile } from './chatProfiles'
import { resolveProfileModel } from './chatModelRoles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { completeSummary } from './llmChatContext'

const TITLE_PROMPT = [
  '아래는 채팅의 첫 대화야. 채팅 목록에서 이 채팅을 알아볼 수 있게, 대화 내용을 요약한 제목을 한 줄로 써.',
  '대화에 쓰인 언어로 짧은 명사구로 쓰고, 따옴표·마침표·이모지·설명 없이 제목만 써.',
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
export function titleAfterFirstReply(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'id' | 'summary_enabled'>, firstTitle: string, userText: string, reply: Promise<CodexChatMessageRecord | null>) {
  const summaryOn = thread.summary_enabled === null ? profile.summaryEnabled : thread.summary_enabled === 1
  if (!summaryOn || !resolveProfileModel(profile, 'summary')) return
  const threadId = thread.id
  void reply.then(async (message) => {
    const answer = message?.status === 'completed' ? (message.display_content ?? message.content).trim() : ''
    if (!answer) return
    const title = titleOf(await completeSummary(profile, TITLE_PROMPT, `## 사용자\n${userText}\n\n## 답변\n${answer}`, undefined, undefined, threadId))
    if (!title || !CodexChatStore.renameThreadIf(threadId, firstTitle, title)) return
    const accountId = CodexChatStore.findThreadById(threadId)?.account_id ?? null
    publishRuntimeEvent({ name: 'chat.thread.updated', topic: 'generation-queue', visibility: 'owner', accountId, payload: { threadId, requestedByAccountId: accountId } })
  }, () => undefined).catch((error: unknown) => {
    console.warn('[chat] automatic title failed:', error instanceof Error ? error.message : error)
  })
}
