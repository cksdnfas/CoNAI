import fs from 'fs'
import path from 'path'
import type { AgentCliName, AgentCliUsage, AgentCliUsageWindow } from '@conai/shared'
import { runtimePaths } from '../config/runtimePaths'
import { claudeConfigDir } from './claudeCli'
import { isCodexCliUpdating, onBeforeCodexCliUpdate } from './codexCliMaintenance'
import { CodexAppServerClient } from './codex-chat/codexAppServerClient'

const CACHE_MS = 60000
const REQUEST_TIMEOUT_MS = 15000
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const cache = new Map<AgentCliName, { value: AgentCliUsage; at: number }>()
const inFlight = new Map<AgentCliName, Promise<AgentCliUsage>>()
let codexProbe: CodexAppServerClient | null = null

// A running app-server keeps the CLI files locked on Windows; the probe yields to an update.
onBeforeCodexCliUpdate(() => { codexProbe?.close() })

const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
const isoTime = (value: unknown) => {
  const date = typeof value === 'number' ? new Date(value * 1000) : typeof value === 'string' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}
const result = (windows: AgentCliUsageWindow[], message: string | null = null): AgentCliUsage => ({ windows, checkedAt: new Date().toISOString(), message })

type CodexWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null | undefined
type CodexLimit = { limitId?: unknown; limitName?: unknown; normalModelSlug?: unknown; primary?: CodexWindow; secondary?: CodexWindow }

/** `account/rateLimits/read`: each limit bucket has up to two windows, told apart only by their duration. */
export function codexUsageWindows(raw: { rateLimits?: CodexLimit | null; rateLimitsByLimitId?: Record<string, CodexLimit | null> | null }): AgentCliUsageWindow[] {
  const limits = Object.values(raw.rateLimitsByLimitId ?? {}).filter((limit): limit is CodexLimit => Boolean(limit))
  if (!limits.length && raw.rateLimits) limits.push(raw.rateLimits)
  const windows = limits.flatMap((limit) => {
    const id = typeof limit.limitId === 'string' ? limit.limitId : 'codex'
    const model = id === 'codex' ? null : typeof limit.limitName === 'string' && limit.limitName ? limit.limitName : typeof limit.normalModelSlug === 'string' && limit.normalModelSlug ? limit.normalModelSlug : id
    return [limit.primary, limit.secondary].flatMap((entry): AgentCliUsageWindow[] => {
      const used = percent(entry?.usedPercent)
      if (!entry || used === null) return []
      const minutes = typeof entry.windowDurationMins === 'number' ? entry.windowDurationMins : null
      const window = minutes !== null && minutes <= 1440 ? 'session' : 'weekly'
      return [{ id: `${id}:${window}`, window, minutes, model, usedPercent: used, resetsAt: isoTime(entry.resetsAt) }]
    })
  })
  return windows.sort((a, b) => Number(a.model !== null) - Number(b.model !== null) || Number(a.window === 'weekly') - Number(b.window === 'weekly'))
}

async function loadCodexUsage(): Promise<AgentCliUsage> {
  if (isCodexCliUpdating() || codexProbe) return result([], 'Codex 업데이트 중이라 한도를 확인하지 못했어.')
  fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
  let client: CodexAppServerClient | null = null
  try {
    client = await CodexAppServerClient.start({ args: [], env: process.env, cwd: runtimePaths.tempDir, chatOnly: true })
    codexProbe = client
    const raw = await client.request<Parameters<typeof codexUsageWindows>[0]>('account/rateLimits/read', null, REQUEST_TIMEOUT_MS)
    return result(codexUsageWindows(raw ?? {}))
  } catch {
    return result([], 'Codex 한도를 확인하지 못했어.')
  } finally {
    client?.close()
    if (codexProbe === client) codexProbe = null
  }
}

type ClaudeLimit = { kind?: unknown; group?: unknown; percent?: unknown; resets_at?: unknown; scope?: { model?: { id?: unknown; display_name?: unknown } | null } | null }
type ClaudeBucket = { utilization?: unknown; resets_at?: unknown } | null | undefined

/** `/api/oauth/usage`: `limits` lists the session, weekly and per-model weekly windows; older responses only have the named buckets. */
export function claudeUsageWindows(raw: { limits?: ClaudeLimit[] | null; five_hour?: ClaudeBucket; seven_day?: ClaudeBucket }): AgentCliUsageWindow[] {
  if (Array.isArray(raw.limits) && raw.limits.length) {
    return raw.limits.flatMap((limit, index): AgentCliUsageWindow[] => {
      const used = percent(limit.percent)
      if (used === null) return []
      const window = limit.group === 'session' || limit.kind === 'session' ? 'session' : limit.group === 'weekly' ? 'weekly' : null
      if (!window) return []
      const name = limit.scope?.model?.display_name ?? limit.scope?.model?.id
      const model = typeof name === 'string' && name ? name : null
      return [{ id: `${String(limit.kind ?? window)}:${model ?? index}`, window, minutes: window === 'session' ? 300 : 10080, model, usedPercent: used, resetsAt: isoTime(limit.resets_at) }]
    })
  }
  return ([['session', raw.five_hour, 300], ['weekly', raw.seven_day, 10080]] as const).flatMap(([window, bucket, minutes]): AgentCliUsageWindow[] => {
    const used = percent(bucket?.utilization)
    return used === null ? [] : [{ id: window, window, minutes, model: null, usedPercent: used, resetsAt: isoTime(bucket?.resets_at) }]
  })
}

/** The subscription token the CLI itself uses: an explicit long-lived token, else the signed-in OAuth credentials. */
function claudeAccessToken() {
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (env) return env
  try {
    const oauth = JSON.parse(fs.readFileSync(path.join(claudeConfigDir(), '.credentials.json'), 'utf8'))?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null
    // The CLI refreshes the token on its next request; until then the old one is rejected anyway.
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) return 'expired'
    return oauth.accessToken as string
  } catch { return null }
}

async function loadClaudeUsage(): Promise<AgentCliUsage> {
  const token = claudeAccessToken()
  if (!token) return result([], 'Claude 구독 로그인일 때만 한도를 볼 수 있어.')
  if (token === 'expired') return result([], 'Claude 토큰이 만료돼서 다음 사용 뒤에 다시 확인할 수 있어.')
  try {
    const response = await fetch(CLAUDE_USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) return result([], 'Claude 한도를 확인하지 못했어.')
    return result(claudeUsageWindows(((await response.json()) ?? {}) as Parameters<typeof claudeUsageWindows>[0]))
  } catch {
    return result([], 'Claude 한도를 확인하지 못했어.')
  }
}

export async function getAgentCliUsage(agent: AgentCliName, refresh = false): Promise<AgentCliUsage> {
  const cached = cache.get(agent)
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const pending = inFlight.get(agent)
  if (pending) return pending
  const load = (agent === 'codex' ? loadCodexUsage() : loadClaudeUsage())
    .then((value) => { cache.set(agent, { value, at: Date.now() }); return value })
    .finally(() => inFlight.delete(agent))
  inFlight.set(agent, load)
  return load
}
