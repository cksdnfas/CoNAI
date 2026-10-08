import { createContext, useContext } from 'react'
import type { ChatFlagSnapshot, ChatMediaAttachment, CodexChatToolCall } from '@/lib/api-codex-chat'
import type { StoredFileEntry, ChatMessageRouting, ChatReplyQuote } from '@conai/shared'

export const CODEX_CHAT_ROUTE = '/chat'
export const CODEX_CHAT_THREADS_QUERY_KEY = ['codex-chat-threads'] as const
/** The side panel docks beside the page from this width (Tailwind `lg`); below it the panel covers the screen. */
export const CHAT_DOCK_MIN_WIDTH_PX = 1024

export function codexChatThreadQueryKey(threadId: number | null) {
  return ['codex-chat-thread', threadId] as const
}

export function codexChatMediaQueryKey(threadId: number | null) {
  return ['codex-chat-media', threadId] as const
}

/** Compacting (summarizing) a chat, from the menu, /compact or the context view: the chat waits until it ends. */
export function codexChatCompactMutationKey(threadId: number | null) {
  return ['codex-chat-compact', threadId] as const
}

export type CodexChatView = 'chat' | 'gallery' | 'context'

/** The composer text of the new chat being prepared (saved chats use their ids, which start at 1). */
export const PENDING_DRAFT_KEY = 0

/**
 * A new 1:1 chat that is not saved yet: it shows the profile's greeting and is saved, with that greeting, when its
 * first message is sent (so opening and leaving it leaves nothing behind). `greeting` is null while it loads.
 */
export type CodexChatPendingChat = {
  profileId: number
  /** Undefined until the preview says which user profile the chat takes (then a number or null). */
  userProfileId: number | null | undefined
  greeting: { index: number | null; text: string; greetings: string[] } | null
}

/** The chat opened when none is chosen: the latest one in the list (archived chats only when nothing else is left). */
export function defaultThreadId(threads: Array<{ id: number; archived?: 0 | 1 }>) {
  return (threads.find((thread) => !thread.archived) ?? threads[0])?.id ?? null
}

/** One group member's reply while it streams. */
export type CodexChatLiveReply = {
  routing?: ChatMessageRouting
  profileId: number
  text: string
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
  /** The reply is written and being translated for display. */
  translating?: boolean
}

/** The turn being streamed: the thread only refetches after it ends, so the UI shows it from here meanwhile. */
export type CodexChatLiveTurn = {
  routing?: ChatMessageRouting
  userRouting?: ChatMessageRouting
  replacingMessageId?: number
  attachments: StoredFileEntry[]
  mediaAttachments: ChatMediaAttachment[]
  threadId: number
  userText: string
  /** The chat flags on for the message being sent (shown under it until it is stored). */
  flags?: ChatFlagSnapshot[]
  /** Direct chats: the reply so far (group rooms stream into `replies`). */
  text: string
  /** LLM chats: the model's reasoning so far (shown folded, never stored). */
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
  /** Direct chats: the reply is written and being translated for display. */
  translating?: boolean
  /** Group rooms: members answering now, in the order they started (several when their connection allows). */
  replies?: CodexChatLiveReply[]
  /** Group rooms: who answers after them. */
  queue?: number[]
}

export interface CodexChatApi {
  draftReply: { threadId: number; quote: ChatReplyQuote } | null
  setDraftReply: (reply: { threadId: number; quote: ChatReplyQuote } | null) => void
  /** Chat is on in settings and this account may use it (admin). */
  canUse: boolean
  isPanelOpen: boolean
  openPanel: () => void
  closePanel: () => void
  view: CodexChatView
  setView: (view: CodexChatView) => void
  /** `undefined` follows the latest saved chat. */
  selectedThreadId: number | null | undefined
  /** Opening a chat (or the profile picker, `null`) also leaves the chat list. */
  selectThread: (threadId: number | null | undefined) => void
  /** Fix "the latest chat" (`undefined`) to this chat, without the side effects of selecting it. */
  settleSelection: (threadId: number) => void
  /** The narrow layouts (panel, phone-width page) show the chat list instead of a chat; the selection stays. */
  listOpen: boolean
  /** Also returns from the gallery or context to the chat. */
  setListOpen: (open: boolean) => void
  /** The new chat being prepared (see CodexChatPendingChat); opening a saved chat or the list drops it. */
  pendingChat: CodexChatPendingChat | null
  /** Prepare a new chat with a profile. `userProfileId` left out: the default user profile; null: the plain user. */
  prepareChat: (profileId: number, userProfileId?: number | null) => void
  selectPendingGreeting: (index: number) => void
  /** Save the prepared chat and send its first message. */
  sendPending: (text: string) => Promise<void>
  isStartingChat: boolean
  /** The composer text of each chat (chats without one are left out). */
  drafts: Record<number, string>
  setDraft: (threadId: number, draft: string | ((current: string) => string)) => void
  /** Forget the texts of chats not among these (deleted elsewhere). */
  keepDrafts: (threadIds: number[]) => void
  /** Items chosen in the status panel (`data-pick`), sent with the next message. */
  picks: string[]
  togglePick: (label: string) => void
  removePick: (label: string) => void
  liveTurn: CodexChatLiveTurn | null
  draftAttachments: StoredFileEntry[]
  draftMediaAttachments: ChatMediaAttachment[]
  setMediaAttachments: (items: ChatMediaAttachment[]) => boolean
  removeMediaAttachment: (hash: string) => void
  /** "참조" on an image in the transcript: attach it to the next message, or detach it when it already is. */
  toggleMediaAttachment: (item: ChatMediaAttachment) => void
  attachmentsUploading: boolean
  addAttachments: (files: StoredFileEntry[]) => void
  removeAttachment: (id: string) => void
  uploadAttachments: (files: File[]) => Promise<void>
  /** Send `draft` to `threadId` and stream the reply. */
  send: (threadId: number, text?: string) => Promise<void>
  regenerate: (threadId: number, messageId: number) => Promise<boolean>
  /** Carry on the last reply where the token cap cut it. */
  continueReply: (threadId: number, messageId: number) => Promise<boolean>
  editMessage: (threadId: number, messageId: number, content: string) => Promise<boolean>
  stop: (threadId: number) => void
  /** A message the chat view should scroll to and flash (from the gallery's "go to message"). */
  messageFocus: { messageId: number; nonce: number } | null
  focusMessage: (messageId: number) => void
  /** The chat view handled `messageFocus`; drop it so a remount does not jump again. */
  clearMessageFocus: () => void
}

export const CodexChatContext = createContext<CodexChatApi | null>(null)

/**
 * The slice the transcript's thumbnails and reference chips need. Separate from `CodexChatApi` so they do not
 * re-render on every composer keystroke (the full API changes with `draft`).
 */
export type CodexChatReferenceApi = {
  /** Chat is usable and its side panel is open (see `useChatDockedBesidePage` for "docked beside this page"). */
  panelOpen: boolean
  draftMediaAttachments: ChatMediaAttachment[]
  toggleMediaAttachment: (item: ChatMediaAttachment) => void
  focusMessage: (messageId: number) => void
}

export const CodexChatReferenceContext = createContext<CodexChatReferenceApi | null>(null)

export function useCodexChatReference() {
  return useContext(CodexChatReferenceContext)
}

export function useCodexChat() {
  return useContext(CodexChatContext)
}
