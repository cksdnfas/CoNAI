import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Archive, Folder, GitCompareArrows, History, PenSquare, RotateCcw, TimerReset, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import { getGraphWorkflowRuntimeHealth, getGraphWorkflowSchedules, getGraphWorkflowVersionSummaries, type GraphExecutionArtifactRecord, type GraphExecutionFinalResultRecord, type GraphExecutionLogRecord, type GraphExecutionNodeIoRecord, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowRecord, type GraphWorkflowRuntimeHealthRecord, type GraphWorkflowVersionSummaryRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import { buildWorkflowRuntimeDecisionCues, buildWorkflowRuntimeObservabilityTrends, buildWorkflowRuntimeRunbookEvidence, buildWorkflowRuntimeThresholdGuidance, type WorkflowRuntimeDecisionCue, type WorkflowRuntimeObservabilityTrend, type WorkflowRuntimeRunbookEvidence, type WorkflowRuntimeThresholdGuidance } from '../workflow-runtime-observability'
import type { SavedGraphWorkflowSummary } from '../saved-graph-list-summary'
import { buildExecutionComparisonSummary, buildNodeDisplayLabelMap, formatPrimitiveValue, getExecutionInputEntries, getNodeDisplayLabelFromMap, parseExecutionPlan, type ExecutionInputEntry } from './graph-execution-panel-helpers'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'
import { buildFinalResultLifecycleWarningSourceLabel, listFinalResultLifecycleWarnings } from './workflow-execution-log-alerts'
import { WorkflowInputFields } from './workflow-input-fields'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestExecutionArtifacts?: GraphExecutionArtifactRecord[] | null
  latestExecutionFinalResults?: GraphExecutionFinalResultRecord[] | null
  latestExecutionLogs?: GraphExecutionLogRecord[] | null
  latestExecutionNodeIo?: GraphExecutionNodeIoRecord[] | null
  latestExecutionDetailIsLoading?: boolean
  latestExecutionDetailError?: string | null
  graphSummary?: SavedGraphWorkflowSummary | null
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecute: () => void
  onEdit: () => void
  onDeleteWorkflow?: () => void
  onOpenFolderSettings?: () => void
  canExecute?: boolean
  validationIssues?: WorkflowValidationIssue[]
  onValidationIssueSelect?: (issue: WorkflowValidationIssue) => void
  showHeader?: boolean
}

type RuntimeInputDiffStatus = 'added' | 'changed' | 'removed' | 'unchanged'

type RuntimeInputDiffEntry = {
  key: string
  label: string
  previousValue: unknown
  currentValue: unknown
  status: RuntimeInputDiffStatus
}

