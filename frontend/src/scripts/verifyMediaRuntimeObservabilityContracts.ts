import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildMediaReviewCleanupStagingPlan,
  buildMediaReviewOperationalTrends,
  buildMediaReviewThresholdGuidance,
  getMediaReviewRecommendedQueues,
  getMediaReviewSignalSummary,
  getMediaReviewSimilarityDecisionSummary,
} from '../features/media-review/media-review-utils'
import { buildWorkflowRuntimeDecisionCues, buildWorkflowRuntimeObservabilityTrends, buildWorkflowRuntimeRunbookEvidence, buildWorkflowRuntimeThresholdGuidance } from '../features/module-graph/workflow-runtime-observability'
import type { GraphWorkflowRuntimeHealthRecord } from '../lib/api-module-graph'
import type { ImageRecord } from '../types/image'

const reviewImages: ImageRecord[] = [
  {
    id: 1,
    composite_hash: 'ready',
    groups: [{ id: 1, name: 'Ready', collection_type: 'manual' }],
    rating_score: 95,
    auto_tags: {
      general: { sky: 0.8, cloud: 0.7, tree: 0.6, river: 0.5, grass: 0.4, sun: 0.3 },
      character: {},
      rating: { general: 0.99 },
    },
  },
  { id: 2, composite_hash: 'missing-tags', groups: [], rating_score: null, auto_tags: null },
  {
    id: 3,
    composite_hash: 'sparse-tags',
    groups: [],
    rating_score: null,
    auto_tags: { general: { face: 0.9 }, character: {}, rating: {} },
  },
  { id: 4, composite_hash: 'recoverable', groups: [], rating_score: null, file_status: 'missing', auto_tags: null },
]

const sourceSummary = getMediaReviewSignalSummary(reviewImages, new Set(['sparse-tags']))
const visibleSummary = getMediaReviewSignalSummary(reviewImages.slice(1), new Set(['sparse-tags']))
const recommendedQueues = getMediaReviewRecommendedQueues(sourceSummary, { reviewedCount: 1 })
const cleanupStagingPlan = buildMediaReviewCleanupStagingPlan(reviewImages.slice(1), new Set(['sparse-tags']))
const decisionSummary = getMediaReviewSimilarityDecisionSummary([
  {
    id: 'ready:sparse-tags:needs-human-review:2026-06-08T12:00:00.000Z',
    anchorHash: 'ready',
    targetHash: 'sparse-tags',
    decision: 'needs-human-review',
    decidedAt: '2026-06-08T12:00:00.000Z',
    matchState: 'similar-match',
    reversible: true,
  },
])

const mediaTrends = buildMediaReviewOperationalTrends({
  sourceSummary,
  visibleSummary,
  reviewedCount: 1,
  recommendedQueues,
  decisionSummary,
  cleanupStagingPlan,
  stagedCleanupItems: cleanupStagingPlan.items.slice(0, 2),
})

equal(mediaTrends.length, 4, 'media observability should expose four trend summaries')
ok(mediaTrends.some((trend) => trend.key === 'review-queue' && trend.queue === 'needs-review'), 'review queue trend should link back to the needs-review queue')
ok(mediaTrends.some((trend) => trend.key === 'cleanup-staging' && trend.primaryCount === 2 && trend.secondaryCount === 3), 'cleanup staging trend should compare staged history with selected candidates')
ok(mediaTrends.some((trend) => trend.key === 'similarity-history' && trend.secondaryCount === 1), 'similarity trend should keep needs-human-review history visible')
ok(cleanupStagingPlan.items.every((item) => item.destructiveAction === false), 'media observability must keep cleanup staging non-destructive')

const mediaThresholdGuidance = buildMediaReviewThresholdGuidance(mediaTrends)
equal(mediaThresholdGuidance.length, 4, 'media observability should expose four threshold guidance records')
ok(mediaThresholdGuidance.some((guidance) => guidance.key === 'review-queue-threshold' && guidance.thresholdCount === 48), 'media review queue guidance should carry the review backlog threshold')
ok(mediaThresholdGuidance.some((guidance) => guidance.key === 'quality-backlog-threshold' && guidance.thresholdCount === 24), 'media quality guidance should carry the quality backlog threshold')
ok(mediaThresholdGuidance.some((guidance) => guidance.key === 'similarity-review-threshold' && guidance.currentCount === 1 && guidance.tone === 'watch'), 'similarity guidance should flag open human-review decisions')
ok(mediaThresholdGuidance.some((guidance) => guidance.key === 'cleanup-approval-threshold' && guidance.approvalBoundary === 'approval-required'), 'cleanup guidance should keep destructive cleanup approval-owned')

