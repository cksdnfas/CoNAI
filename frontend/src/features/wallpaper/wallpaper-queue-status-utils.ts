import type { TranslationInput, TranslationParams } from '../../i18n'
import type { GraphExecutionRecord } from '../../lib/api-module-graph'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

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
