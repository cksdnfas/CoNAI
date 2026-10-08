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