const runtimeHealth: GraphWorkflowRuntimeHealthRecord = {
  workflow_id: 42,
  queue: {
    queued_count: 2,
    running_count: 1,
    manual_queued_count: 1,
    manual_running_count: 0,
    schedule_queued_count: 1,
    schedule_running_count: 1,
    in_process_running_count: 0,
    oldest_queued_at: '2026-06-08T10:00:00.000Z',
    retry_timer_pending: true,
    queue_recheck_interval_ms: 5000,
    schedule_concurrency_limit: 1,
    cancellation_requested_count: 1,
  },
  retry_policy: {
    schedule_count: 3,
    active_schedule_count: 1,
    stop_on_failure_count: 2,
    continue_on_failure_count: 1,
    paused_for_review_count: 1,
    stopped_after_error_count: 1,
    overlap_stopped_count: 0,
  },
  retention: {
    output_retention_limit: 12,
    pending_prune: true,
    pending_prune_count: 4,
  },
  recovery: {
    last_startup_recovery_at: '2026-06-08T09:00:00.000Z',
    startup_queued_backlog: 2,
    startup_failed_running: 1,
    running_not_in_process_count: 1,
  },
  telemetry: {
    completed_count: 6,
    failed_count: 2,
    cancelled_count: 2,
    latest_completed_at: '2026-06-08T11:00:00.000Z',
    latest_failed_at: '2026-06-08T12:00:00.000Z',
    latest_error_message: 'Test failure',
  },
}

const runtimeTrends = buildWorkflowRuntimeObservabilityTrends(runtimeHealth)
equal(runtimeTrends.length, 5, 'workflow runtime observability should expose five trend summaries')
ok(runtimeTrends.some((trend) => trend.key === 'queue-health' && trend.tone === 'attention' && trend.primaryCount === 3), 'queue trend should include active queue pressure and cancellation concern')
ok(runtimeTrends.some((trend) => trend.key === 'retry-policy' && trend.primaryCount === 2), 'retry trend should count paused or stopped schedules')
ok(runtimeTrends.some((trend) => trend.key === 'recovery' && trend.primaryCount === 2), 'recovery trend should include startup and in-process mismatch checks')
ok(runtimeTrends.some((trend) => trend.key === 'retention' && trend.primaryCount === 4), 'retention trend should expose pending prune history')
ok(runtimeTrends.some((trend) => trend.key === 'terminal-history' && trend.primaryCount === 10 && trend.tertiaryCount === 20), 'terminal history trend should summarize completed, failed, and cancelled runs')

const runtimeThresholdGuidance = buildWorkflowRuntimeThresholdGuidance(runtimeHealth)
equal(runtimeThresholdGuidance.length, 5, 'workflow runtime observability should expose five threshold guidance records')
ok(runtimeThresholdGuidance.some((guidance) => guidance.key === 'queue-pressure-threshold' && guidance.currentCount === 3 && guidance.thresholdCount === 1 && guidance.tone === 'attention'), 'queue threshold guidance should compare active queue pressure with concurrency')
ok(runtimeThresholdGuidance.some((guidance) => guidance.key === 'retry-stop-threshold' && guidance.currentCount === 2 && guidance.tone === 'attention'), 'retry threshold guidance should flag stopped schedules')
ok(runtimeThresholdGuidance.some((guidance) => guidance.key === 'recovery-mismatch-threshold' && guidance.currentCount === 2), 'recovery threshold guidance should carry mismatch counts')
ok(runtimeThresholdGuidance.some((guidance) => guidance.key === 'retention-approval-threshold' && guidance.approvalBoundary === 'approval-required'), 'retention threshold guidance should keep cleanup approval-owned')
ok(runtimeThresholdGuidance.some((guidance) => guidance.key === 'terminal-failure-threshold' && guidance.currentCount === 20 && guidance.thresholdCount === 20), 'terminal failure threshold guidance should carry the local failure-rate threshold')

