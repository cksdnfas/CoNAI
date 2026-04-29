import { logger } from './logger'

const DEFAULT_FLUSH_INTERVAL_MS = 10_000
const DEFAULT_MIN_COUNT = 2

type CadenceBucket = {
  key: string
  count: number
  firstAt: number
  lastAt: number
  previousAt: number | null
  minIntervalMs: number | null
  maxIntervalMs: number | null
  totalIntervalMs: number
  intervalCount: number
  lastMeta?: Record<string, unknown>
}

const buckets = new Map<string, CadenceBucket>()
let flushHandle: ReturnType<typeof setInterval> | null = null

function parsePositiveEnvNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldDisableCadenceLogs() {
  return process.env.CONAI_CADENCE_LOGS === 'false'
}

export function recordCadenceEvent(key: string, meta?: Record<string, unknown>) {
  if (shouldDisableCadenceLogs()) {
    return
  }

  const now = Date.now()
  const bucket = buckets.get(key) ?? {
    key,
    count: 0,
    firstAt: now,
    lastAt: now,
    previousAt: null,
    minIntervalMs: null,
    maxIntervalMs: null,
    totalIntervalMs: 0,
    intervalCount: 0,
  }

  if (bucket.previousAt !== null) {
    const intervalMs = now - bucket.previousAt
    bucket.minIntervalMs = bucket.minIntervalMs === null ? intervalMs : Math.min(bucket.minIntervalMs, intervalMs)
    bucket.maxIntervalMs = bucket.maxIntervalMs === null ? intervalMs : Math.max(bucket.maxIntervalMs, intervalMs)
    bucket.totalIntervalMs += intervalMs
    bucket.intervalCount += 1
  }

  bucket.count += 1
  bucket.lastAt = now
  bucket.previousAt = now
  if (meta) {
    bucket.lastMeta = meta
  }

  buckets.set(key, bucket)
}

export function startCadenceLogger() {
  if (flushHandle || shouldDisableCadenceLogs()) {
    return false
  }

  const flushIntervalMs = parsePositiveEnvNumber(process.env.CONAI_CADENCE_LOG_INTERVAL_MS, DEFAULT_FLUSH_INTERVAL_MS)
  const minCount = parsePositiveEnvNumber(process.env.CONAI_CADENCE_LOG_MIN_COUNT, DEFAULT_MIN_COUNT)

  flushHandle = setInterval(() => {
    if (buckets.size === 0) {
      return
    }

    const now = Date.now()
    const entries = [...buckets.values()]
      .filter((bucket) => bucket.count >= minCount)
      .map((bucket) => ({
        key: bucket.key,
        count: bucket.count,
        windowMs: Math.max(0, bucket.lastAt - bucket.firstAt),
        sinceLastMs: Math.max(0, now - bucket.lastAt),
        avgIntervalMs: bucket.intervalCount > 0 ? Math.round(bucket.totalIntervalMs / bucket.intervalCount) : null,
        minIntervalMs: bucket.minIntervalMs,
        maxIntervalMs: bucket.maxIntervalMs,
        lastMeta: bucket.lastMeta,
      }))
      .sort((left, right) => right.count - left.count)

    buckets.clear()

    if (entries.length === 0) {
      return
    }

    logger.debug('[CadencePerf][summary]', {
      flushIntervalMs,
      entries,
    })
  }, flushIntervalMs)
  flushHandle.unref?.()

  return true
}
