import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildReleaseReadinessHandoffMarkdown,
  buildReleaseReadinessHistoryRecord,
} from '../features/settings/release-readiness-history'

const root = process.cwd()
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')
const historyContract = readFileSync(join(root, 'src/features/settings/release-readiness-history.ts'), 'utf8')
const riskDashboardDoc = readFileSync(join(root, '../docs/systems/media-runtime-release-risk-dashboard-contracts.md'), 'utf8')
const rootPackageJson = readFileSync(join(root, '../package.json'), 'utf8')
const frontendPackageJson = readFileSync(join(root, 'package.json'), 'utf8')

const releaseRiskDashboardItems = [
  {
    id: 'media-quality-release-blocker',
    axis: 'media-review' as const,
    severity: 'high' as const,
    title: { ko: '미디어 품질 release blocker', en: 'Media quality release blocker' },
    evidenceAnchor: 'review-backlog-before-cleanup + similarity-cleanup-approval-gate',
    releaseRisk: { ko: '정리 판단 혼선', en: 'Cleanup decision ambiguity' },
    mitigation: { ko: '비파괴 staging export', en: 'Non-destructive staging export' },
    approvalBoundary: 'approval-required' as const,
  },
  {
    id: 'runtime-rerun-release-stop-condition',
    axis: 'workflow-runtime' as const,
    severity: 'high' as const,
    title: { ko: 'runtime rerun release stop condition', en: 'Runtime rerun release stop condition' },
    evidenceAnchor: 'runtime-rerun-readiness-review + runtime-retention-terminal-gate',
    releaseRisk: { ko: '재실행 판단 선행', en: 'Premature rerun judgment' },
    mitigation: { ko: 'recovery handoff 비교', en: 'Compare recovery handoff first' },
    approvalBoundary: 'operator-review' as const,
  },
]

const record = buildReleaseReadinessHistoryRecord({
  id: 'media-runtime-release-risk-record',
  savedAt: '2026-06-11T02:00:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: [],
  capturedHandoffItemIds: [],
  reviewedAlertIds: [],
  reviewItems: [],
  evidenceItems: [],
  alertReviewItems: [],
  trendEvidenceItems: [],
  automationContextItems: [],
  mediaRuntimeTriageQueueItems: [],
  releaseRiskDashboardItems,
  reviewedReleaseRiskDashboardIds: ['media-quality-release-blocker'],
  evidenceReviewItems: [],
  handoffItems: [],
  runbookGuardrails: [],
  operationSteps: [],
  userDecisions: [],
})

equal(record.summary.releaseRiskDashboardItemCount, 2, 'history summary should count release risk dashboard items')
equal(record.summary.releaseRiskDashboardHighCount, 2, 'history summary should count high-severity release risks')
equal(record.summary.reviewedReleaseRiskDashboardCount, 1, 'history summary should count reviewed release risks')
equal(record.releaseRiskDashboard[0]?.status, 'reviewed', 'risk dashboard should preserve operator review state')
equal(record.releaseRiskDashboard[0]?.approvalBoundary, 'approval-required', 'risk dashboard should preserve approval boundaries')
const markdown = buildReleaseReadinessHandoffMarkdown(record)
ok(markdown.includes('## Media Runtime Release Risk Dashboard'), 'handoff markdown should export the release risk dashboard section')
ok(markdown.includes('Runtime rerun release stop condition'), 'handoff markdown should include runtime stop-condition risk')
ok(releaseReadinessTab.includes('RELEASE_RISK_DASHBOARD_ITEMS'), 'release readiness UI should define release risk dashboard items')
ok(releaseReadinessTab.includes('data-media-runtime-release-risk-dashboard="true"'), 'release readiness UI should expose the risk dashboard surface')
ok(releaseReadinessTab.includes('data-media-runtime-release-risk-dashboard-summary="true"'), 'risk dashboard should expose a summary row')
ok(releaseReadinessTab.includes('data-media-runtime-release-risk-dashboard-item={item.id}'), 'risk cards should be individually addressable')
ok(releaseReadinessTab.includes('releaseRiskDashboardHighCount'), 'risk dashboard should count high-severity risks')
ok(releaseReadinessTab.includes('releaseRiskDashboardApprovalCount'), 'risk dashboard should count approval-required risks')
ok(releaseReadinessTab.includes('reviewedReleaseRiskDashboard'), 'risk dashboard should track operator-reviewed risks')
ok(releaseReadinessTab.includes('toggleReleaseRiskDashboardItem'), 'risk dashboard should allow per-card review toggles')
ok(releaseReadinessTab.includes("'media-quality-release-blocker'"), 'risk dashboard should include media quality blocker')
ok(releaseReadinessTab.includes("'runtime-rerun-release-stop-condition'"), 'risk dashboard should include runtime stop condition')
ok(historyContract.includes('ReleaseReadinessReleaseRiskDashboardContract'), 'history contract should type release risk dashboard records')
ok(historyContract.includes('releaseRiskDashboard'), 'history records should persist release risk dashboard cards')
ok(riskDashboardDoc.includes('Media/runtime release risk dashboard contracts'), 'system doc should describe the risk dashboard contract')
ok(riskDashboardDoc.includes('No external side effects'), 'system doc should preserve local-only boundaries')
ok(rootPackageJson.includes('"verify:media-runtime-release-risk-dashboard-contracts"'), 'root package should expose the release risk verifier')
ok(frontendPackageJson.includes('"verify:media-runtime-release-risk-dashboard-contracts"'), 'frontend package should expose the release risk verifier')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'release risk dashboard must not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'release risk dashboard must not perform external actions')

console.log('Media/runtime release risk dashboard contracts verified.')
