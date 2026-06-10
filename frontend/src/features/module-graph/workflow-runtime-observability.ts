import type { GraphWorkflowRuntimeHealthRecord } from '@/lib/api-module-graph'

export type WorkflowRuntimeObservabilityTrendKey = 'queue-health' | 'retry-policy' | 'recovery' | 'retention' | 'terminal-history'
export type WorkflowRuntimeObservabilityTrendTone = 'ready' | 'watch' | 'attention'
export type WorkflowRuntimeThresholdGuidanceKey = 'queue-pressure-threshold' | 'retry-stop-threshold' | 'recovery-mismatch-threshold' | 'retention-approval-threshold' | 'terminal-failure-threshold'
export type WorkflowRuntimeDecisionCueKey = 'queue-rerun-readiness' | 'autorun-stop-review' | 'recovery-output-review' | 'retention-cleanup-approval' | 'terminal-error-review'
export type WorkflowRuntimeDecisionCueAction = 'safe-to-observe' | 'review-before-rerun' | 'approval-required'
export type WorkflowRuntimeRunbookEvidenceKey = 'rerun-readiness-evidence' | 'rollback-handoff-evidence' | 'stop-condition-evidence'
export type WorkflowRuntimeFailureGroupKey = 'queue-pressure' | 'autorun-stopped' | 'startup-recovery' | 'terminal-failures' | 'approval-boundary'
export type WorkflowRuntimeRerunPreflightKey = 'queue-drain-preflight' | 'autorun-reason-preflight' | 'recovery-output-preflight' | 'latest-error-preflight' | 'approval-boundary-preflight'
export type WorkflowRuntimeRerunPreflightStatus = 'ready' | 'review-needed' | 'blocked' | 'approval-needed'

export interface WorkflowRuntimeObservabilityTrend {
  key: WorkflowRuntimeObservabilityTrendKey
  tone: WorkflowRuntimeObservabilityTrendTone
  primaryCount: number
  secondaryCount: number
  tertiaryCount: number
  timestamp?: string | null
}

export interface WorkflowRuntimeThresholdGuidance {
  key: WorkflowRuntimeThresholdGuidanceKey
  tone: WorkflowRuntimeObservabilityTrendTone
  currentCount: number
  thresholdCount: number
  approvalBoundary: 'operator-review' | 'approval-required'
  timestamp?: string | null
}

export interface WorkflowRuntimeDecisionCue {
  key: WorkflowRuntimeDecisionCueKey
  tone: WorkflowRuntimeObservabilityTrendTone
  action: WorkflowRuntimeDecisionCueAction
  primaryCount: number
  secondaryCount: number
  approvalBoundary: 'operator-review' | 'approval-required'
  timestamp?: string | null
}

export interface WorkflowRuntimeRunbookEvidence {
  key: WorkflowRuntimeRunbookEvidenceKey
  tone: WorkflowRuntimeObservabilityTrendTone
  action: WorkflowRuntimeDecisionCueAction
  evidenceCount: number
  guardrailCount: number
  approvalBoundary: 'operator-review' | 'approval-required'
  timestamp?: string | null
}

export interface WorkflowRuntimeFailureGroup {
  key: WorkflowRuntimeFailureGroupKey
  tone: WorkflowRuntimeObservabilityTrendTone
  action: WorkflowRuntimeDecisionCueAction
  primaryCount: number
  secondaryCount: number
  evidenceCount: number
  approvalBoundary: 'operator-review' | 'approval-required'
  timestamp?: string | null
}

export interface WorkflowRuntimeRerunPreflightCheck {
  key: WorkflowRuntimeRerunPreflightKey
  status: WorkflowRuntimeRerunPreflightStatus
  tone: WorkflowRuntimeObservabilityTrendTone
  guardrailCount: number
  approvalBoundary: 'operator-review' | 'approval-required'
  timestamp?: string | null
}

export interface WorkflowRuntimeRecoveryHandoffPacket {
  markdown: string
  blockedCheckCount: number
  approvalNeededCheckCount: number
  evidenceSignalCount: number
  externalActionsExecuted: false
}

