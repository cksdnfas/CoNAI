import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { getCodexAvailabilityStatus } from '../codexGenerationExecutor'
import { CLAUDE_CHAT_PROVIDER } from './claudeChatCompletion'
import { resolveProfileModel } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'
import { getConnectionHealth, healthBlocksModel, recordProbeResult, type ConnectionDownReason, type ConnectionHealthEntry } from './connectionHealthState'

/** The health key of Codex profiles (they have no LLM connection). */
export const CODEX_HEALTH_KEY = '__conai_codex__'

const PROBE_TIMEOUT_MS = 5_000
/** How long a result stands before the next look asks again: a working connection rarely changes, a down one may come back. */
const UP_FRESH_MS = 3 * 60_000
const DOWN_FRESH_MS = 60_000

const probes = new Map<string, Promise<void>>()

export type ProfileConnectionDown = { reason: ConnectionDownReason; connection: string; checkedAt: string }

/**
 * A free check of one connection: its model list (`GET /models`, Ollama `GET /api/tags`) or the Codex CLI's login
 * status. Nothing is generated. Undefined when there is no free check (Claude Code: real requests tell).
 */
export async function probeConnection(providerName: string): Promise<ConnectionDownReason | null | undefined> {
  if (providerName === CODEX_HEALTH_KEY) {
    const status = await getCodexAvailabilityStatus()
    return status.available ? null : status.installed ? 'not_signed_in' : 'not_installed'
  }
  if (providerName === CLAUDE_CHAT_PROVIDER) return undefined
  const provider = ExternalApiProvider.findByName(providerName)
  const baseUrl = provider?.base_url?.trim().replace(/\/+$/, '')
  if (!provider || !provider.is_enabled || !baseUrl || (provider.provider_type !== 'llm_openai_compatible' && provider.provider_type !== 'llm_ollama')) return 'disabled'
  const url = provider.provider_type === 'llm_ollama' ? `${baseUrl.replace(/\/(api|v1)$/, '')}/api/tags` : `${baseUrl}/models`
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = ExternalApiProvider.getDecryptedKey(providerName, true)?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  let status: number
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    status = response.status
    await response.body?.cancel().catch(() => undefined)
  } catch {
    return 'unreachable'
  }
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 502 || status === 503 || status === 504) return 'unreachable'
  // It answers. A model list cannot say whether the chat model works (Strata lists only its loaded model,
  // not `strata-auto`), so a model the list lacks is left to real requests.
  return null
}

function isFresh(entry: ConnectionHealthEntry | null, now: number) {
  return entry !== null && now - entry.checkedAt < (entry.down ? DOWN_FRESH_MS : UP_FRESH_MS)
}

/** Probe the connection unless its result is still fresh; one probe per connection at a time. */
function refreshConnection(providerName: string, force: boolean) {
  if (!force && isFresh(getConnectionHealth(providerName), Date.now())) return Promise.resolve()
  const running = probes.get(providerName)
  if (running && !force) return running
  const probe = probeConnection(providerName)
    .then((reason) => { if (reason !== undefined) recordProbeResult(providerName, reason, { force }) })
    .catch(() => undefined)
    .finally(() => { if (probes.get(providerName) === probe) probes.delete(providerName) })
  probes.set(providerName, probe)
  return probe
}

/** The connection (and model) a profile's chats go through, or null when it has none to check. */
function chatConnectionOf(profile: ChatProfile) {
  if (profile.engine === 'codex') return { key: CODEX_HEALTH_KEY, model: '' }
  const resolved = resolveProfileModel(profile, 'chat')
  return resolved ? { key: resolved.providerName, model: resolved.model } : null
}

function connectionLabel(key: string) {
  if (key === CODEX_HEALTH_KEY) return 'Codex'
  if (key === CLAUDE_CHAT_PROVIDER) return 'Claude Code'
  return ExternalApiProvider.findByName(key)?.display_name || key
}

/**
 * The profiles whose chat connection is down, by id; a working one is left out. Stale connections are probed first
 * (free checks only); `force` probes every one and lets the probe override a recent failed request.
 */
export async function downChatProfiles(profiles: ChatProfile[], options: { force?: boolean } = {}) {
  const targets = profiles.flatMap((profile) => {
    const connection = chatConnectionOf(profile)
    return connection ? [{ profile, ...connection }] : []
  })
  await Promise.all([...new Set(targets.map((target) => target.key))].map((key) => refreshConnection(key, options.force === true)))
  const down: Record<number, ProfileConnectionDown> = {}
  const labels = new Map<string, string>()
  for (const { profile, key, model } of targets) {
    const entry = getConnectionHealth(key)
    if (!entry || !entry.reason || !healthBlocksModel(entry, model)) continue
    if (!labels.has(key)) labels.set(key, connectionLabel(key))
    down[profile.id] = { reason: entry.reason, connection: labels.get(key)!, checkedAt: new Date(entry.checkedAt).toISOString() }
  }
  return down
}
