import { createContext, useContext } from 'react'
import type { CodexChatToolCall } from '@/lib/api-codex-chat'
import type { StoredFileEntry } from '@conai/shared'

export const CODEX_CHAT_ROUTE = '/chat'
export const CODEX_CHAT_THREADS_QUERY_KEY = ['codex-chat-threads'] as const

export function codexChatThreadQueryKey(threadId: number | null) {
  return ['codex-chat-thread', threadId] as const
}

export function codexChatMediaQueryKey(threadId: number | null) {
  return ['codex-chat-media', threadId] as const
}

export type CodexChatView = 'chat' | 'gallery' | 'context'

/** One group member's reply while it streams. */
export type CodexChatLiveReply = {
  profileId: number
  text: string
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
}

/** The turn being streamed: the thread only refetches after it ends, so the UI shows it from here meanwhile. */
export type CodexChatLiveTurn = {
  replacingMessageId?: number
  attachments: StoredFileEntry[]
  threadId: number
  userText: string
  /** Direct chats: the reply so far (group rooms stream into `replies`). */
  text: string
  /** LLM chats: the model's reasoning so far (shown folded, never stored). */
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
  /** Group rooms: members answering now, in the order they started (several when their connection allows). */
  replies?: CodexChatLiveReply[]
  /** Group rooms: who answers after them. */
  queue?: number[]
}

export interface CodexChatApi {
  /** Chat is on in settings and this account may use it (admin). */
  canUse: boolean
  isPanelOpen: boolean
  openPanel: () => void
  closePanel: () => void
  view: CodexChatView
  setView: (view: CodexChatView) => void
  /** `undefined` follows the latest saved chat. */
  selectedThreadId: number | null | undefined
  selectThread: (threadId: number | null | undefined) => void
  /** Create a chat with a profile (its greeting arrives as the first message) and open it. */
  startChat: (profileId: number) => Promise<void>
  isStartingChat: boolean
  draft: string
  setDraft: (draft: string | ((current: string) => string)) => void
  liveTurn: CodexChatLiveTurn | null
  draftAttachments: StoredFileEntry[]
  attachmentsUploading: boolean
  addAttachments: (files: StoredFileEntry[]) => void
  removeAttachment: (id: string) => void
  uploadAttachments: (files: File[]) => Promise<void>
  /** Send `draft` to `threadId` and stream the reply. */
  send: (threadId: number, text?: string) => Promise<void>
  regenerate: (threadId: number, messageId: number) => Promise<boolean>
  editMessage: (threadId: number, messageId: number, content: string) => Promise<boolean>
  stop: (threadId: number) => void
  /** A message the chat view should scroll to and flash (from the gallery's "go to message"). */
  messageFocus: { messageId: number; nonce: number } | null
  focusMessage: (messageId: number) => void
  /** The chat view handled `messageFocus`; drop it so a remount does not jump again. */
  clearMessageFocus: () => void
}

export const CodexChatContext = createContext<CodexChatApi | null>(null)

export function useCodexChat() {
  return useContext(CodexChatContext)
}