function stringifyComparableValue(value: unknown) {
  if (value === undefined) {
    return '__undefined__'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildWorkflowRuntimeInputDiffEntries({
  inputDefinitions,
  inputValues,
  previousEntries,
}: {
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  previousEntries: ExecutionInputEntry[]
}) {
  const currentKeys = inputDefinitions
    .map((inputDefinition) => inputDefinition.id)
    .filter((key) => Object.prototype.hasOwnProperty.call(inputValues, key))
  const keys = Array.from(new Set([
    ...previousEntries.map((entry) => entry.key),
    ...currentKeys,
  ]))
  const labelByKey = new Map(inputDefinitions.map((inputDefinition) => [inputDefinition.id, inputDefinition.label]))
  const previousValueByKey = new Map(previousEntries.map((entry) => [entry.key, entry.value]))

  return keys.map((key): RuntimeInputDiffEntry => {
    const hasPreviousValue = previousValueByKey.has(key)
    const hasCurrentValue = Object.prototype.hasOwnProperty.call(inputValues, key)
    const previousValue = previousValueByKey.get(key)
    const currentValue = inputValues[key]
    const status: RuntimeInputDiffStatus = !hasPreviousValue && hasCurrentValue
      ? 'added'
      : hasPreviousValue && !hasCurrentValue
        ? 'removed'
        : stringifyComparableValue(previousValue) === stringifyComparableValue(currentValue)
          ? 'unchanged'
          : 'changed'

    return {
      key,
      label: labelByKey.get(key) ?? previousEntries.find((entry) => entry.key === key)?.label ?? key,
      previousValue,
      currentValue,
      status,
    }
  })
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function formatRuntimeInputDiffValue(value: unknown) {
  const text = formatPrimitiveValue(value)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

function getWorkflowRuntimeTrendToneClass(tone: WorkflowRuntimeObservabilityTrend['tone']) {
  if (tone === 'attention') {
    return 'border-amber-400/50 bg-amber-500/10'
  }

  if (tone === 'watch') {
    return 'border-sky-400/40 bg-sky-500/10'
  }

  return 'border-emerald-400/35 bg-emerald-500/10'
}

function getWorkflowRuntimeTrendToneLabel(tone: WorkflowRuntimeObservabilityTrend['tone']) {
  if (tone === 'attention') {
    return { ko: '주의', en: 'Attention' }
  }

  if (tone === 'watch') {
    return { ko: '관찰', en: 'Watch' }
  }

  return { ko: '안정', en: 'Ready' }
}

function getWorkflowRuntimeTrendCopy(trend: WorkflowRuntimeObservabilityTrend) {
  if (trend.key === 'queue-health') {
    return {
      title: { ko: '큐 상태 추세', en: 'Queue health trend' },
      primary: { ko: '활성 {count}', en: '{count} active' },
      secondary: { ko: '프로세스 {count}', en: '{count} in process' },
      tertiary: { ko: '취소요청 {count}', en: '{count} cancel requests' },
    }
  }

  if (trend.key === 'retry-policy') {
    return {
      title: { ko: '재시도 정책 추세', en: 'Retry policy trend' },
      primary: { ko: '중지/검토 {count}', en: '{count} stopped/review' },
      secondary: { ko: '활성 예약 {count}', en: '{count} active schedules' },
      tertiary: { ko: '재점검 {count}ms', en: '{count}ms recheck' },
    }
  }

  if (trend.key === 'recovery') {
    return {
      title: { ko: '복구 이력 추세', en: 'Recovery history trend' },
      primary: { ko: '점검 {count}', en: '{count} checks' },
      secondary: { ko: '시작 대기 {count}', en: '{count} startup queued' },
      tertiary: { ko: '시작 실패 {count}', en: '{count} startup failed' },
    }
  }

  if (trend.key === 'retention') {
    return {
      title: { ko: '보존 정리 추세', en: 'Retention cleanup trend' },
      primary: { ko: '대기 {count}', en: '{count} pending' },
      secondary: { ko: '제한 {count}', en: '{count} limit' },
      tertiary: { ko: '보존 큐 {count}', en: '{count} retention queue' },
    }
  }

  return {
    title: { ko: '완료/실패 이력', en: 'Terminal run history' },
    primary: { ko: '종료 {count}', en: '{count} terminal' },
    secondary: { ko: '실패/취소 {count}', en: '{count} failed/cancelled' },
    tertiary: { ko: '실패율 {count}%', en: '{count}% failed' },
  }
}

function getWorkflowRuntimeThresholdGuidanceCopy(guidance: WorkflowRuntimeThresholdGuidance) {
  if (guidance.key === 'queue-pressure-threshold') {
    return {
      title: { ko: '큐 압력 기준', en: 'Queue pressure threshold' },
      body: { ko: '활성 작업이 동시 실행 한계를 넘거나 취소 요청이 있으면 다음 실행 전 큐 상태를 먼저 확인해.', en: 'When active work exceeds the concurrency limit or cancellation is requested, review queue state before the next run.' },
      unit: 'count' as const,
    }
  }

  if (guidance.key === 'retry-stop-threshold') {
    return {
      title: { ko: '자동 실행 중지 기준', en: 'Autorun stop threshold' },
      body: { ko: '검토 대기나 오류 중지된 예약이 있으면 재시작보다 중지 사유 확인이 먼저야.', en: 'Paused or error-stopped schedules need stop-reason review before restarting autoruns.' },
      unit: 'count' as const,
    }
  }

  if (guidance.key === 'recovery-mismatch-threshold') {
    return {
      title: { ko: '복구 불일치 기준', en: 'Recovery mismatch threshold' },
      body: { ko: '시작 복구나 실행 프로세스 불일치가 있으면 최근 실패와 산출물 상태를 함께 봐.', en: 'Startup recovery or process mismatches should be reviewed with recent failures and output state.' },
      unit: 'count' as const,
    }
  }

  if (guidance.key === 'retention-approval-threshold') {
    return {
      title: { ko: '보존 승인 기준', en: 'Retention approval threshold' },
      body: { ko: '보존 정리 대기 항목은 상태 신호로만 표시하고 삭제, schema, retention policy 변경은 별도 승인으로 남겨.', en: 'Pending retention prune items stay as state signals; deletion, schema, and retention policy changes remain separately approved.' },
      unit: 'count' as const,
    }
  }

  return {
    title: { ko: '실패율 기준', en: 'Failure rate threshold' },
    body: { ko: '실패율이 기준 이상이면 재실행 전에 오류 메시지와 입력 프리셋 차이를 같이 확인해.', en: 'When failure rate reaches the threshold, review errors and input preset diffs before rerunning.' },
    unit: 'percent' as const,
  }
}

function getWorkflowRuntimeDecisionCueCopy(cue: WorkflowRuntimeDecisionCue) {
  if (cue.key === 'queue-rerun-readiness') {
    return {
      title: { ko: '재실행 전 큐 판단', en: 'Queue before rerun' },
      primary: { ko: '활성 {count}', en: '{count} active' },
      secondary: { ko: '압력 {count}', en: '{count} pressure' },
      body: { ko: '큐 압력이나 취소 요청이 있으면 새 실행보다 대기/실행 상태 검토가 먼저야.', en: 'Queue pressure or cancellation requests make queue review the next step before a new run.' },
    }
  }

  if (cue.key === 'autorun-stop-review') {
    return {
      title: { ko: '자동 실행 중지 판단', en: 'Autorun stop review' },
      primary: { ko: '중지/검토 {count}', en: '{count} stopped/review' },
      secondary: { ko: '활성 예약 {count}', en: '{count} active schedules' },
      body: { ko: '멈춘 예약은 재시작 버튼보다 stop reason과 입력 변경 검토를 먼저 남겨.', en: 'Stopped schedules need stop-reason and input-change review before restart decisions.' },
    }
  }

  if (cue.key === 'recovery-output-review') {
    return {
      title: { ko: '복구/산출물 판단', en: 'Recovery/output review' },
      primary: { ko: '점검 {count}', en: '{count} checks' },
      secondary: { ko: '시작 대기 {count}', en: '{count} startup queued' },
      body: { ko: '복구 불일치가 있으면 최근 실패, 입력 diff, 산출물 상태를 함께 확인해.', en: 'Recovery mismatches should be reviewed with recent failures, input diffs, and output state.' },
    }
  }

  if (cue.key === 'retention-cleanup-approval') {
    return {
      title: { ko: '보존 정리 승인', en: 'Retention cleanup approval' },
      primary: { ko: '대기 {count}', en: '{count} pending' },
      secondary: { ko: '제한 {count}', en: '{count} limit' },
      body: { ko: '보존 정리 신호는 표시만 하고 삭제, schema, retention policy 변경은 별도 승인으로 남겨.', en: 'Retention cleanup is display-only here; deletion, schema, and policy changes stay separately approved.' },
    }
  }

  return {
    title: { ko: '오류 이력 판단', en: 'Error history review' },
    primary: { ko: '실패율 {count}%', en: '{count}% failed' },
    secondary: { ko: '실패/취소 {count}', en: '{count} failed/cancelled' },
    body: { ko: '실패율이나 취소 이력이 있으면 즉시 재실행 대신 오류 메시지와 프리셋 차이를 먼저 봐.', en: 'Failure or cancellation history should lead to error and preset-diff review before rerun.' },
  }
}

function getWorkflowRuntimeDecisionCueActionLabel(action: WorkflowRuntimeDecisionCue['action']) {
  if (action === 'approval-required') {
    return { ko: '승인 필요', en: 'Approval required' }
  }

  if (action === 'review-before-rerun') {
    return { ko: '재실행 전 검토', en: 'Review before rerun' }
  }

  return { ko: '관찰 가능', en: 'Safe to observe' }
}

function getWorkflowRuntimeRunbookEvidenceCopy(evidence: WorkflowRuntimeRunbookEvidence) {
  if (evidence.key === 'rerun-readiness-evidence') {
    return {
      title: { ko: '재실행 증거', en: 'Rerun readiness evidence' },
      body: { ko: '큐 압력, 중지된 예약, 복구 불일치, 실패/취소 이력을 모아 즉시 재실행 대신 검토 순서를 남겨.', en: 'Collect queue pressure, stopped schedules, recovery mismatches, and failed/cancelled history before deciding on reruns.' },
    }
  }

  if (evidence.key === 'rollback-handoff-evidence') {
    return {
      title: { ko: '롤백 인계 증거', en: 'Rollback handoff evidence' },
      body: { ko: '복구/실패/보존 정리 신호는 롤백 후보와 서비스 재시작 승인 여부를 분리해서 인계해.', en: 'Recovery, failure, and retention signals are handed off separately from rollback and service restart approval.' },
    }
  }

  return {
    title: { ko: '중단 조건 증거', en: 'Stop condition evidence' },
    body: { ko: '검토/중지된 자동 실행, 취소 요청, 최근 실패가 있으면 예약 재개보다 stop reason 기록을 먼저 확인해.', en: 'Paused/stopped autoruns, cancellation requests, and recent failures require stop-reason review before resuming schedules.' },
  }
}

function WorkflowVersionReviewBlock({
  selectedGraph,
  latestExecution,
  versionSummaries,
  versionQueryIsError,
  runtimeInputDiffEntries,
}: {
  selectedGraph: GraphWorkflowRecord
  latestExecution?: GraphExecutionRecord | null
  versionSummaries: GraphWorkflowVersionSummaryRecord[]
  versionQueryIsError: boolean
  runtimeInputDiffEntries: RuntimeInputDiffEntry[]
}) {
  const { t, formatNumber, formatDateTime } = useI18n()
  const latestVersion = versionSummaries[0] ?? null
  const visibleVersionSummaries = versionSummaries.slice(0, 3)
  const changedInputEntries = runtimeInputDiffEntries.filter((entry) => entry.status !== 'unchanged')
  const visibleChangedInputEntries = changedInputEntries.slice(0, 3)
  const hiddenChangedInputCount = Math.max(0, changedInputEntries.length - visibleChangedInputEntries.length)
  const latestExecutionVersion = latestExecution?.graph_version ?? null
  const latestRunUsesCurrentGraphVersion = latestExecutionVersion === null || latestExecutionVersion === selectedGraph.version

  return (
    <div className="space-y-3 rounded-sm border border-border bg-background/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-primary" />
            <span>{t({ ko: '버전 검토', en: 'Version review' })}</span>
            <Badge variant="outline">v{selectedGraph.version}</Badge>
            {latestExecutionVersion !== null ? (
              <Badge variant={latestRunUsesCurrentGraphVersion ? 'secondary' : 'outline'}>
                {t({ ko: '최근 실행 v{version}', en: 'Latest run v{version}' }, { version: latestExecutionVersion })}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {latestRunUsesCurrentGraphVersion
              ? t({ ko: '최근 실행과 현재 저장본의 그래프 버전이 같아.', en: 'The latest run and current saved graph version match.' })
              : t({ ko: '최근 실행은 이전 그래프 버전이야. 재실행 전에 변경 내용을 확인해줘.', en: 'The latest run used an older graph version. Review changes before rerunning.' })}
          </div>
        </div>

        {latestVersion ? (
          <div className="flex flex-wrap justify-end gap-1.5 text-[11px]">
            <Badge variant="outline">N {formatNumber(latestVersion.node_count)} ({formatDelta(latestVersion.node_delta)})</Badge>
            <Badge variant="outline">E {formatNumber(latestVersion.edge_count)} ({formatDelta(latestVersion.edge_delta)})</Badge>
            <Badge variant="outline">{t({ ko: '입력 {count}', en: 'Inputs {count}' }, { count: formatNumber(latestVersion.exposed_input_count) })} ({formatDelta(latestVersion.exposed_input_delta)})</Badge>
            {latestVersion.debug_mode ? <Badge variant="outline">{t({ ko: '디버그', en: 'Debug' })}</Badge> : null}
          </div>
        ) : null}
      </div>

      {versionQueryIsError ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          {t({ ko: '버전 이력을 불러오지 못했어.', en: 'Could not load version history.' })}
        </div>
      ) : visibleVersionSummaries.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {visibleVersionSummaries.map((version) => (
            <span key={version.id} className="inline-flex min-h-7 items-center gap-1 rounded-sm border border-border bg-surface-low px-2 py-1">
              <span className="font-medium text-foreground">v{version.version}</span>
              <span>{formatDateTime(version.created_date)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          {t({ ko: '저장된 버전 스냅샷이 아직 없어.', en: 'No saved version snapshots yet.' })}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <GitCompareArrows className="h-3.5 w-3.5" />
          <span>{t({ ko: '입력 프리셋 차이', en: 'Input preset diff' })}</span>
          <Badge variant={changedInputEntries.length > 0 ? 'outline' : 'secondary'}>{t({ ko: '변경 {count}', en: 'Changed {count}' }, { count: formatNumber(changedInputEntries.length) })}</Badge>
        </div>

        {!latestExecution ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {t({ ko: '최근 실행이 없어서 비교할 입력 프리셋이 없어.', en: 'There is no latest run to compare input presets against.' })}
          </div>
        ) : visibleChangedInputEntries.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {t({ ko: '현재 입력과 최근 실행 입력이 같아.', en: 'Current inputs match the latest run inputs.' })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleChangedInputEntries.map((entry) => (
              <div key={entry.key} className="rounded-sm border border-border bg-background/45 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">
                    {entry.status === 'added'
                      ? t({ ko: '추가', en: 'Added' })
                      : entry.status === 'removed'
                        ? t({ ko: '제거', en: 'Removed' })
                        : t({ ko: '변경', en: 'Changed' })}
                  </Badge>
                  <span className="font-medium text-foreground">{entry.label}</span>
                </div>
                <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  <div className="break-all">{t({ ko: '이전: {value}', en: 'Previous: {value}' }, { value: formatRuntimeInputDiffValue(entry.previousValue) })}</div>
                  <div className="break-all">{t({ ko: '현재: {value}', en: 'Current: {value}' }, { value: formatRuntimeInputDiffValue(entry.currentValue) })}</div>
                </div>
              </div>
            ))}
            {hiddenChangedInputCount > 0 ? (
              <div className="text-xs text-muted-foreground">
                {t({ ko: '추가 입력 차이 {count}개가 더 있어.', en: '{count} more input diffs are available.' }, { count: formatNumber(hiddenChangedInputCount) })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowRuntimeHealthBlock({
  runtimeHealth,
  runtimeHealthIsError,
}: {
  runtimeHealth?: GraphWorkflowRuntimeHealthRecord | null
  runtimeHealthIsError: boolean
}) {
  const { t, formatNumber, formatDateTime } = useI18n()

  if (runtimeHealthIsError) {
    return (
      <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        {t({ ko: '런타임 상태를 불러오지 못했어.', en: 'Could not load runtime health.' })}
      </div>
    )
  }

  if (!runtimeHealth) {
    return null
  }

  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running + runtimeHealth.recovery.running_not_in_process_count
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const latestErrorMessage = localizeGraphWorkflowErrorMessage(
    runtimeHealth.telemetry.latest_error_message,
    t({ ko: '최근 실행 오류가 있어.', en: 'A recent run failed.' }),
  )
  const queueMessage = activeQueueCount > 0
    ? runtimeHealth.queue.oldest_queued_at
      ? t({ ko: '가장 오래된 대기 작업 {time}', en: 'Oldest queued job {time}' }, { time: formatDateTime(runtimeHealth.queue.oldest_queued_at) })
      : t({ ko: '활성 실행이 큐에서 처리 중이야.', en: 'Active runs are being processed by the queue.' })
    : t({ ko: '현재 대기 또는 실행 중인 작업이 없어.', en: 'No queued or running jobs right now.' })
  const retryMessage = runtimeHealth.queue.retry_timer_pending
    ? t({ ko: '{ms}ms 재점검 타이머가 대기 중이야.', en: '{ms}ms queue recheck timer is pending.' }, { ms: formatNumber(runtimeHealth.queue.queue_recheck_interval_ms) })
    : t({ ko: '즉시 처리 가능한 큐 재시도 타이머는 없어.', en: 'No queue retry timer is pending.' })
  const retentionMessage = runtimeHealth.retention.pending_prune
    ? t({ ko: '보존 정리 요청이 대기 중이야.', en: 'A retention prune request is pending.' })
    : t({ ko: '보존 정리 요청은 대기 중이 아니야.', en: 'No retention prune request is pending.' })
  const recoveryMessage = recoveryConcernCount > 0
    ? t({ ko: '복구 점검 대상 {count}개가 있어.', en: '{count} recovery checks need review.' }, { count: formatNumber(recoveryConcernCount) })
    : runtimeHealth.recovery.last_startup_recovery_at
      ? t({ ko: '최근 시작 복구 {time}', en: 'Last startup recovery {time}' }, { time: formatDateTime(runtimeHealth.recovery.last_startup_recovery_at) })
      : t({ ko: '시작 복구 기록은 아직 없어.', en: 'No startup recovery snapshot yet.' })
  const observabilityTrends = buildWorkflowRuntimeObservabilityTrends(runtimeHealth)
  const thresholdGuidance = buildWorkflowRuntimeThresholdGuidance(runtimeHealth)
  const decisionCues = buildWorkflowRuntimeDecisionCues(runtimeHealth)
  const runbookEvidence = buildWorkflowRuntimeRunbookEvidence(runtimeHealth)

  return (
    <div className="space-y-3 rounded-sm border border-border bg-background/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 text-primary" />
            <span>{t({ ko: '런타임 상태', en: 'Runtime health' })}</span>
            <Badge variant={activeQueueCount > 0 ? 'outline' : 'secondary'}>{t({ ko: '활성 {count}', en: 'Active {count}' }, { count: formatNumber(activeQueueCount) })}</Badge>
            {recoveryConcernCount > 0 ? <Badge variant="outline">{t({ ko: '복구 {count}', en: 'Recovery {count}' }, { count: formatNumber(recoveryConcernCount) })}</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{queueMessage}</div>
        </div>

        <div className="flex flex-wrap justify-end gap-1.5 text-[11px]">
          <Badge variant="outline">{t({ ko: '대기 {count}', en: 'Queued {count}' }, { count: formatNumber(runtimeHealth.queue.queued_count) })}</Badge>
          <Badge variant="outline">{t({ ko: '실행 {count}', en: 'Running {count}' }, { count: formatNumber(runtimeHealth.queue.running_count) })}</Badge>
          <Badge variant="outline">{t({ ko: '동시예약 {count}', en: 'Schedule cap {count}' }, { count: formatNumber(runtimeHealth.queue.schedule_concurrency_limit) })}</Badge>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-sm border border-border bg-background/45 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
            <TimerReset className="h-3.5 w-3.5 text-primary" />
            <span>{t({ ko: '큐와 재시도', en: 'Queue and retry' })}</span>
          </div>
          <div className="mt-1.5 text-muted-foreground">
            {t({ ko: '수동 {manualQueued}/{manualRunning} · 예약 {scheduleQueued}/{scheduleRunning}', en: 'Manual {manualQueued}/{manualRunning} · Scheduled {scheduleQueued}/{scheduleRunning}' }, {
              manualQueued: formatNumber(runtimeHealth.queue.manual_queued_count),
              manualRunning: formatNumber(runtimeHealth.queue.manual_running_count),
              scheduleQueued: formatNumber(runtimeHealth.queue.schedule_queued_count),
              scheduleRunning: formatNumber(runtimeHealth.queue.schedule_running_count),
            })}
          </div>
          <div className="mt-1 text-muted-foreground">{retryMessage}</div>
        </div>

        <div className="rounded-sm border border-border bg-background/45 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
            <RotateCcw className="h-3.5 w-3.5 text-primary" />
            <span>{t({ ko: '복구 텔레메트리', en: 'Recovery telemetry' })}</span>
          </div>
          <div className="mt-1.5 text-muted-foreground">{recoveryMessage}</div>
          <div className="mt-1 text-muted-foreground">
            {t({ ko: '완료 {completed} · 실패 {failed} · 취소 {cancelled}', en: 'Completed {completed} · Failed {failed} · Cancelled {cancelled}' }, {
              completed: formatNumber(runtimeHealth.telemetry.completed_count),
              failed: formatNumber(runtimeHealth.telemetry.failed_count),
              cancelled: formatNumber(runtimeHealth.telemetry.cancelled_count),
            })}
          </div>
          {latestErrorMessage ? <div className="mt-1 break-words text-amber-700 dark:text-amber-300">{latestErrorMessage}</div> : null}
        </div>

        <div className="rounded-sm border border-border bg-background/45 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
            <Archive className="h-3.5 w-3.5 text-primary" />
            <span>{t({ ko: '산출물 보존', en: 'Artifact retention' })}</span>
          </div>
          <div className="mt-1.5 text-muted-foreground">
            {t({ ko: '워크플로우당 최근 {count}개 보존', en: 'Keep latest {count} outputs per workflow' }, { count: formatNumber(runtimeHealth.retention.output_retention_limit) })}
          </div>
          <div className="mt-1 text-muted-foreground">{retentionMessage}</div>
        </div>

        <div className="rounded-sm border border-border bg-background/45 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
            <History className="h-3.5 w-3.5 text-primary" />
            <span>{t({ ko: '자동 실행 정책', en: 'Autorun policy' })}</span>
          </div>
          <div className="mt-1.5 text-muted-foreground">
            {t({ ko: '활성 {active}/{total} · 실패 시 중지 {stop} · 계속 {continueCount}', en: 'Active {active}/{total} · Stop {stop} · Continue {continueCount}' }, {
              active: formatNumber(runtimeHealth.retry_policy.active_schedule_count),
              total: formatNumber(runtimeHealth.retry_policy.schedule_count),
              stop: formatNumber(runtimeHealth.retry_policy.stop_on_failure_count),
              continueCount: formatNumber(runtimeHealth.retry_policy.continue_on_failure_count),
            })}
          </div>
          {stoppedScheduleCount > 0 ? (
            <div className="mt-1 text-amber-700 dark:text-amber-300">
              {t({ ko: '검토/중지된 자동 실행 {count}개', en: '{count} autoruns are paused or stopped.' }, { count: formatNumber(stoppedScheduleCount) })}
            </div>
          ) : (
            <div className="mt-1 text-muted-foreground">{t({ ko: '검토/중지된 자동 실행은 없어.', en: 'No autoruns are paused or stopped for review.' })}</div>
          )}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-5" data-workflow-runtime-observability-trends="true">
        {observabilityTrends.map((trend) => {
          const copy = getWorkflowRuntimeTrendCopy(trend)
          return (
            <div
              key={trend.key}
              className={`min-h-[8rem] rounded-sm border px-3 py-2 text-xs ${getWorkflowRuntimeTrendToneClass(trend.tone)}`}
              data-workflow-runtime-trend={trend.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{t(copy.title)}</div>
                <Badge variant="outline">{t(getWorkflowRuntimeTrendToneLabel(trend.tone))}</Badge>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <span>{t(copy.primary, { count: formatNumber(trend.primaryCount) })}</span>
                <span>{t(copy.secondary, { count: formatNumber(trend.secondaryCount) })}</span>
                <span>{t(copy.tertiary, { count: formatNumber(trend.tertiaryCount) })}</span>
              </div>
              {trend.timestamp ? (
                <div className="mt-2 text-muted-foreground">{formatDateTime(trend.timestamp)}</div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="grid gap-2 lg:grid-cols-5" data-workflow-runtime-threshold-guidance="true">
        {thresholdGuidance.map((guidance) => {
          const copy = getWorkflowRuntimeThresholdGuidanceCopy(guidance)
          return (
            <div
              key={guidance.key}
              className={`min-h-[8rem] rounded-sm border px-3 py-2 text-xs ${getWorkflowRuntimeTrendToneClass(guidance.tone)}`}
              data-workflow-runtime-threshold={guidance.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{t(copy.title)}</div>
                <Badge variant="outline">{t(getWorkflowRuntimeTrendToneLabel(guidance.tone))}</Badge>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <span>
                  {copy.unit === 'percent'
                    ? t({ ko: '현재 {count}%', en: '{count}% current' }, { count: formatNumber(guidance.currentCount) })
                    : t({ ko: '현재 {count}', en: '{count} current' }, { count: formatNumber(guidance.currentCount) })}
                </span>
                <span>
                  {copy.unit === 'percent'
                    ? t({ ko: '기준 {count}%', en: '{count}% threshold' }, { count: formatNumber(guidance.thresholdCount) })
                    : t({ ko: '기준 {count}', en: '{count} threshold' }, { count: formatNumber(guidance.thresholdCount) })}
                </span>
                <span>
                  {guidance.approvalBoundary === 'approval-required'
                    ? t({ ko: '별도 승인 필요', en: 'Separate approval required' })
                    : t({ ko: '운영자 검토', en: 'Operator review' })}
                </span>
              </div>
              <div className="mt-2 text-muted-foreground">{t(copy.body)}</div>
              {guidance.timestamp ? (
                <div className="mt-2 text-muted-foreground">{formatDateTime(guidance.timestamp)}</div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="grid gap-2 lg:grid-cols-5" data-workflow-runtime-decision-surface="true">
        {decisionCues.map((cue) => {
          const copy = getWorkflowRuntimeDecisionCueCopy(cue)
          return (
            <div
              key={cue.key}
              className={`min-h-[8rem] rounded-sm border px-3 py-2 text-xs ${getWorkflowRuntimeTrendToneClass(cue.tone)}`}
              data-workflow-runtime-decision-cue={cue.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{t(copy.title)}</div>
                <Badge variant="outline">{t(getWorkflowRuntimeDecisionCueActionLabel(cue.action))}</Badge>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <span>{t(copy.primary, { count: formatNumber(cue.primaryCount) })}</span>
                <span>{t(copy.secondary, { count: formatNumber(cue.secondaryCount) })}</span>
                <span>
                  {cue.approvalBoundary === 'approval-required'
                    ? t({ ko: '사용자 승인 경계', en: 'User approval boundary' })
                    : t({ ko: '운영자 검토 경계', en: 'Operator review boundary' })}
                </span>
              </div>
              <div className="mt-2 text-muted-foreground">{t(copy.body)}</div>
              {cue.timestamp ? (
                <div className="mt-2 text-muted-foreground">{formatDateTime(cue.timestamp)}</div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="grid gap-2 lg:grid-cols-3" data-workflow-runtime-runbook-evidence="true">
        {runbookEvidence.map((evidence) => {
          const copy = getWorkflowRuntimeRunbookEvidenceCopy(evidence)
          return (
            <div
              key={evidence.key}
              className={`min-h-[8rem] rounded-sm border px-3 py-2 text-xs ${getWorkflowRuntimeTrendToneClass(evidence.tone)}`}
              data-workflow-runtime-runbook-evidence-card={evidence.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{t(copy.title)}</div>
                <Badge variant="outline">{t(getWorkflowRuntimeDecisionCueActionLabel(evidence.action))}</Badge>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <span>{t({ ko: '증거 {count}', en: '{count} evidence signals' }, { count: formatNumber(evidence.evidenceCount) })}</span>
                <span>{t({ ko: '가드레일 {count}', en: '{count} guardrails' }, { count: formatNumber(evidence.guardrailCount) })}</span>
                <span>
                  {evidence.approvalBoundary === 'approval-required'
                    ? t({ ko: '승인 후 실행', en: 'Execute only after approval' })
                    : t({ ko: '로컬 검토만', en: 'Local review only' })}
                </span>
              </div>
              <div className="mt-2 text-muted-foreground">{t(copy.body)}</div>
              {evidence.timestamp ? (
                <div className="mt-2 text-muted-foreground">{formatDateTime(evidence.timestamp)}</div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Render workflow-level runtime inputs so users can run saved workflows without opening the graph editor. */
export function WorkflowRunnerPanel({
  selectedGraph,
  inputDefinitions,
  inputValues,
  isExecuting,
  latestExecution,
  latestExecutionArtifacts,
  latestExecutionFinalResults,
  latestExecutionLogs,
  latestExecutionNodeIo,
  latestExecutionDetailIsLoading = false,
  latestExecutionDetailError = null,
  graphSummary,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onEdit,
  onDeleteWorkflow,
  onOpenFolderSettings,
  canExecute = true,
  validationIssues = [],
  onValidationIssueSelect,
  showHeader = true,
}: WorkflowRunnerPanelProps) {
  const { t, formatNumber } = useI18n()
  const scheduleQuery = useQuery({
    queryKey: ['module-graph-workflow-schedules', selectedGraph?.id ?? null],
    queryFn: () => getGraphWorkflowSchedules({ workflowId: selectedGraph?.id ?? null }),
    enabled: selectedGraph !== null,
    staleTime: 10_000,
  })
  const versionQuery = useQuery({
    queryKey: ['module-graph-workflow-versions', selectedGraph?.id ?? null],
    queryFn: () => getGraphWorkflowVersionSummaries(selectedGraph?.id as number),
    enabled: selectedGraph !== null,
    staleTime: 30_000,
  })
  const runtimeHealthQuery = useQuery({
    queryKey: ['module-graph-workflow-runtime-health', selectedGraph?.id ?? null],
    queryFn: () => getGraphWorkflowRuntimeHealth(selectedGraph?.id as number),
    enabled: selectedGraph !== null,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const runtimeHealth = query.state.data
      return runtimeHealth && (runtimeHealth.queue.queued_count > 0 || runtimeHealth.queue.running_count > 0 || runtimeHealth.retention.pending_prune)
        ? 5_000
        : false
    },
  })

  const reviewRequiredSchedules = useMemo(
    () => (scheduleQuery.data ?? []).filter((schedule) => schedule.stop_reason_code === 'workflow_changed'),
    [scheduleQuery.data],
  )
  const graphSummaryLine = graphSummary
    ? [
        t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(graphSummary.nodeCount) }),
        t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(graphSummary.edgeCount) }),
        t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(graphSummary.finalResultNodeCount) }),
      ].join(' · ')
    : null
  const latestExecutionStatus = latestExecution?.status ?? null
  const latestExecutionStatusLabel = latestExecutionStatus ? getGraphExecutionStatusLabel(latestExecutionStatus) : null
  const shouldShowLatestExecutionResults = latestExecution?.status === 'completed'
  const latestExecutionFinalResultWarnings = useMemo(() => listFinalResultLifecycleWarnings(latestExecutionLogs), [latestExecutionLogs])
  const latestExecutionFinalResultWarning = latestExecutionFinalResultWarnings[0] ?? null
  const latestExecutionAdditionalWarningCount = Math.max(0, latestExecutionFinalResultWarnings.length - 1)
  const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])
  const latestExecutionFinalResultWarningSourceLabel = latestExecutionFinalResultWarning?.sourceNodeId
    ? buildFinalResultLifecycleWarningSourceLabel(
      latestExecutionFinalResultWarning,
      getNodeDisplayLabelFromMap(nodeLabelMap, latestExecutionFinalResultWarning.sourceNodeId),
    )
    : buildFinalResultLifecycleWarningSourceLabel(latestExecutionFinalResultWarning)
  const latestExecutionInputEntries = useMemo(
    () => getExecutionInputEntries(parseExecutionPlan(latestExecution?.execution_plan), inputDefinitions),
    [inputDefinitions, latestExecution?.execution_plan],
  )
  const runtimeInputDiffEntries = useMemo(
    () => buildWorkflowRuntimeInputDiffEntries({
      inputDefinitions,
      inputValues,
      previousEntries: latestExecutionInputEntries,
    }),
    [inputDefinitions, inputValues, latestExecutionInputEntries],
  )
  const latestExecutionComparisonSummary = useMemo(() => buildExecutionComparisonSummary({
    inputEntries: latestExecutionInputEntries,
    artifacts: latestExecutionArtifacts ?? [],
    finalResults: latestExecutionFinalResults ?? [],
    logs: latestExecutionLogs ?? [],
    nodeIo: latestExecutionNodeIo ?? [],
  }), [latestExecutionArtifacts, latestExecutionFinalResults, latestExecutionInputEntries, latestExecutionLogs, latestExecutionNodeIo])
  const latestExecutionArtifactCount = shouldShowLatestExecutionResults && latestExecutionArtifacts ? latestExecutionArtifacts.length : null
  const latestExecutionEmptyResultLabel = graphSummary && graphSummary.finalResultNodeCount > 0
    ? latestExecutionArtifactCount && latestExecutionArtifactCount > 0
      ? t({
        ko: '원본 산출물 {count}개는 있지만 최종 결과로 확정된 출력은 없어. 최종 결과 노드가 원하는 출력 포트에 연결됐는지 확인해줘.',
        en: 'Final result nodes exist and {count} source artifacts were created, but this run did not finalize any outputs. Check whether the final result node is connected to the intended output port.',
      }, { count: formatNumber(latestExecutionArtifactCount) })
      : t({
        ko: '최종 결과 노드는 있지만 이번 실행에서 확정된 출력이 없어. 연결된 출력 노드가 실제 결과를 만들었는지 확인해줘.',
        en: 'Final result nodes exist, but this run did not finalize any outputs. Check whether the connected output node produced a result.',
      })
    : t({
      ko: '아직 선언된 최종 결과가 없어. 최종 결과 노드를 추가하고 원하는 출력에 연결해줘.',
      en: 'No final result is declared yet. Add a final result node and connect it to the output you want.',
    })
  const latestExecutionPendingMessage = latestExecution
    ? latestExecution.status === 'queued'
      ? t({ ko: '큐에서 대기 중이라 아직 결과물이 없어.', en: 'This run is queued, so results are not ready yet.' })
      : latestExecution.status === 'running'
        ? t({ ko: '실행 중이라 완료 후 결과물이 표시돼.', en: 'This run is still running; results will appear after it completes.' })
        : latestExecution.status === 'failed'
          ? localizeGraphWorkflowErrorMessage(latestExecution.error_message, t({ ko: '실행에 실패해서 결과물이 없어.', en: 'This run failed, so there are no results to show.' }))
            ?? t({ ko: '실행에 실패해서 결과물이 없어.', en: 'This run failed, so there are no results to show.' })
          : latestExecution.status === 'cancelled'
            ? t({ ko: '취소된 실행이라 결과물이 없어.', en: 'This run was cancelled, so there are no results to show.' })
            : latestExecution.status === 'draft'
              ? t({ ko: '아직 실행되지 않은 기록이야.', en: 'This run has not started yet.' })
              : null
    : null
  const latestExecutionResultCountLabel = shouldShowLatestExecutionResults && latestExecutionFinalResults
    ? t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(latestExecutionFinalResults.length) })
    : null
  const latestExecutionArtifactCountLabel = latestExecutionArtifactCount !== null
    ? t({ ko: '원본 {count}', en: 'Source {count}' }, { count: formatNumber(latestExecutionArtifactCount) })
    : null
  const latestExecutionDetailLoadMessage = latestExecutionDetailError
    ?? (latestExecutionDetailIsLoading ? t({ ko: '최종 결과를 불러오는 중...', en: 'Loading final results...' }) : t({ ko: '최종 결과 정보를 불러오지 못했어.', en: 'Could not load final result details.' }))
  const blockingIssueCount = validationIssues.filter((issue) => issue.severity === 'error').length
  const warningIssueCount = validationIssues.filter((issue) => issue.severity === 'warning').length
  const firstBlockingIssue = validationIssues.find((issue) => issue.severity === 'error') ?? null
  const runReadinessMessage = !selectedGraph
    ? t({ ko: '워크플로우를 먼저 선택해야 해.', en: 'Select a workflow first.' })
    : isExecuting
      ? t({ ko: '실행 요청을 보내는 중이야.', en: 'A run request is being sent.' })
      : !canExecute
        ? firstBlockingIssue
          ? t({ ko: '{title}부터 정리하면 실행할 수 있어.', en: 'Resolve {title} first, then run.' }, { title: firstBlockingIssue.title })
          : t({ ko: '치명 검증 이슈를 먼저 정리해야 해.', en: 'Resolve the critical validation issues first.' })
        : warningIssueCount > 0
          ? t({ ko: '실행은 가능하지만 경고 {count}개를 먼저 훑어봐.', en: 'The workflow can run, but review {count} warnings first.' }, { count: formatNumber(warningIssueCount) })
          : t({ ko: '필수 실행 조건이 충족됐어.', en: 'Required run conditions are satisfied.' })

  return (
    <Card>
      <CardContent className="space-y-3.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading={t({ ko: '워크플로우 실행기', en: 'Workflow Runner' })}
            actions={
              <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
                {t({ ko: '구조 수정', en: 'Edit graph' })}
              </Button>
            }
          />
        ) : null}

        {selectedGraph ? (
          <div className="space-y-3.5">
            {!showHeader ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="truncate text-base font-semibold text-foreground">{selectedGraph.name}</div>
                  {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                  {graphSummaryLine || latestExecutionStatus ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                      {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {onOpenFolderSettings ? (
                    <Button type="button" size="icon-sm" variant="outline" onClick={onOpenFolderSettings} disabled={!selectedGraph} aria-label={t({ ko: '폴더 설정', en: 'Folder settings' })} title={t({ ko: '폴더 설정', en: 'Folder settings' })}>
                      <Folder className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button type="button" size="icon-sm" variant="outline" onClick={onEdit} disabled={!selectedGraph} aria-label={t({ ko: '구조 수정', en: 'Edit graph' })} title={t({ ko: '구조 수정', en: 'Edit graph' })}>
                    <PenSquare className="h-4 w-4" />
                  </Button>
                  {onDeleteWorkflow ? (
                    <Button type="button" size="icon-sm" variant="outline" onClick={onDeleteWorkflow} disabled={!selectedGraph} aria-label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })} title={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-base font-semibold text-foreground">{selectedGraph.name}</div>
                {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                {graphSummaryLine || latestExecutionStatus ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                    {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                  </div>
                ) : null}
              </div>
            )}

            <WorkflowVersionReviewBlock
              selectedGraph={selectedGraph}
              latestExecution={latestExecution}
              versionSummaries={versionQuery.data ?? []}
              versionQueryIsError={versionQuery.isError}
              runtimeInputDiffEntries={runtimeInputDiffEntries}
            />

            <WorkflowRuntimeHealthBlock
              runtimeHealth={runtimeHealthQuery.data ?? null}
              runtimeHealthIsError={runtimeHealthQuery.isError}
            />

            {reviewRequiredSchedules.length > 0 ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>{t({ ko: '자동 실행 재검토 필요', en: 'Auto-run review required' })}</span>
                  <Badge variant="outline">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(reviewRequiredSchedules.length) })}</Badge>
                </AlertTitle>
                <AlertDescription className="pt-2 text-sm text-muted-foreground">
                  {t({ ko: '이 워크플로우가 바뀌어서 연결된 자동 실행이 일시정지됐어. 선택을 해제한 뒤 `예약작업` 탭에서 확인하고 다시 켜줘.', en: 'This workflow changed, so linked auto-runs were paused. Deselect it, then review and re-enable them in the `Schedules` tab.' })}
                </AlertDescription>
              </Alert>
            ) : null}

            {latestExecution ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>{t({ ko: '최근 결과', en: 'Latest result' })}</span>
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                  <Badge variant="outline">{getGraphExecutionStatusLabel(latestExecution.status)}</Badge>
                  {latestExecutionArtifactCountLabel ? (
                    <Badge variant={latestExecutionArtifactCount && latestExecutionArtifactCount > 0 ? 'secondary' : 'outline'}>{latestExecutionArtifactCountLabel}</Badge>
                  ) : null}
                  {latestExecutionResultCountLabel ? (
                    <Badge variant={latestExecutionFinalResults && latestExecutionFinalResults.length > 0 ? 'secondary' : 'outline'}>{latestExecutionResultCountLabel}</Badge>
                  ) : null}
                  <Badge variant="outline">{t({ ko: '입출력 {count}', en: 'I/O {count}' }, { count: formatNumber(latestExecutionComparisonSummary.compactInputCount + latestExecutionComparisonSummary.compactOutputCount) })}</Badge>
                  {latestExecutionComparisonSummary.issueLogCount > 0 ? (
                    <Badge variant="outline">{t({ ko: '경고/오류 {count}', en: 'Warnings/errors {count}' }, { count: formatNumber(latestExecutionComparisonSummary.issueLogCount) })}</Badge>
                  ) : null}
                </AlertTitle>
                <AlertDescription className="pt-3">
                  {latestExecutionFinalResultWarning ? (
                    <div className="mb-3 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                      <div>
                        {latestExecutionFinalResultWarning.kind === 'source_artifact_missing'
                          ? latestExecutionFinalResultWarningSourceLabel
                            ? t({
                              ko: '최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.',
                              en: 'The final result node ran, but the {source} output did not create a saved result. Check the connected output port.',
                            }, { source: latestExecutionFinalResultWarningSourceLabel })
                            : t({ ko: '최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.', en: 'The final result node ran, but the connected output did not create a saved result. Check the connected output port.' })
                          : latestExecutionFinalResultWarningSourceLabel
                            ? t({
                              ko: '최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.',
                              en: 'The final result was saved, but linking the {source} output into generation history failed. Check the run logs for the cause.',
                            }, { source: latestExecutionFinalResultWarningSourceLabel })
                            : t({ ko: '최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.', en: 'The final result was saved, but linking it into generation history failed. Check the run logs for the cause.' })}
                      </div>
                      {latestExecutionAdditionalWarningCount > 0 ? (
                        <div className="mt-1 text-xs text-amber-100/80">
                          {t({ ko: '추가 최종 결과 경고 {count}개가 더 있어. 실행 상세 로그에서 함께 확인해줘.', en: '{count} more final-result warnings are available in the run logs.' }, { count: formatNumber(latestExecutionAdditionalWarningCount) })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {shouldShowLatestExecutionResults && latestExecutionArtifacts && latestExecutionFinalResults ? (
                    <WorkflowFinalResultsSection
                      finalResults={latestExecutionFinalResults}
                      artifacts={latestExecutionArtifacts}
                      selectedGraph={selectedGraph}
                      emptyLabel={latestExecutionEmptyResultLabel}
                    />
                  ) : shouldShowLatestExecutionResults ? (
                    <div className={cn('text-sm', latestExecutionDetailError ? 'text-destructive' : 'text-muted-foreground')}>{latestExecutionDetailLoadMessage}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{latestExecutionPendingMessage}</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <WorkflowValidationPanel
              issues={validationIssues}
              title={t({ ko: '실행 검증', en: 'Run validation' })}
              description={t({ ko: '실행 전 확인', en: 'Check before running' })}
              showHeader={false}
              onIssueSelect={onValidationIssueSelect}
            />

            <WorkflowInputFields
              inputDefinitions={inputDefinitions}
              inputValues={inputValues}
              onInputValueChange={onInputValueChange}
              onInputValueClear={onInputValueClear}
              onInputImageChange={onInputImageChange}
            />

            <Alert variant={!canExecute ? 'destructive' : 'default'}>
              <AlertTitle className="flex flex-wrap items-center gap-1.5">
                <span>{canExecute ? t({ ko: '실행 준비', en: 'Run readiness' }) : t({ ko: '실행 전 조치 필요', en: 'Action needed before running' })}</span>
                {blockingIssueCount > 0 ? <Badge variant="outline">{t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(blockingIssueCount) })}</Badge> : null}
                {warningIssueCount > 0 ? <Badge variant="outline">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningIssueCount) })}</Badge> : null}
              </AlertTitle>
              <AlertDescription className="pt-2 text-sm text-muted-foreground">
                {runReadinessMessage}
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={onExecute} disabled={isExecuting || !canExecute}>
                {isExecuting ? t({ ko: '실행 요청 중…', en: 'Requesting run…' }) : canExecute ? t({ ko: '실행', en: 'Run' }) : t({ ko: '실행 불가', en: 'Cannot run' })}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
