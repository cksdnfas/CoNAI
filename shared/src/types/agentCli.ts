export type AgentCliName = 'codex' | 'claude'

export type AgentCliStatus = {
  installed: boolean
  authenticated: boolean
  available: boolean
  authMethod: string | null
  message: string | null
}

export type AgentCliVersion = {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  updating: boolean
  installTarget: 'prefix' | 'global'
  message: string | null
}

export type ClaudeLoginState = {
  status: 'idle' | 'starting' | 'pending' | 'succeeded' | 'failed' | 'cancelled'
  verificationUrl: string | null
  expiresAt: string | null
  message: string | null
}

/** A model the server's Claude Code CLI offers: an alias (`opus`, `sonnet`…) that tracks the newest version, or a pinned ID. */
export type ClaudeModelOption = {
  id: string
  label: string
  /** The model ID the alias currently resolves to. */
  resolvedModel: string
  supportedEffortLevels: string[]
}

export type ClaudeModelList = {
  models: ClaudeModelOption[]
  source: 'cli' | 'unavailable'
}
