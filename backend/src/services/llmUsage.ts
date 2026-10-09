import { getUserSettingsDb } from '../database/userSettingsDb'

/** What a model request was for. The dashboard folds the small ones (translation, suggestions, asset work) together. */
export type LlmUsagePurpose = 'chat' | 'summary' | 'judge' | 'translation' | 'suggestion' | 'asset_vision' | 'appearance' | 'workflow' | 'other'
/** How the request reached the model: an API connection, a subscription CLI, or the TypeSafe judge API. */
export type LlmUsageEngine = 'api' | 'claude-code' | 'codex' | 'typesafe'

/** Who asked, given by the caller of a completion. */
export type LlmUsageTag = { purpose: LlmUsagePurpose; profileId?: number | null; threadId?: number | null }

export type LlmTokenCounts = { inputTokens: number; cachedInputTokens: number; outputTokens: number }

export type LlmUsageEvent = LlmUsageTag & {
  engine: LlmUsageEngine
  providerName: string
  model: string
  tokens: LlmTokenCounts | null
  /** The counts are our estimate: the server reported none. */
  estimated?: boolean
  latencyMs: number
  ok: boolean
}

const RETENTION_DAYS = 90
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastPrune = 0
let ledgerWarned = false

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Token counts from a response's `usage`: OpenAI style (`prompt_tokens`, `completion_tokens`, cached prompt tokens under
 * `prompt_tokens_details`), Anthropic style (`input_tokens` plus cache reads and writes) or Ollama's top-level counts.
 * Null when the body reports nothing.
 */
export function readUsageCounts(json: unknown): LlmTokenCounts | null {
  const body = json as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return null
  const usage = body.usage as Record<string, unknown> | undefined
  if (usage && typeof usage === 'object') {
    if (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number') {
      const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
      return {
        inputTokens: count(usage.prompt_tokens),
        cachedInputTokens: count(details?.cached_tokens ?? usage.cache_read_input_tokens),
        outputTokens: count(usage.completion_tokens),
      }
    }
    if (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number') {
      const cached = count(usage.cache_read_input_tokens)
      return { inputTokens: count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + cached, cachedInputTokens: cached, outputTokens: count(usage.output_tokens) }
    }
  }
  if (typeof body.prompt_eval_count === 'number' || typeof body.eval_count === 'number') {
    return { inputTokens: count(body.prompt_eval_count), cachedInputTokens: 0, outputTokens: count(body.eval_count) }
  }
  return null
}

/** Rough tokens: ~4 ASCII characters or ~1 other character (Korean, CJK) per token. Errs high. */
export function rawTokenEstimate(text: string) {
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4 + other)
}

type EstimatedMessage = { role: string; content: unknown }

export function rawMessagesEstimate(messages: EstimatedMessage[], tools: unknown[] = []) {
  // App tools supply <=512px previews. Reserve an approximate image allowance instead of
  // counting their base64 transport encoding as text tokens; provider tokenizers differ.
  let imageCount = 0
  const textMessages = messages.map((message) => message.role === 'user' && Array.isArray(message.content)
    ? { ...message, content: (message.content as Array<{ type?: string }>).map((part) => {
      if (part.type !== 'image_url') return part
      imageCount += 1
      return { type: 'image_url', image_url: { url: '(image)' } }
    }) }
    : message)
  return rawTokenEstimate(JSON.stringify(textMessages) + (tools.length > 0 ? JSON.stringify(tools) : '')) + imageCount * 2048
}

/** An abort the caller asked for (a stop, a closed page) used no tokens worth counting; a timeout is a failure. */
export function isCallerAbort(signal: AbortSignal) {
  if (!signal.aborted) return false
  const reason = signal.reason as { name?: unknown } | undefined
  return reason?.name !== 'TimeoutError'
}

