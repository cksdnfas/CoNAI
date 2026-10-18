import type { NextFunction, Request, Response } from 'express'
import type { McpRequester } from '../mcp/context'
import { ChatPageContextError } from '../services/codex-chat/chatPageContext'
import { ChatProfileError } from '../services/codex-chat/chatProfiles'
import { loadChatSettings } from '../services/codex-chat/chatSettings'
import { ChatDiagnosticsError } from '../services/codex-chat/chatDiagnostics'
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { CodexChatError } from '../services/codex-chat/codexChatService'
import { LorebookError } from '../services/codex-chat/chatLorebookFiles'
import { LinkedFileError } from '../services/codex-chat/chatLinkedFiles'
import { MergeDecisionsMissingError } from '../services/codex-chat/chatLorebookMerge'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { LlmChatError } from '../services/codex-chat/llmChatService'
import { getRequester, getRequesterAccountId } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { FileStoreError, fileOwnerKey } from '../services/fileStoreService'
import { ChatFileChangeError } from '../services/codex-chat/chatFileChanges'
import { ChatReplyError } from '../services/codex-chat/chatReplies'
import { ChatFlagError } from '../services/codex-chat/chatFlags'
import { ChatUserProfileError } from '../services/codex-chat/chatUserProfiles'
import { ChatAppearanceError } from '../services/codex-chat/chatAppearance'
import { ChatSuggestError } from '../services/codex-chat/chatSuggestions'

/** Request parsing, access checks and error responses shared by the /api/codex-chat routers. */

export function requesterFrom(req: Request): McpRequester {
  return getRequester(req)
}

export function parseId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function parseThreadId(req: Request, res: Response) {
  const threadId = parseId(req.params.threadId)
  if (threadId === null) {
    sendRouteBadRequest(res, 'Invalid thread id')
  }
  return threadId
}

/** Group rooms take their own path for sending, rewriting and stopping (false when the thread is not the caller's). */
export function isGroupThread(req: Request, threadId: number) {
  return CodexChatStore.findThread(threadId, getRequesterAccountId(req))?.kind === 'group'
}

export function sendChatError(res: Response, error: unknown) {
  if (error instanceof ChatDiagnosticsError || error instanceof ChatPageContextError || error instanceof CodexChatError || error instanceof LlmChatError || error instanceof FileStoreError || error instanceof ChatReplyError || error instanceof ChatSuggestError || error instanceof LorebookError || error instanceof LinkedFileError || error instanceof ChatFileChangeError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  if (error instanceof ChatProfileError) {
    res.status(400).json({ success: false, error: error.message })
    return
  }
  if (error instanceof ChatFlagError || error instanceof ChatAppearanceError || error instanceof ChatUserProfileError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Chat failed' })
}

/** Which engines this session may chat with (chat on, plus the engine's permission key). */
export function chatAccessOf(req: Request) {
  const access = resolveChatAccess(getRequesterAccountId(req))
  const enabled = loadChatSettings().enabled
  return { ...access, codex: enabled && access.codex, llm: enabled && access.llm, claude: enabled && access.claude }
}

export function requireChatAccess(req: Request, res: Response, next: NextFunction) {
  const access = chatAccessOf(req)
  if (!access.codex && !access.llm && !access.claude) {
    res.status(403).json({ success: false, error: '채팅 권한이 없어.' })
    return
  }
  next()
}

/** The requester's file store key (account books are shared; chat books stay with their chat's owner). */
export function lorebookOwner(req: Request) {
  return fileOwnerKey(getRequesterAccountId(req))
}

/** A merge stopped for decisions: 409 with the preview, so the client can ask about each duplicate. */
export function sendMergeError(res: Response, error: unknown) {
  if (error instanceof MergeDecisionsMissingError) {
    res.status(409).json({ success: false, error: error.message, data: { status: 'decisions', missing: error.missing, preview: error.preview } })
    return
  }
  sendChatError(res, error)
}
