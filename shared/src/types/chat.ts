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
