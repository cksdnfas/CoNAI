import type { GraphWorkflowRuntimeHealthRecord } from '@/lib/api-module-graph'

export type WorkflowRuntimeObservabilityTrendKey = 'queue-health' | 'retry-policy' | 'recovery' | 'retention' | 'terminal-history'
export type WorkflowRuntimeObservabilityTrendTone = 'ready' | 'watch' | 'attention'
export type WorkflowRuntimeThresholdGuidanceKey = 'queue-pressure-threshold' | 'retry-stop-threshold' | 'recovery-mismatch-threshold' | 'retention-approval-threshold' | 'terminal-failure-threshold'
export type WorkflowRuntimeDecisionCueKey = 'queue-rerun-readiness' | 'autorun-stop-review' | 'recovery-output-review' | 'retention-cleanup-approval' | 'terminal-error-review'
export type WorkflowRuntimeDecisionCueAction = 'safe-to-observe' | 'review-before-rerun' | 'approval-required'

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