/** One model request into the ledger. Never throws: the meter must not break the request it measures. */
export function recordLlmUsage(event: LlmUsageEvent) {
  try {
    const db = getUserSettingsDb()
    db.prepare(`
      INSERT INTO llm_usage_events (purpose, engine, provider_name, model, profile_id, thread_id, input_tokens, cached_input_tokens, output_tokens, estimated, latency_ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.purpose, event.engine, event.providerName, event.model, event.profileId ?? null, event.threadId ?? null,
      count(event.tokens?.inputTokens), count(event.tokens?.cachedInputTokens), count(event.tokens?.outputTokens),
      event.estimated ? 1 : 0, count(event.latencyMs), event.ok ? 1 : 0,
    )
    const now = Date.now()
    if (now - lastPrune >= PRUNE_INTERVAL_MS) {
      lastPrune = now
      db.prepare(`DELETE FROM llm_usage_events WHERE created_at < datetime('now', ?)`).run(`-${RETENTION_DAYS} days`)
    }
  } catch (error) {
    // Once per process: a broken ledger would otherwise warn on every request.
    if (!ledgerWarned) console.warn('[llm-usage] could not record a request:', error instanceof Error ? error.message : error)
    ledgerWarned = true
  }
}

type Totals = { requests: number; failed: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedRequests: number; averageLatencyMs: number | null }

export type LlmUsageSummary = {
  days: number
  totals: Totals
  /** One entry per local day of the period, oldest first, including days without requests. */
  daily: Array<{ date: string; requests: number; failed: number; inputTokens: number; outputTokens: number; averageLatencyMs: number | null }>
  byPurpose: Array<{ date: string; purpose: LlmUsagePurpose; requests: number; tokens: number }>
  byModel: Array<{ date: string; providerName: string; model: string; requests: number; tokens: number }>
  models: Array<Totals & { providerName: string; model: string; engine: LlmUsageEngine }>
}

const TOTAL_COLUMNS = `COUNT(*) AS requests, SUM(1 - ok) AS failed, SUM(input_tokens) AS inputTokens, SUM(cached_input_tokens) AS cachedInputTokens,
  SUM(output_tokens) AS outputTokens, SUM(estimated) AS estimatedRequests, AVG(CASE WHEN latency_ms > 0 THEN latency_ms END) AS averageLatencyMs`

function totalsOf(row: Record<string, unknown> | undefined): Totals {
  const average = row?.averageLatencyMs
  return {
    requests: count(row?.requests), failed: count(row?.failed), inputTokens: count(row?.inputTokens), cachedInputTokens: count(row?.cachedInputTokens),
    outputTokens: count(row?.outputTokens), estimatedRequests: count(row?.estimatedRequests), averageLatencyMs: typeof average === 'number' ? Math.round(average) : null,
  }
}

/**
 * The dashboard's numbers for the last `days` local days. `offsetMinutes` is the viewer's UTC offset (KST = 540): days
 * are cut at the viewer's midnight, not the server's.
 */
export function buildLlmUsageSummary(days: number, offsetMinutes = 0): LlmUsageSummary {
  const db = getUserSettingsDb()
  const shift = `${offsetMinutes >= 0 ? '+' : ''}${Math.round(offsetMinutes)} minutes`
  const localDate = `date(created_at, '${shift}')`
  const today = (db.prepare(`SELECT date('now', ?) AS today`).get(shift) as { today: string }).today
  const todayStart = Date.parse(`${today}T00:00:00Z`)
  const dates = Array.from({ length: days }, (_, index) => new Date(todayStart - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10))
  const since = dates[0]
  const where = `WHERE ${localDate} >= ?`

  const totals = totalsOf(db.prepare(`SELECT ${TOTAL_COLUMNS} FROM llm_usage_events ${where}`).get(since) as Record<string, unknown>)
  const dailyRows = new Map((db.prepare(`
    SELECT ${localDate} AS date, COUNT(*) AS requests, SUM(1 - ok) AS failed, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
      AVG(CASE WHEN latency_ms > 0 THEN latency_ms END) AS averageLatencyMs
    FROM llm_usage_events ${where} GROUP BY date
  `).all(since) as Array<Record<string, unknown>>).map((row) => [String(row.date), row]))
  const daily = dates.map((date) => {
    const row = dailyRows.get(date)
    const average = row?.averageLatencyMs
    return { date, requests: count(row?.requests), failed: count(row?.failed), inputTokens: count(row?.inputTokens), outputTokens: count(row?.outputTokens), averageLatencyMs: typeof average === 'number' ? Math.round(average) : null }
  })
  const byPurpose = (db.prepare(`
    SELECT ${localDate} AS date, purpose, COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens
    FROM llm_usage_events ${where} GROUP BY date, purpose ORDER BY date
  `).all(since) as Array<Record<string, unknown>>).map((row) => ({ date: String(row.date), purpose: row.purpose as LlmUsagePurpose, requests: count(row.requests), tokens: count(row.tokens) }))
  const byModel = (db.prepare(`
    SELECT ${localDate} AS date, provider_name AS providerName, model, COUNT(*) AS requests, SUM(input_tokens + output_tokens) AS tokens
    FROM llm_usage_events ${where} GROUP BY date, provider_name, model ORDER BY date
  `).all(since) as Array<Record<string, unknown>>).map((row) => ({ date: String(row.date), providerName: String(row.providerName), model: String(row.model), requests: count(row.requests), tokens: count(row.tokens) }))
  const models = (db.prepare(`
    SELECT provider_name AS providerName, model, MAX(engine) AS engine, ${TOTAL_COLUMNS}
    FROM llm_usage_events ${where} GROUP BY provider_name, model ORDER BY SUM(input_tokens + output_tokens) DESC, COUNT(*) DESC
  `).all(since) as Array<Record<string, unknown>>).map((row) => ({ ...totalsOf(row), providerName: String(row.providerName), model: String(row.model), engine: row.engine as LlmUsageEngine }))
  return { days, totals, daily, byPurpose, byModel, models }
}
