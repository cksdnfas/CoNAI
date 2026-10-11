import { LlmRequestError, isTransientConnectionError } from '../llmRequestRetry'

/**
 * Why a chat connection is down. `unreachable`: nothing answers; `auth`: the key is refused; `quota`: out of credits
 * or rate limited; `model_missing`: the server does not know the model; `disabled`: the connection is off, gone or
 * has no address; `not_installed` / `not_signed_in`: the Codex / Claude Code CLI.
 */
export type ConnectionDownReason = 'unreachable' | 'auth' | 'quota' | 'model_missing' | 'disabled' | 'not_installed' | 'not_signed_in'

export type ConnectionHealthEntry = {
  down: boolean
  reason: ConnectionDownReason | null
  /** `model_missing` only concerns this model; every other reason concerns the whole connection. */
  model: string | null
  /** probe: a free check (model list, CLI status); request: a real chat request's outcome. */
  source: 'probe' | 'request'
  checkedAt: number
}

/** A real request's failure outranks a probe for this long, so a passing model list does not hide it. */
const REQUEST_RESULT_HOLD_MS = 5 * 60_000

const entries = new Map<string, ConnectionHealthEntry>()

export function getConnectionHealth(providerName: string) {
  return entries.get(providerName) ?? null
}

/** A probe result; it leaves a recent request failure alone unless `force` (the person asked to check again). */
export function recordProbeResult(providerName: string, reason: ConnectionDownReason | null, options: { force?: boolean; now?: number } = {}) {
  const now = options.now ?? Date.now()
  const current = entries.get(providerName)
  if (!options.force && current?.source === 'request' && current.down && now - current.checkedAt < REQUEST_RESULT_HOLD_MS) return
  entries.set(providerName, { down: reason !== null, reason, model: null, source: 'probe', checkedAt: now })
}

/**
 * Why a failed chat request means the connection is down, or null when it says nothing about the connection
 * (a cancel, a timeout mid-answer, a 5xx the server may recover from, a bad request).
 */
export function classifyRequestFailure(error: unknown): ConnectionDownReason | null {
  if (!(error instanceof Error) || error.name === 'AbortError' || error.name === 'TimeoutError') return null
  if (error instanceof LlmRequestError && error.status !== undefined) {
    if (error.status === 401 || error.status === 403) return 'auth'
    if (error.status === 402 || error.status === 429) return 'quota'
    if (error.status === 404) return 'model_missing'
    if (error.status === 502 || error.status === 503 || error.status === 504) return 'unreachable'
    return null
  }
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'not_installed'
  return isTransientConnectionError(error) ? 'unreachable' : null
}

/** A real chat request's outcome: success clears the connection, a telling failure marks it down. */
export function recordRequestOutcome(providerName: string, model: string, error: unknown, now = Date.now()) {
  if (error === null) {
    entries.set(providerName, { down: false, reason: null, model: null, source: 'request', checkedAt: now })
    return
  }
  const reason = classifyRequestFailure(error)
  if (!reason) return
  entries.set(providerName, { down: true, reason, model: reason === 'model_missing' ? model : null, source: 'request', checkedAt: now })
}

/** Whether the entry blocks a chat on `model` of its connection. */
export function healthBlocksModel(entry: ConnectionHealthEntry | null, model: string) {
  return Boolean(entry?.down && (entry.reason !== 'model_missing' || entry.model === model))
}

/** Tests only. */
export function resetConnectionHealth() {
  entries.clear()
}
