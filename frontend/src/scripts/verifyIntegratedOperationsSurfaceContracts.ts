import { ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')
const operatorEvidenceConsoleDoc = readFileSync(join(root, '../docs/systems/operator-evidence-review-console.md'), 'utf8')
const mediaReviewPage = readFileSync(join(root, 'src/features/media-review/media-review-page.tsx'), 'utf8')
const mediaReviewUtils = readFileSync(join(root, 'src/features/media-review/media-review-utils.ts'), 'utf8')
const workflowRunnerPanel = readFileSync(join(root, 'src/features/module-graph/components/workflow-runner-panel.tsx'), 'utf8')
const moduleGraphApi = readFileSync(join(root, 'src/lib/api-module-graph.ts'), 'utf8')

ok(releaseReadinessTab.includes('data-integrated-operations-surface="true"'), 'release readiness should expose an integrated operations surface')
ok(releaseReadinessTab.includes('data-release-readiness-operator-evidence-console="true"'), 'integrated readiness should include an operator evidence review console')
ok(releaseReadinessTab.includes('data-release-readiness-export-state="true"'), 'readiness workspace should expose export-readiness state for operator polish')
ok(releaseReadinessTab.includes('setCapturedHandoffItems(new Set(HANDOFF_EVIDENCE_ITEMS.map((item) => item.id)))'), 'handoff evidence should support one-click operator marking')
ok(releaseReadinessTab.includes('INTEGRATED_OPERATIONS_LANES'), 'integrated surface should be driven by explicit operation lanes')
ok(releaseReadinessTab.includes("'release-handoff'"), 'integrated surface should include release handoff readiness')
ok(releaseReadinessTab.includes("'media-intelligence'"), 'integrated surface should include media intelligence readiness')
ok(releaseReadinessTab.includes("'workflow-runtime'"), 'integrated surface should include workflow runtime readiness')
ok(releaseReadinessTab.includes('data-integrated-operations-lane={lane.id}'), 'integrated lanes should be identifiable for contract checks')
ok(releaseReadinessTab.includes('data-integrated-operations-gates="true"'), 'integrated surface should expose decision gates')
ok(releaseReadinessTab.includes("'release-evidence-ready'"), 'decision gates should require release evidence before external action')
ok(releaseReadinessTab.includes("'media-quality-before-cleanup'"), 'decision gates should keep media quality before cleanup')
ok(releaseReadinessTab.includes("'runtime-health-before-rerun'"), 'decision gates should require runtime health before reruns')
ok(releaseReadinessTab.includes('recommended queues') && releaseReadinessTab.includes('tag quality suggestions'), 'media lane should reference recommendation and tag quality signals')
ok(releaseReadinessTab.includes('group quality checks') && releaseReadinessTab.includes('similarity decision history'), 'media lane should reference group and similarity review evidence')
ok(releaseReadinessTab.includes('reversible cleanup staging') && releaseReadinessTab.includes('destructive cleanup excluded'), 'media lane should separate reversible staging from destructive cleanup')
ok(releaseReadinessTab.includes('queue health') && releaseReadinessTab.includes('retry policy'), 'workflow lane should reference queue and retry state')
ok(releaseReadinessTab.includes('artifact retention') && releaseReadinessTab.includes('recovery telemetry'), 'workflow lane should reference retention and recovery telemetry')
ok(releaseReadinessTab.includes('alpha/demo/restart/cleanup approvals'), 'release lane should separate user-owned release decisions')

ok(mediaReviewPage.includes('data-media-review-intelligence-panel="true"'), 'media review page should still render the intelligence panel linked by the operations surface')
ok(mediaReviewPage.includes('data-media-review-cleanup-staging="true"'), 'media review page should still expose reversible cleanup staging')
ok(mediaReviewUtils.includes('getMediaReviewRecommendedQueues') && mediaReviewUtils.includes('getMediaReviewTagQualitySuggestions'), 'media utilities should provide recommendation and tag quality contracts')
ok(mediaReviewUtils.includes('buildMediaReviewCleanupStagingPlan') && mediaReviewUtils.includes('destructiveCount'), 'media utilities should keep cleanup staging non-destructive')

ok(moduleGraphApi.includes('export async function getGraphWorkflowRuntimeHealth'), 'module graph API should expose runtime health reads')
ok(workflowRunnerPanel.includes('function WorkflowRuntimeHealthBlock'), 'workflow runner should render runtime health evidence')
ok(workflowRunnerPanel.includes('runtimeHealth.queue.retry_timer_pending'), 'workflow runtime health should expose retry timer state')
ok(workflowRunnerPanel.includes('runtimeHealth.retention.output_retention_limit'), 'workflow runtime health should expose artifact retention state')
ok(workflowRunnerPanel.includes('runtimeHealth.recovery.running_not_in_process_count'), 'workflow runtime health should expose recovery telemetry')

ok(!releaseReadinessTab.includes('buildApiUrl('), 'integrated operations surface should not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'integrated operations surface should not perform external release actions')
ok(!releaseReadinessTab.includes('deleteImages('), 'integrated operations surface should not perform destructive media cleanup')
ok(releaseReadinessTab.includes('new Blob([selectedHandoffMarkdown]'), 'handoff export should be local generated Markdown only')
ok(releaseReadinessTab.includes('triggerBlobDownload'), 'integrated operations surface should support local handoff export without backend actions')

ok(operatorEvidenceConsoleDoc.includes('This note records the local-safe operator workflow'), 'operator evidence console docs should explain the local-safe operator workflow')
ok(operatorEvidenceConsoleDoc.includes('It must not call MCP tools'), 'operator evidence console docs should preserve MCP and external-action boundaries')
ok(operatorEvidenceConsoleDoc.includes('Confirm the export readiness badge'), 'operator evidence console docs should cover the polished export-readiness operator flow')

console.log('Integrated operations surface contracts verified.')
