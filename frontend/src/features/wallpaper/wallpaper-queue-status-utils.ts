import type { TranslationInput, TranslationParams } from '../../i18n'
import type { GraphExecutionRecord } from '../../lib/api-module-graph'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

export interface WallpaperQueueExecutionSummary {
  queued: number
  running: number
  failed: number
  completed: number
  oldestQueuedAnchorMs: number | null
  oldestRunningAnchorMs: number | null
  latestUpdatedAt: string | null
}

function parseTimestampMs(value?: string | null) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatWallpaperQueueElapsedSeconds(value: number, t: Translate, formatNumber: FormatNumber) {
  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  if (value < 60) {
    return t({ ko: '{seconds}s', en: '{seconds}s' }, { seconds: formatNumber(Math.max(1, Math.round(value))) })
  }

  const minutes = Math.floor(value / 60)
  if (minutes < 60) {
    return t({ ko: '{minutes}m', en: '{minutes}m' }, { minutes: formatNumber(Math.max(1, minutes)) })
  }

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0
    ? t({ ko: '{hours}h {minutes}m', en: '{hours}h {minutes}m' }, { hours: formatNumber(hours), minutes: formatNumber(remainMinutes) })
    : t({ ko: '{hours}h', en: '{hours}h' }, { hours: formatNumber(hours) })
}

function pickOlderTimestampMs(current: number | null, value?: string | null) {
  const timestamp = parseTimestampMs(value)
  if (timestamp == null) {
    return current
  }

  return current == null || timestamp < current ? timestamp : current
}

/** Count queue/activity widget execution statuses in one pass for larger wallpaper dashboards. */
export function getWallpaperQueueExecutionSummary(executions: readonly GraphExecutionRecord[]): WallpaperQueueExecutionSummary {
  let queued = 0
  let running = 0
  let failed = 0
  let completed = 0
  let oldestQueuedAnchorMs: number | null = null
  let oldestRunningAnchorMs: number | null = null
  let latestUpdatedAt: string | null = null
  let latestUpdatedMs: number | null = null

  for (const execution of executions) {
    if (execution.status === 'queued') {
      queued += 1
      oldestQueuedAnchorMs = pickOlderTimestampMs(oldestQueuedAnchorMs, execution.created_date)
    } else if (execution.status === 'running') {
      running += 1
      oldestRunningAnchorMs = pickOlderTimestampMs(oldestRunningAnchorMs, execution.started_at)
    } else if (execution.status === 'failed') {
      failed += 1
    } else if (execution.status === 'completed') {
      completed += 1
    }

    const updatedMs = parseTimestampMs(execution.updated_date)
    if (updatedMs != null && (latestUpdatedMs == null || updatedMs > latestUpdatedMs)) {
      latestUpdatedMs = updatedMs
      latestUpdatedAt = execution.updated_date
    }
  }

  return {
    queued,
    running,
    failed,
    completed,
    oldestQueuedAnchorMs,
    oldestRunningAnchorMs,
    latestUpdatedAt,
  }
}

export function getWallpaperQueueAgeLabelFromAnchor(
  status: GraphExecutionRecord['status'],
  oldestAnchorMs: number | null | undefined,
  t: Translate,
  formatNumber: FormatNumber,
  nowMs = Date.now(),
) {
  if ((status !== 'queued' && status !== 'running') || oldestAnchorMs == null || oldestAnchorMs > nowMs) {
    return null
  }

  const elapsedLabel = formatWallpaperQueueElapsedSeconds((nowMs - oldestAnchorMs) / 1000, t, formatNumber)
  if (!elapsedLabel) {
    return null
  }

  return status === 'running'
    ? t({ ko: '최장 실행 {elapsedLabel}', en: 'Oldest run {elapsedLabel}' }, { elapsedLabel })
    : t({ ko: '최장 대기 {elapsedLabel}', en: 'Oldest queued {elapsedLabel}' }, { elapsedLabel })
}

/** Show oldest active workflow age in wallpaper queue-status widgets. */
export function getWallpaperQueueAgeLabel(
  executions: readonly GraphExecutionRecord[],
  status: GraphExecutionRecord['status'],
  t: Translate,
  formatNumber: FormatNumber,
  nowMs = Date.now(),
) {
  if (status !== 'queued' && status !== 'running') {
    return null
  }

  const summary = getWallpaperQueueExecutionSummary(executions)
  const oldestAnchorMs = status === 'running' ? summary.oldestRunningAnchorMs : summary.oldestQueuedAnchorMs
  return getWallpaperQueueAgeLabelFromAnchor(status, oldestAnchorMs, t, formatNumber, nowMs)
}
