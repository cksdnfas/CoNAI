/** Shared profile editor / directory fields. */
export type ChatProfileAgentSettings = {
  agentEnabled: boolean
  agentDescription: string
}

export type ChatAgentOnDone = 'notify' | 'react'
export type ChatAgentCallStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** An assistant message copied into the calling room; independent of the temporary agent room. */
export type ChatAgentResultRouting = {
  callId: number
  profileId: number
  name: string
  status: 'completed' | 'failed'
  /** Whether the caller-room copy dropped tool data, independently of bounded log/plugin summaries. */
  toolsTruncated: boolean
}
