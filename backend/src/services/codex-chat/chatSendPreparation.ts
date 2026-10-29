import type { McpRequester } from '../../mcp/context'
import type { ChatProfile } from './chatProfiles'
import type { CodexChatThreadRecord } from './codexChatStore'
import type { ChatSendOptions } from './chatTasks'
import { validateChatAttachments } from './chatAttachments'
import { validateChatMediaAttachments } from './chatMediaAttachments'
import { ChatFlagStore, parseFlagIds, parsePicks } from './chatFlags'
import { readChoiceAnswer } from './chatChoices'
import { parseChatPageContext } from './chatPageContext'
import { userReplyRouting } from './chatReplies'

/** Read-only preparation shared by the engines. No task/page state changes before delivery. */
export function prepareChatSend(
  requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, text: string,
  input: { fileIds?: unknown; flagIds?: unknown; picks?: unknown; mediaHashes?: unknown; replyToMessageId?: unknown; pageContext?: unknown; options: ChatSendOptions },
  ErrorType: new (message: string, status?: number) => Error,
) {
  const { fileIds, flagIds, picks, mediaHashes, replyToMessageId, pageContext, options } = input
  if (pageContext != null && !profile.pageAssist) throw new ErrorType('이 프로필은 페이지 어시스턴트가 꺼져 있어.', 400)
  const choice = readChoiceAnswer(thread.id, options.choice)
  if (choice && 'error' in choice) throw new ErrorType(choice.error, 409)
  const page = choice?.withoutPage ? undefined : parseChatPageContext(pageContext, requester)
  const attachments = validateChatAttachments(requester, fileIds)
  const mediaAttachments = validateChatMediaAttachments(requester, mediaHashes, attachments.length)
  const flags = [...ChatFlagStore.resolve(requester, parseFlagIds(flagIds)), ...parsePicks(picks), ...(choice?.flags ?? [])]
  const trimmed = text.trim()
  if (!trimmed && attachments.length === 0 && mediaAttachments.length === 0) throw new ErrorType('메시지를 입력해줘.')
  const routing = { ...userReplyRouting(thread, replyToMessageId), ...(options.task ? { task: options.task } : {}), ...(options.routine ? { routine: options.routine } : {}) }
  return { page, attachments, mediaAttachments, flags, trimmed, routing }
}
