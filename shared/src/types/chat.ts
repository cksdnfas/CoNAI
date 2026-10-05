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
}

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