const RUNTIME_REVIEW_THRESHOLD = 1
const RUNTIME_FAILURE_PERCENT_THRESHOLD = 20

function getRuntimeTrendTone(count: number, attentionThreshold = 1): WorkflowRuntimeObservabilityTrendTone {
  if (count >= attentionThreshold) {
    return 'attention'
  }

  if (count > 0) {
    return 'watch'
  }

  return 'ready'
}

export function buildWorkflowRuntimeObservabilityTrends(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeObservabilityTrend[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queueConcernCount = runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const terminalHistoryCount = runtimeHealth.telemetry.completed_count
    + runtimeHealth.telemetry.failed_count
    + runtimeHealth.telemetry.cancelled_count
  const nonSuccessHistoryCount = runtimeHealth.telemetry.failed_count + runtimeHealth.telemetry.cancelled_count
  const failurePercent = terminalHistoryCount > 0
    ? Math.round((runtimeHealth.telemetry.failed_count / terminalHistoryCount) * 100)
    : 0

  return [
    {
      key: 'queue-health',
      tone: queueConcernCount > 0 ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      primaryCount: activeQueueCount,
      secondaryCount: runtimeHealth.queue.in_process_running_count,
      tertiaryCount: runtimeHealth.queue.cancellation_requested_count,
      timestamp: runtimeHealth.queue.oldest_queued_at ?? null,
    },
    {
      key: 'retry-policy',
      tone: stoppedScheduleCount > 0 ? 'attention' : runtimeHealth.queue.retry_timer_pending ? 'watch' : 'ready',
      primaryCount: stoppedScheduleCount,
      secondaryCount: runtimeHealth.retry_policy.active_schedule_count,
      tertiaryCount: runtimeHealth.queue.retry_timer_pending ? runtimeHealth.queue.queue_recheck_interval_ms : 0,
      timestamp: null,
    },
    {
      key: 'recovery',
      tone: getRuntimeTrendTone(recoveryConcernCount),
      primaryCount: recoveryConcernCount,
      secondaryCount: runtimeHealth.recovery.startup_queued_backlog,
      tertiaryCount: runtimeHealth.recovery.startup_failed_running,
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? null,
    },
    {
      key: 'retention',
      tone: runtimeHealth.retention.pending_prune ? 'watch' : 'ready',
      primaryCount: runtimeHealth.retention.pending_prune_count,
      secondaryCount: runtimeHealth.retention.output_retention_limit,
      tertiaryCount: runtimeHealth.retention.pending_prune ? 1 : 0,
      timestamp: null,
    },
    {
      key: 'terminal-history',
      tone: getRuntimeTrendTone(nonSuccessHistoryCount, 5),
      primaryCount: terminalHistoryCount,
      secondaryCount: nonSuccessHistoryCount,
      tertiaryCount: failurePercent,
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
  ]
}

export function buildWorkflowRuntimeThresholdGuidance(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeThresholdGuidance[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queuePressureThreshold = Math.max(1, runtimeHealth.queue.schedule_concurrency_limit)
  const queueConcernCount = runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, activeQueueCount - queuePressureThreshold)
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const terminalHistoryCount = runtimeHealth.telemetry.completed_count
    + runtimeHealth.telemetry.failed_count
    + runtimeHealth.telemetry.cancelled_count
  const failurePercent = terminalHistoryCount > 0
    ? Math.round((runtimeHealth.telemetry.failed_count / terminalHistoryCount) * 100)
    : 0

  return [
    {
      key: 'queue-pressure-threshold',
      tone: queueConcernCount >= RUNTIME_REVIEW_THRESHOLD ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      currentCount: activeQueueCount,
      thresholdCount: queuePressureThreshold,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.queue.oldest_queued_at ?? null,
    },
    {
      key: 'retry-stop-threshold',
      tone: getRuntimeTrendTone(stoppedScheduleCount),
      currentCount: stoppedScheduleCount,
      thresholdCount: RUNTIME_REVIEW_THRESHOLD,
      approvalBoundary: 'operator-review',
      timestamp: null,
    },
    {
      key: 'recovery-mismatch-threshold',
      tone: getRuntimeTrendTone(recoveryConcernCount),
      currentCount: recoveryConcernCount,
      thresholdCount: RUNTIME_REVIEW_THRESHOLD,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? null,
    },
    {
      key: 'retention-approval-threshold',
      tone: runtimeHealth.retention.pending_prune_count >= RUNTIME_REVIEW_THRESHOLD ? 'watch' : 'ready',
      currentCount: runtimeHealth.retention.pending_prune_count,
      thresholdCount: RUNTIME_REVIEW_THRESHOLD,
      approvalBoundary: 'approval-required',
      timestamp: null,
    },
    {
      key: 'terminal-failure-threshold',
      tone: failurePercent >= RUNTIME_FAILURE_PERCENT_THRESHOLD ? 'attention' : failurePercent > 0 ? 'watch' : 'ready',
      currentCount: failurePercent,
      thresholdCount: RUNTIME_FAILURE_PERCENT_THRESHOLD,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
  ]
}

export function buildWorkflowRuntimeDecisionCues(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeDecisionCue[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queuePressureCount = Math.max(0, activeQueueCount - Math.max(1, runtimeHealth.queue.schedule_concurrency_limit))
    + runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const terminalHistoryCount = runtimeHealth.telemetry.completed_count
    + runtimeHealth.telemetry.failed_count
    + runtimeHealth.telemetry.cancelled_count
  const nonSuccessHistoryCount = runtimeHealth.telemetry.failed_count + runtimeHealth.telemetry.cancelled_count
  const failurePercent = terminalHistoryCount > 0
    ? Math.round((runtimeHealth.telemetry.failed_count / terminalHistoryCount) * 100)
    : 0

  return [
    {
      key: 'queue-rerun-readiness',
      tone: queuePressureCount > 0 ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      action: queuePressureCount > 0 || activeQueueCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: activeQueueCount,
      secondaryCount: queuePressureCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.queue.oldest_queued_at ?? null,
    },
    {
      key: 'autorun-stop-review',
      tone: getRuntimeTrendTone(stoppedScheduleCount),
      action: stoppedScheduleCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: stoppedScheduleCount,
      secondaryCount: runtimeHealth.retry_policy.active_schedule_count,
      approvalBoundary: 'operator-review',
      timestamp: null,
    },
    {
      key: 'recovery-output-review',
      tone: getRuntimeTrendTone(recoveryConcernCount),
      action: recoveryConcernCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: recoveryConcernCount,
      secondaryCount: runtimeHealth.recovery.startup_queued_backlog,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? null,
    },
    {
      key: 'retention-cleanup-approval',
      tone: runtimeHealth.retention.pending_prune_count > 0 ? 'watch' : 'ready',
      action: runtimeHealth.retention.pending_prune_count > 0 ? 'approval-required' : 'safe-to-observe',
      primaryCount: runtimeHealth.retention.pending_prune_count,
      secondaryCount: runtimeHealth.retention.output_retention_limit,
      approvalBoundary: 'approval-required',
      timestamp: null,
    },
    {
      key: 'terminal-error-review',
      tone: failurePercent >= RUNTIME_FAILURE_PERCENT_THRESHOLD ? 'attention' : nonSuccessHistoryCount > 0 ? 'watch' : 'ready',
      action: nonSuccessHistoryCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: failurePercent,
      secondaryCount: nonSuccessHistoryCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
  ]
}

export function buildWorkflowRuntimeRunbookEvidence(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeRunbookEvidence[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queuePressureCount = Math.max(0, activeQueueCount - Math.max(1, runtimeHealth.queue.schedule_concurrency_limit))
    + runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const nonSuccessHistoryCount = runtimeHealth.telemetry.failed_count + runtimeHealth.telemetry.cancelled_count
  const rollbackEvidenceCount = recoveryConcernCount
    + runtimeHealth.telemetry.failed_count
    + runtimeHealth.telemetry.cancelled_count
    + runtimeHealth.retention.pending_prune_count
  const stopConditionEvidenceCount = stoppedScheduleCount
    + runtimeHealth.queue.cancellation_requested_count
    + runtimeHealth.telemetry.failed_count

  return [
    {
      key: 'rerun-readiness-evidence',
      tone: queuePressureCount + stoppedScheduleCount + recoveryConcernCount + nonSuccessHistoryCount > 0 ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      action: queuePressureCount + stoppedScheduleCount + recoveryConcernCount + nonSuccessHistoryCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      evidenceCount: activeQueueCount + stoppedScheduleCount + recoveryConcernCount + nonSuccessHistoryCount,
      guardrailCount: queuePressureCount + stoppedScheduleCount + recoveryConcernCount + nonSuccessHistoryCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.queue.oldest_queued_at ?? runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
    {
      key: 'rollback-handoff-evidence',
      tone: rollbackEvidenceCount > 0 ? 'attention' : 'ready',
      action: rollbackEvidenceCount > 0 ? 'approval-required' : 'safe-to-observe',
      evidenceCount: rollbackEvidenceCount,
      guardrailCount: rollbackEvidenceCount > 0 ? 1 : 0,
      approvalBoundary: 'approval-required',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
    {
      key: 'stop-condition-evidence',
      tone: stopConditionEvidenceCount > 0 ? 'attention' : runtimeHealth.queue.retry_timer_pending ? 'watch' : 'ready',
      action: stopConditionEvidenceCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      evidenceCount: stopConditionEvidenceCount,
      guardrailCount: stopConditionEvidenceCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? null,
    },
  ]
}

/** Group workflow queue failure evidence before an operator decides on reruns. */
export function buildWorkflowRuntimeFailureGroups(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeFailureGroup[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queuePressureCount = Math.max(0, activeQueueCount - Math.max(1, runtimeHealth.queue.schedule_concurrency_limit))
    + runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const startupRecoveryEvidenceCount = recoveryConcernCount + runtimeHealth.recovery.startup_queued_backlog
  const terminalHistoryCount = runtimeHealth.telemetry.completed_count
    + runtimeHealth.telemetry.failed_count
    + runtimeHealth.telemetry.cancelled_count
  const failurePercent = terminalHistoryCount > 0
    ? Math.round((runtimeHealth.telemetry.failed_count / terminalHistoryCount) * 100)
    : 0
  const approvalEvidenceCount = runtimeHealth.retention.pending_prune_count
    + runtimeHealth.queue.cancellation_requested_count
    + recoveryConcernCount

  return [
    {
      key: 'queue-pressure',
      tone: queuePressureCount > 0 ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      action: queuePressureCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: activeQueueCount,
      secondaryCount: queuePressureCount,
      evidenceCount: activeQueueCount + queuePressureCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.queue.oldest_queued_at ?? null,
    },
    {
      key: 'autorun-stopped',
      tone: getRuntimeTrendTone(stoppedScheduleCount),
      action: stoppedScheduleCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: stoppedScheduleCount,
      secondaryCount: runtimeHealth.retry_policy.active_schedule_count,
      evidenceCount: stoppedScheduleCount,
      approvalBoundary: 'operator-review',
      timestamp: null,
    },
    {
      key: 'startup-recovery',
      tone: getRuntimeTrendTone(recoveryConcernCount),
      action: recoveryConcernCount > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: recoveryConcernCount,
      secondaryCount: runtimeHealth.recovery.startup_queued_backlog,
      evidenceCount: startupRecoveryEvidenceCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? null,
    },
    {
      key: 'terminal-failures',
      tone: failurePercent >= RUNTIME_FAILURE_PERCENT_THRESHOLD ? 'attention' : runtimeHealth.telemetry.failed_count > 0 ? 'watch' : 'ready',
      action: runtimeHealth.telemetry.failed_count > 0 || runtimeHealth.telemetry.cancelled_count > 0 ? 'review-before-rerun' : 'safe-to-observe',
      primaryCount: runtimeHealth.telemetry.failed_count,
      secondaryCount: failurePercent,
      evidenceCount: runtimeHealth.telemetry.failed_count + runtimeHealth.telemetry.cancelled_count,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? runtimeHealth.telemetry.latest_completed_at ?? null,
    },
    {
      key: 'approval-boundary',
      tone: approvalEvidenceCount > 0 ? 'attention' : 'ready',
      action: approvalEvidenceCount > 0 ? 'approval-required' : 'safe-to-observe',
      primaryCount: runtimeHealth.retention.pending_prune_count,
      secondaryCount: runtimeHealth.queue.cancellation_requested_count + recoveryConcernCount,
      evidenceCount: approvalEvidenceCount,
      approvalBoundary: 'approval-required',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? runtimeHealth.telemetry.latest_failed_at ?? null,
    },
  ]
}

/** Build local-only preflight gates for rerun/recovery handoff decisions. */
function formatHandoffTimestamp(value?: string | null) {
  return value && value.trim().length > 0 ? value : 'none'
}

/** Build a local-only Markdown packet for approval-gated recovery/rerun handoff review. */
export function buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeRecoveryHandoffPacket {
  const failureGroups = buildWorkflowRuntimeFailureGroups(runtimeHealth)
  const preflightChecks = buildWorkflowRuntimeRerunPreflight(runtimeHealth)
  const blockedCheckCount = preflightChecks.filter((check) => check.status === 'blocked').length
  const approvalNeededCheckCount = preflightChecks.filter((check) => check.status === 'approval-needed').length
  const evidenceSignalCount = failureGroups.reduce((total, group) => total + group.evidenceCount, 0)
  const latestTimestamp = runtimeHealth.telemetry.latest_failed_at
    ?? runtimeHealth.telemetry.latest_completed_at
    ?? runtimeHealth.queue.oldest_queued_at
    ?? runtimeHealth.recovery.last_startup_recovery_at
    ?? null
  const lines = [
    '# Workflow recovery handoff packet',
    '',
    `- workflowId: ${runtimeHealth.workflow_id}`,
    `- generatedAtSource: ${formatHandoffTimestamp(latestTimestamp)}`,
    '- externalActionsExecuted: false',
    '- pushDeployRestartBoundary: approval-required',
    `- blockedPreflightChecks: ${blockedCheckCount}`,
    `- approvalNeededChecks: ${approvalNeededCheckCount}`,
    `- evidenceSignals: ${evidenceSignalCount}`,
    '',
    '## Queue state',
    '',
    `- queued: ${runtimeHealth.queue.queued_count}`,
    `- running: ${runtimeHealth.queue.running_count}`,
    `- inProcessRunning: ${runtimeHealth.queue.in_process_running_count}`,
    `- cancellationRequested: ${runtimeHealth.queue.cancellation_requested_count}`,
    `- oldestQueuedAt: ${formatHandoffTimestamp(runtimeHealth.queue.oldest_queued_at)}`,
    '',
    '## Recovery and terminal evidence',
    '',
    `- startupQueuedBacklog: ${runtimeHealth.recovery.startup_queued_backlog}`,
    `- startupFailedRunning: ${runtimeHealth.recovery.startup_failed_running}`,
    `- runningNotInProcess: ${runtimeHealth.recovery.running_not_in_process_count}`,
    `- lastStartupRecoveryAt: ${formatHandoffTimestamp(runtimeHealth.recovery.last_startup_recovery_at)}`,
    `- completed: ${runtimeHealth.telemetry.completed_count}`,
    `- failed: ${runtimeHealth.telemetry.failed_count}`,
    `- cancelled: ${runtimeHealth.telemetry.cancelled_count}`,
    `- latestFailedAt: ${formatHandoffTimestamp(runtimeHealth.telemetry.latest_failed_at)}`,
    `- latestErrorMessage: ${runtimeHealth.telemetry.latest_error_message ?? 'none'}`,
    '',
    '## Failure groups',
    '',
    ...failureGroups.map((group) => `- ${group.key}: action=${group.action}; evidence=${group.evidenceCount}; approvalBoundary=${group.approvalBoundary}`),
    '',
    '## Rerun preflight',
    '',
    ...preflightChecks.map((check) => `- ${check.key}: status=${check.status}; guardrails=${check.guardrailCount}; approvalBoundary=${check.approvalBoundary}`),
    '',
    '## Operator handoff',
    '',
    '- Review blocked preflight checks before any rerun.',
    '- Keep cleanup, service restart, external side effects, and retention policy changes approval-owned.',
    '- This packet is generated locally from runtime health only and does not mutate queues, schedules, files, services, or external systems.',
  ]

  return {
    markdown: lines.join('\n'),
    blockedCheckCount,
    approvalNeededCheckCount,
    evidenceSignalCount,
    externalActionsExecuted: false,
  }
}

export function buildWorkflowRuntimeRerunPreflight(runtimeHealth: GraphWorkflowRuntimeHealthRecord): WorkflowRuntimeRerunPreflightCheck[] {
  const activeQueueCount = runtimeHealth.queue.queued_count + runtimeHealth.queue.running_count
  const queuePressureCount = Math.max(0, activeQueueCount - Math.max(1, runtimeHealth.queue.schedule_concurrency_limit))
    + runtimeHealth.queue.cancellation_requested_count
    + Math.max(0, runtimeHealth.queue.running_count - runtimeHealth.queue.in_process_running_count)
  const stoppedScheduleCount = runtimeHealth.retry_policy.paused_for_review_count
    + runtimeHealth.retry_policy.stopped_after_error_count
    + runtimeHealth.retry_policy.overlap_stopped_count
  const recoveryConcernCount = runtimeHealth.recovery.startup_failed_running
    + runtimeHealth.recovery.running_not_in_process_count
  const latestErrorCount = runtimeHealth.telemetry.latest_error_message || runtimeHealth.telemetry.failed_count > 0 ? runtimeHealth.telemetry.failed_count : 0
  const approvalGuardrailCount = runtimeHealth.retention.pending_prune_count
    + runtimeHealth.queue.cancellation_requested_count
    + recoveryConcernCount

  return [
    {
      key: 'queue-drain-preflight',
      status: queuePressureCount > 0 ? 'blocked' : activeQueueCount > 0 ? 'review-needed' : 'ready',
      tone: queuePressureCount > 0 ? 'attention' : activeQueueCount > 0 ? 'watch' : 'ready',
      guardrailCount: activeQueueCount + queuePressureCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.queue.oldest_queued_at ?? null,
    },
    {
      key: 'autorun-reason-preflight',
      status: stoppedScheduleCount > 0 ? 'blocked' : 'ready',
      tone: getRuntimeTrendTone(stoppedScheduleCount),
      guardrailCount: stoppedScheduleCount,
      approvalBoundary: 'operator-review',
      timestamp: null,
    },
    {
      key: 'recovery-output-preflight',
      status: recoveryConcernCount > 0 ? 'blocked' : runtimeHealth.recovery.startup_queued_backlog > 0 ? 'review-needed' : 'ready',
      tone: getRuntimeTrendTone(recoveryConcernCount || runtimeHealth.recovery.startup_queued_backlog, 2),
      guardrailCount: recoveryConcernCount + runtimeHealth.recovery.startup_queued_backlog,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? null,
    },
    {
      key: 'latest-error-preflight',
      status: latestErrorCount > 0 ? 'blocked' : 'ready',
      tone: latestErrorCount > 0 ? 'attention' : 'ready',
      guardrailCount: latestErrorCount,
      approvalBoundary: 'operator-review',
      timestamp: runtimeHealth.telemetry.latest_failed_at ?? null,
    },
    {
      key: 'approval-boundary-preflight',
      status: approvalGuardrailCount > 0 ? 'approval-needed' : 'ready',
      tone: approvalGuardrailCount > 0 ? 'attention' : 'ready',
      guardrailCount: approvalGuardrailCount,
      approvalBoundary: 'approval-required',
      timestamp: runtimeHealth.recovery.last_startup_recovery_at ?? runtimeHealth.telemetry.latest_failed_at ?? null,
    },
  ]
}
