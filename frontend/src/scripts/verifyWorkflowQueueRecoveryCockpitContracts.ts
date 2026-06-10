import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildWorkflowRuntimeFailureGroups,
  buildWorkflowRuntimeRerunPreflight,
} from '../features/module-graph/workflow-runtime-observability'
import type { GraphWorkflowRuntimeHealthRecord } from '../lib/api-module-graph'

const runtimeHealth: GraphWorkflowRuntimeHealthRecord = {
  workflow_id: 42,
  queue: {
    queued_count: 3,
    running_count: 2,
    manual_queued_count: 1,
    manual_running_count: 0,
    schedule_queued_count: 2,
    schedule_running_count: 2,
    in_process_running_count: 1,
    oldest_queued_at: '2026-06-10T10:00:00.000Z',
    retry_timer_pending: true,
    queue_recheck_interval_ms: 5000,
    schedule_concurrency_limit: 1,
    cancellation_requested_count: 1,
  },
  retry_policy: {
    schedule_count: 4,
    active_schedule_count: 2,
    stop_on_failure_count: 2,
    continue_on_failure_count: 2,
    paused_for_review_count: 1,
    stopped_after_error_count: 1,
    overlap_stopped_count: 1,
  },
  retention: {
    output_retention_limit: 12,
    pending_prune: true,
    pending_prune_count: 2,
  },
  recovery: {
    last_startup_recovery_at: '2026-06-10T09:30:00.000Z',
    startup_queued_backlog: 2,
    startup_failed_running: 1,
    running_not_in_process_count: 1,
  },
  telemetry: {
    completed_count: 4,
    failed_count: 3,
    cancelled_count: 1,
    latest_completed_at: '2026-06-10T09:00:00.000Z',
    latest_failed_at: '2026-06-10T11:00:00.000Z',
    latest_error_message: 'Node loader failed',
  },
}

const failureGroups = buildWorkflowRuntimeFailureGroups(runtimeHealth)
equal(failureGroups.length, 5, 'workflow recovery cockpit should expose five failure groups')
ok(failureGroups.some((group) => group.key === 'queue-pressure' && group.evidenceCount === 11 && group.action === 'review-before-rerun'), 'queue pressure group should combine backlog, over-capacity pressure, and cancellations')
ok(failureGroups.some((group) => group.key === 'autorun-stopped' && group.evidenceCount === 3 && group.action === 'review-before-rerun'), 'autorun group should surface stopped and review-held schedules')
ok(failureGroups.some((group) => group.key === 'startup-recovery' && group.evidenceCount === 4), 'startup recovery group should include backlog and failed-running recovery evidence')
ok(failureGroups.some((group) => group.key === 'terminal-failures' && group.primaryCount === 3 && group.secondaryCount === 38), 'terminal failure group should expose failed count and failure percent')
ok(failureGroups.some((group) => group.key === 'approval-boundary' && group.approvalBoundary === 'approval-required'), 'approval boundary group should keep cleanup and restart decisions approval-owned')

const preflight = buildWorkflowRuntimeRerunPreflight(runtimeHealth)
equal(preflight.length, 5, 'workflow recovery cockpit should expose five rerun preflight checks')
ok(preflight.some((check) => check.key === 'queue-drain-preflight' && check.status === 'blocked' && check.guardrailCount === 11), 'queue drain preflight should block rerun when the queue is pressured')
ok(preflight.some((check) => check.key === 'autorun-reason-preflight' && check.status === 'blocked'), 'autorun stop reasons should block rerun until reviewed')
ok(preflight.some((check) => check.key === 'recovery-output-preflight' && check.status === 'blocked'), 'recovery mismatches should block rerun until outputs are reviewed')
ok(preflight.some((check) => check.key === 'latest-error-preflight' && check.status === 'blocked'), 'recent errors should block immediate rerun')
ok(preflight.some((check) => check.key === 'approval-boundary-preflight' && check.status === 'approval-needed' && check.approvalBoundary === 'approval-required'), 'destructive/external recovery remains approval-gated')

const workflowRunnerPanel = readFileSync(join(process.cwd(), 'src/features/module-graph/components/workflow-runner-panel.tsx'), 'utf8')
ok(workflowRunnerPanel.includes('data-workflow-runtime-failure-groups="true"'), 'workflow runner should render grouped failure evidence')
ok(workflowRunnerPanel.includes('data-workflow-runtime-failure-group={group.key}'), 'workflow failure groups should be identifiable')
ok(workflowRunnerPanel.includes('data-workflow-runtime-rerun-preflight="true"'), 'workflow runner should render rerun preflight evidence')
ok(workflowRunnerPanel.includes('data-workflow-runtime-rerun-preflight-check={check.key}'), 'workflow rerun preflight checks should be identifiable')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeFailureGroups(runtimeHealth)'), 'workflow runner should derive failure groups from local runtime health')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeRerunPreflight(runtimeHealth)'), 'workflow runner should derive preflight checks from local runtime health')
ok(!workflowRunnerPanel.includes('runGraphWorkflowScheduleNow('), 'queue recovery cockpit must not rerun schedules automatically')
ok(!workflowRunnerPanel.includes('resumeGraphWorkflowSchedule('), 'queue recovery cockpit must not resume autoruns automatically')

console.log('Workflow queue recovery cockpit contracts verified.')
