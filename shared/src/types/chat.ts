import type { ChatPageProposal, ChatPageSnapshot } from './chatPage'

/** A recipient is a member profile, the human, or a room announcement (no automatic reply). */
export type ChatRecipient = number | 'user' | 'room'

export type ChatReplyQuote = {
  messageId: number
  role: 'user' | 'assistant'
  speakerProfileId: number | null
  speakerName: string
  excerpt: string
  alternative: number
  media?: { compositeHash: string; name: string; mimeType: string | null }
  unavailable?: boolean
}

export type ChatMessageRouting = {
  /** Stable for this particular generation, including before its message is stored. */
  replyId?: string
  replyTo: ChatReplyQuote | null
  recipients: ChatRecipient[]
}

/** Server-issued MCP binding. Models cannot choose their sender, room, or active reply. */
export type ChatExecutionContext = {
  threadId: number
  profileId: number
  kind: 'direct' | 'group'
  replyId?: string
  /** Validated, opted-in browser state for this reply only; never grants server-side authority. */
  page?: ChatPageSnapshot
}

/** Wire contracts shared by the chat server and client. */
export type ChatToolCall = {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed'
  arguments: unknown
  summary: string | null
  historyIds: number[]
  compositeHashes: string[]
  /** Truncated tool output retained for later model requests. */
  output?: string
  jobIds?: number[]
  pendingJobIds?: number[]
  /** Results this call created; lookups retain references without claiming authorship. */
  generated?: boolean
  /** A setting the model proposed with this call (propose_* tools); the card under the reply lets a person save it. */
  proposal?: ChatProposal
}

/**
 * A setting proposed from a chat. The server validates the payload with the same normalizers as the admin routes before
 * it is attached, so the client can render it as is; saving goes through the admin REST with the viewer's own session.
 * `savedId` / `saved` are written back once a person saves the proposal from the card; `dismissed` once they set it
 * aside (무시).
 */
export type ChatProposal = { id: number; dismissed?: boolean } & (
  | ChatPageProposal
  | {
      kind: 'display_block'
      /** Shared block name (defaults to the block key). */
      name: string
      /** Normalized ChatDisplayBlock: key, instruction, example, template, css, rules, summary, fields, enabled. */
      block: Record<string, unknown>
      /** Profile the card offers to link the block to (the speaking profile), or null. */
      linkProfileId: number | null
      savedId?: number | null
    }
  | {
      kind: 'profile'
      /** Normalized ChatProfileInput subset: name, tagline, systemPrompt, promptSections, greeting, alternateGreetings, modelSlotId, lorebookIds, blockIds, style, authorNote. */
      input: Record<string, unknown>
      savedId?: number | null
    }
  | {
      kind: 'profile_update'
      profileId: number
      profileName: string
      /** Only the fields that change, normalized. */
      patch: Record<string, unknown>
      /** The current values of those same fields, for the before/after view. */
      before: Record<string, unknown>
      saved?: boolean
    }
  | {
      /** save_lore: an entry for the chat's own lorebook. Saving it is done by the server (POST /api/chat-proposals/:id/apply). */
      kind: 'lore'
      title: string
      keys: string[]
      content: string
      constant: boolean
      /** A text file to put in the book's 자료/ and link to the entry. */
      file?: { name: string; text: string }
      /** The chat book entry with the same title: saving replaces it in place. */
      replaces?: string
      /** That entry as it was when proposed, for the before/after view. */
      before?: { title: string; keys: string[]; content: string; constant: boolean; file: string | null }
      /** The chat book the entry went into. */
      savedId?: number | null
    }
)

/** Message storage and client presentation can differ; the event envelope must stay identical. */
export type ChatStreamEvent<Message> =
  | { type: 'user'; message: Message }
  | { type: 'rewind'; mode: 'regenerate' | 'edit'; message: Message }
  | { type: 'delta'; text: string; profileId?: number }
  | { type: 'reasoning'; text: string; profileId?: number }
  | { type: 'tool'; call: ChatToolCall; profileId?: number }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: string }
  | { type: 'speaker'; profileId: number; speakers: number[]; queue: number[] }
  | { type: 'queue'; speakers: number[]; queue: number[] }
  | { type: 'notice'; message: string }
  | { type: 'routing'; routing: ChatMessageRouting; profileId?: number }
  /** The reply is written; its translation for display is being made before it is stored. */
  | { type: 'translating'; profileId?: number }
  /** The reply waits for something before it starts (a running summary); repeated while it waits, keeping the stream alive. */
  | { type: 'waiting'; reason: 'summary' }
  /** The live reply's whole text so far, in place of what the deltas built (a paragraph the model repeated was dropped). */
  | { type: 'text'; text: string; profileId?: number }
