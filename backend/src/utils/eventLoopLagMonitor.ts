import { logger } from './logger'

const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_THRESHOLD_MS = 500

function parsePositiveEnvNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

let monitorHandle: ReturnType<typeof setInterval> | null = null

/** Log coarse event-loop lag spikes so slow API requests can be matched to blocking work. */
export function startEventLoopLagMonitor() {
  if (monitorHandle || process.env.CONAI_EVENT_LOOP_LAG_LOGS === 'false') {
    return false
  }

  const intervalMs = parsePositiveEnvNumber(process.env.CONAI_EVENT_LOOP_LAG_INTERVAL_MS, DEFAULT_INTERVAL_MS)
  const thresholdMs = parsePositiveEnvNumber(process.env.CONAI_EVENT_LOOP_LAG_THRESHOLD_MS, DEFAULT_THRESHOLD_MS)
  let expectedAt = Date.now() + intervalMs

  monitorHandle = setInterval(() => {
    const now = Date.now()
    const lagMs = now - expectedAt
    expectedAt = now + intervalMs

    if (lagMs >= thresholdMs) {
      logger.debug('[EventLoopPerf][lag]', {
        lagMs,
        thresholdMs,
        intervalMs,
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      })
    }
  }, intervalMs)
  monitorHandle.unref?.()

  return true
}
