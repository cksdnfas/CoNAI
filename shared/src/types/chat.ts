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
 * `savedId` / `saved` are written back once a person saves the proposal from the card.
 */
export type ChatProposal = { id: number } & (
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
