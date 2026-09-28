import type { GraphExecutionStatus, GraphWorkflowScheduleStatus } from '@/lib/api-module-graph'
import type { TranslationDictionary, TranslationInput, TranslationParams } from '@/i18n'

/** Format timestamps for compact execution history display. */
export function formatDateTime(value?: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const locale = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

type GraphWorkflowTranslate = (input: TranslationInput, params?: TranslationParams) => string

const GRAPH_WORKFLOW_STOP_REASON_LABELS: Partial<Record<string, TranslationDictionary>> = {
  manual_pause: { ko: '사용자가 예약작업을 일시정지했어.', en: 'The reservation was paused by a user.' },
  workflow_changed: { ko: '워크플로우가 바뀌어서 다시 시작 전에 검토가 필요해.', en: 'The workflow changed, so review it before restarting.' },
  workflow_missing: { ko: '연결된 워크플로우가 더 이상 없어.', en: 'The linked workflow no longer exists.' },
  execution_failed: { ko: '예약 실행에 실패했어.', en: 'The scheduled run failed.' },
  overlap_detected: { ko: '이전 실행이 아직 대기 중이거나 실행 중일 때 다음 예약 시점이 도착했어.', en: 'The next scheduled run arrived while a previous run was still queued or running.' },
  max_run_count_reached: { ko: '최대 예약 횟수에 도달했어.', en: 'The maximum number of scheduled runs was reached.' },
  one_time_consumed: { ko: '1회 실행 예약이 이미 사용됐어.', en: 'This one-time reservation has already run.' },
}

const GRAPH_WORKFLOW_ERROR_MESSAGE_LABELS: Record<string, TranslationDictionary> = {
  'Workflow changed and schedule review is required before restart.': GRAPH_WORKFLOW_STOP_REASON_LABELS.workflow_changed!,
  'Linked workflow no longer exists.': GRAPH_WORKFLOW_STOP_REASON_LABELS.workflow_missing!,
  'Scheduled execution failed.': GRAPH_WORKFLOW_STOP_REASON_LABELS.execution_failed!,
  'The next scheduled run arrived while a prior run was still queued or running.': GRAPH_WORKFLOW_STOP_REASON_LABELS.overlap_detected!,
  'Maximum scheduled run count has been reserved or completed.': GRAPH_WORKFLOW_STOP_REASON_LABELS.max_run_count_reached!,
  'One-time schedule has been consumed.': GRAPH_WORKFLOW_STOP_REASON_LABELS.one_time_consumed!,
  'Schedule paused by user.': GRAPH_WORKFLOW_STOP_REASON_LABELS.manual_pause!,
  'Schedule paused.': { ko: '예약작업이 일시정지 상태야.', en: 'The reservation is paused.' },
  'Schedule created in paused state.': { ko: '예약작업이 일시정지 상태로 생성됐어.', en: 'The reservation was created in a paused state.' },
  'Queue job cancelled before ComfyUI output handoff completed': { ko: '취소 요청 뒤에 ComfyUI 결과 전달이 끝나기 전에 작업이 정리됐어.', en: 'The job was cancelled before ComfyUI finished handing off its output.' },
}

function looksMostlyEnglishMessage(value: string) {
  return /[A-Za-z]/.test(value) && !/[가-힣]/.test(value)
}

/** Detect the Korean UI through the translator itself so helpers stay hook-free. */
function isKoreanTranslator(t: GraphWorkflowTranslate) {
  return t({ ko: 'ko', en: 'en' }) === 'ko'
}

/** Resolve one localized label for graph workflow schedule status badges. */
export function getGraphWorkflowScheduleStatusLabel(status: GraphWorkflowScheduleStatus, t: GraphWorkflowTranslate) {
  if (status === 'active') {
    return t({ ko: '활성', en: 'Active' })
  }
  if (status === 'paused') {
    return t({ ko: '일시정지', en: 'Paused' })
  }
  if (status === 'error_stopped') {
    return t({ ko: '오류로 중지', en: 'Stopped by error' })
  }
  if (status === 'overlap_stopped') {
    return t({ ko: '중복으로 중지', en: 'Stopped by overlap' })
  }
  return t({ ko: '완료', en: 'Completed' })
}

/** Resolve one localized label for graph execution status badges. */
export function getGraphExecutionStatusLabel(status: GraphExecutionStatus, t: GraphWorkflowTranslate) {
  if (status === 'draft') {
    return t({ ko: '초안', en: 'Draft' })
  }
  if (status === 'queued') {
    return t({ ko: '대기 중', en: 'Queued' })
  }
  if (status === 'running') {
    return t({ ko: '실행 중', en: 'Running' })
  }
  if (status === 'completed') {
    return t({ ko: '완료', en: 'Completed' })
  }
  if (status === 'failed') {
    return t({ ko: '실패', en: 'Failed' })
  }
  return t({ ko: '취소됨', en: 'Cancelled' })
}

/**
 * Localize one graph workflow error string when the source is a known backend message.
 * Unknown English backend messages collapse to the fallback only in the Korean UI.
 */
export function localizeGraphWorkflowErrorMessage(message: string | null | undefined, t: GraphWorkflowTranslate, fallback?: string) {
  const trimmedMessage = typeof message === 'string' ? message.trim() : ''
  if (!trimmedMessage) {
    return null
  }

  const exactLabel = GRAPH_WORKFLOW_ERROR_MESSAGE_LABELS[trimmedMessage]
  if (exactLabel) {
    return t(exactLabel)
  }

  const resolvedFallback = fallback ?? t({ ko: '오류가 발생했어.', en: 'An error occurred.' })
  if (looksMostlyEnglishMessage(trimmedMessage) && isKoreanTranslator(t)) {
    return resolvedFallback
  }

  return trimmedMessage
}

/** Resolve one localized stop reason for workflow reservations, preferring stable reason codes. */
export function getGraphWorkflowStopReasonLabel(stopReasonCode: string | null | undefined, stopReasonMessage: string | null | undefined, t: GraphWorkflowTranslate) {
  const reasonLabel = stopReasonCode ? GRAPH_WORKFLOW_STOP_REASON_LABELS[stopReasonCode] : undefined
  if (reasonLabel) {
    if (stopReasonCode === 'execution_failed' && stopReasonMessage) {
      return localizeGraphWorkflowErrorMessage(stopReasonMessage, t, t(reasonLabel))
    }

    return t(reasonLabel)
  }

  return localizeGraphWorkflowErrorMessage(stopReasonMessage, t, t({ ko: '예약작업이 중지됐어.', en: 'The reservation stopped.' }))
}