const runtimeDecisionCues = buildWorkflowRuntimeDecisionCues(runtimeHealth)
equal(runtimeDecisionCues.length, 5, 'workflow runtime should expose five decision cues')
ok(runtimeDecisionCues.some((cue) => cue.key === 'queue-rerun-readiness' && cue.action === 'review-before-rerun' && cue.secondaryCount === 4), 'queue decision cue should require review before rerun when pressure is present')
ok(runtimeDecisionCues.some((cue) => cue.key === 'autorun-stop-review' && cue.action === 'review-before-rerun' && cue.primaryCount === 2), 'autorun decision cue should surface stopped schedule review')
ok(runtimeDecisionCues.some((cue) => cue.key === 'recovery-output-review' && cue.action === 'review-before-rerun' && cue.primaryCount === 2), 'recovery decision cue should link mismatches to output review')
ok(runtimeDecisionCues.some((cue) => cue.key === 'retention-cleanup-approval' && cue.action === 'approval-required' && cue.approvalBoundary === 'approval-required'), 'retention decision cue should keep cleanup approval-owned')
ok(runtimeDecisionCues.some((cue) => cue.key === 'terminal-error-review' && cue.primaryCount === 20 && cue.secondaryCount === 4), 'terminal decision cue should expose failure percent and non-success history')

const runtimeRunbookEvidence = buildWorkflowRuntimeRunbookEvidence(runtimeHealth)
equal(runtimeRunbookEvidence.length, 3, 'workflow runtime should expose three runbook evidence records')
ok(runtimeRunbookEvidence.some((evidence) => evidence.key === 'rerun-readiness-evidence' && evidence.action === 'review-before-rerun' && evidence.guardrailCount === 12), 'rerun evidence should collect queue, stop, recovery, and terminal guardrails')
ok(runtimeRunbookEvidence.some((evidence) => evidence.key === 'rollback-handoff-evidence' && evidence.action === 'approval-required' && evidence.approvalBoundary === 'approval-required'), 'rollback evidence should keep rollback/restart execution approval-owned')
ok(runtimeRunbookEvidence.some((evidence) => evidence.key === 'stop-condition-evidence' && evidence.evidenceCount === 5), 'stop condition evidence should include stopped schedules, cancellations, and recent failures')

const root = process.cwd()
const mediaReviewPage = readFileSync(join(root, 'src/features/media-review/media-review-page.tsx'), 'utf8')
const workflowRunnerPanel = readFileSync(join(root, 'src/features/module-graph/components/workflow-runner-panel.tsx'), 'utf8')

ok(mediaReviewPage.includes('data-media-review-operational-trends="true"'), 'media review page should render operational trend history')
ok(mediaReviewPage.includes('data-media-review-trend={trend.key}'), 'media review trend rows should be identifiable')
ok(mediaReviewPage.includes('data-media-review-threshold-guidance="true"'), 'media review page should render threshold guidance')
ok(mediaReviewPage.includes('data-media-review-threshold={guidance.key}'), 'media review threshold rows should be identifiable')
ok(workflowRunnerPanel.includes('data-workflow-runtime-observability-trends="true"'), 'workflow runner should render runtime observability trends')
ok(workflowRunnerPanel.includes('data-workflow-runtime-trend={trend.key}'), 'workflow runtime trend rows should be identifiable')
ok(workflowRunnerPanel.includes('data-workflow-runtime-threshold-guidance="true"'), 'workflow runner should render threshold guidance')
ok(workflowRunnerPanel.includes('data-workflow-runtime-threshold={guidance.key}'), 'workflow runtime threshold rows should be identifiable')
ok(workflowRunnerPanel.includes('data-workflow-runtime-decision-surface="true"'), 'workflow runner should render runtime decision cues')
ok(workflowRunnerPanel.includes('data-workflow-runtime-decision-cue={cue.key}'), 'workflow runtime decision cue rows should be identifiable')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeObservabilityTrends(runtimeHealth)'), 'workflow runner should derive trends from existing runtime health boundaries')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeThresholdGuidance(runtimeHealth)'), 'workflow runner should derive threshold guidance from existing runtime health boundaries')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeDecisionCues(runtimeHealth)'), 'workflow runner should derive decision cues from existing runtime health boundaries')
ok(workflowRunnerPanel.includes('data-workflow-runtime-runbook-evidence="true"'), 'workflow runner should render runbook evidence')
ok(workflowRunnerPanel.includes('data-workflow-runtime-runbook-evidence-card={evidence.key}'), 'workflow runbook evidence rows should be identifiable')
ok(workflowRunnerPanel.includes('buildWorkflowRuntimeRunbookEvidence(runtimeHealth)'), 'workflow runner should derive runbook evidence from existing runtime health boundaries')
ok(!mediaReviewPage.includes('deleteImages('), 'media runtime observability should not add destructive media cleanup')
ok(!workflowRunnerPanel.includes('deleteImages('), 'workflow runtime decision surface should not add destructive cleanup')

console.log('Media/runtime observability contracts verified.')
