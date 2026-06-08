import type { GraphWorkflowRuntimeHealthRecord } from '@/lib/api-module-graph'

export type WorkflowRuntimeObservabilityTrendKey = 'queue-health' | 'retry-policy' | 'recovery' | 'retention' | 'terminal-history'
export type WorkflowRuntimeObservabilityTrendTone = 'ready' | 'watch' | 'attention'

export interface WorkflowRuntimeObservabilityTrend {
  key: WorkflowRuntimeObservabilityTrendKey
  tone: WorkflowRuntimeObservabilityTrendTone
  primaryCount: number
  secondaryCount: number
  tertiaryCount: number
  timestamp?: string | null
}

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
