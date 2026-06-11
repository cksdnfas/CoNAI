import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildReleaseReadinessHandoffFilename,
  buildReleaseReadinessHandoffMarkdown,
  buildReleaseReadinessHistoryRecord,
  MAX_RELEASE_READINESS_HISTORY_RECORDS,
  readReleaseReadinessHistoryFromStorage,
  RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
  RELEASE_READINESS_HISTORY_STORAGE_KEY,
  saveReleaseReadinessHistoryRecord,
} from '../features/settings/release-readiness-history'

const root = process.cwd()
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')
const historyContract = readFileSync(join(root, 'src/features/settings/release-readiness-history.ts'), 'utf8')

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const reviewItems = [
  {
    id: 'completed-work',
    title: { ko: '완료 작업 검토', en: 'Completed work reviewed' },
    description: { ko: '완료 작업 확인', en: 'Completed work check' },
  },
  {
    id: 'evidence',
    title: { ko: '검증 근거 확인', en: 'Evidence checked' },
    description: { ko: '검증 근거 연결', en: 'Evidence is linked' },
  },
]

const evidenceItems = [
  {
    id: 'release-check',
    label: { ko: '릴리즈 점검', en: 'Release check' },
    value: 'npm run verify:release-readiness',
    detail: { ko: '로컬 검증', en: 'Local verification' },
    tone: 'ready' as const,
  },
]

const handoffItems = [
  {
    id: 'smoke-evidence',
    title: { ko: '스모크 근거 번들', en: 'Smoke evidence bundle' },
    artifact: 'npm run verify:release-readiness + live target smoke notes',
    detail: { ko: '스모크 계획 분리', en: 'Smoke planning stays separate' },
  },
  {
    id: 'rollback-plan',
    title: { ko: '롤백 준비 기록', en: 'Rollback preparation record' },
    artifact: 'rollback notes: previous commit, service target, protected port 3999',
    detail: { ko: '재시작 전 확인', en: 'Check before restart' },
  },
]

const alertReviewItems = [
  {
    id: 'media-review-queue',
    domain: 'media-review' as const,
    title: { ko: '미디어 검토 큐', en: 'Media review queue' },
    signal: { ko: '미검토 항목 backlog', en: 'Unreviewed item backlog' },
    sourceSurface: 'Media review > operational trends',
    thresholdKey: 'review-queue-threshold',
    detail: { ko: '운영 검토 상태만 저장', en: 'Saved as operator-review state only' },
    approvalBoundary: 'operator-review' as const,
  },
  {
    id: 'runtime-retention',
    domain: 'workflow-runtime' as const,
    title: { ko: '산출물 보존', en: 'Artifact retention' },
    signal: { ko: 'pending retention prune', en: 'Pending retention prune' },
    sourceSurface: 'Module graph > artifact retention',
    thresholdKey: 'retention-approval-threshold',
    detail: { ko: '삭제나 보존 정책 변경은 승인 필요', en: 'Deletion or retention policy changes require approval' },
    approvalBoundary: 'approval-required' as const,
  },
]

const trendEvidenceItems = [
  {
    id: 'dependency-audit-trend',
    domain: 'dependency-security' as const,
    title: { ko: '의존성 보안 추세', en: 'Dependency security trend' },
    sourceSurface: 'npm audit + npm --prefix docs audit',
    metric: 'vulnerability-count-trend',
    trend: { ko: 'audit 기준선 clean', en: 'Audit baseline is clean' },
    exportValue: 'M1-CU1/M1-CU2 dependency audit lanes are clean',
    releaseUse: { ko: '릴리즈 보안 근거', en: 'Release security evidence' },
    approvalBoundary: 'local-evidence' as const,
  },
  {
    id: 'release-handoff-trend',
    domain: 'release-operations' as const,
    title: { ko: '릴리즈 핸드오프 추세', en: 'Release handoff trend' },
    sourceSurface: 'Settings > Release readiness',
    metric: 'captured-handoff-readiness',
    trend: { ko: 'push/restart 없이 누적', en: 'Accumulates without push or restart' },
    exportValue: 'handoff Markdown includes approval gates',
    releaseUse: { ko: '사용자 승인 판단', en: 'User approval decision' },
    approvalBoundary: 'approval-required' as const,
  },
]

const localEvidenceExportItems = [
  {
    id: 'readiness-markdown-bundle',
    bundle: { ko: 'readiness Markdown bundle', en: 'Readiness Markdown bundle' },
    sourceSurface: 'Settings > Release readiness Markdown export',
    exportCommand: 'buildReleaseReadinessHandoffMarkdown(record)',
    comparisonAnchor: 'release handoff decision cockpit + operator evidence console',
    hardeningContract: { ko: '로컬 Markdown 비교', en: 'Local Markdown comparison' },
    approvalBoundary: 'local-evidence' as const,
  },
  {
    id: 'mcp-dry-run-json-bundle',
    bundle: { ko: 'MCP dry-run JSON bundle', en: 'MCP dry-run JSON bundle' },
    sourceSurface: 'backend/src/mcp/mcpDryRunEvidence.ts',
    exportCommand: 'npm run export:mcp-dry-run-evidence',
    comparisonAnchor: 'docs/systems/agent-mcp-local-evidence-export.md',
    hardeningContract: { ko: 'MCP dry-run 비교', en: 'MCP dry-run comparison' },
    approvalBoundary: 'operator-review' as const,
  },
]

const evidenceReviewItems = [
  {
    id: 'mcp-dry-run-evidence-packet',
    sourceSurface: { ko: 'MCP dry-run evidence', en: 'MCP dry-run evidence' },
    evidenceAnchor: 'npm run export:mcp-dry-run-evidence',
    compares: { ko: 'tool boundary 비교', en: 'Tool boundary comparison' },
    operatorQuestion: { ko: '승인 범위 판단', en: 'Approval scope decision' },
    approvalBoundary: 'operator-review' as const,
  },
  {
    id: 'workflow-recovery-handoff-packet',
    sourceSurface: { ko: 'Workflow recovery handoff', en: 'Workflow recovery handoff' },
    evidenceAnchor: 'buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth)',
    compares: { ko: '복구 근거 비교', en: 'Recovery evidence comparison' },
    operatorQuestion: { ko: 'rerun과 rollback 경계 판단', en: 'Rerun and rollback boundary decision' },
    approvalBoundary: 'approval-required' as const,
  },
]

const automationContextItems = [
  {
    id: 'local-automation-context-map',
    surface: { ko: '로컬 자동화 컨텍스트 맵', en: 'Local automation context map' },
    contractAnchor: 'docs/systems/local-automation-context-operations-map.md',
    reviewUse: { ko: '같은 handoff 기준으로 검토', en: 'Review against the same handoff baseline' },
    boundary: 'local-evidence' as const,
  },
  {
    id: 'mcp-automation-opt-in',
    surface: { ko: 'MCP/에이전트 진입점', en: 'MCP and agent entry points' },
    contractAnchor: 'docs/GUIDE/MCP_GUIDE.md + backend/src/mcp/*',
    reviewUse: { ko: 'opt-in 문서 기준', en: 'Opt-in docs baseline' },
    boundary: 'opt-in-only' as const,
  },
]

const runbookGuardrails = [
  {
    id: 'protected-3999',
    phase: { ko: 'restart/smoke', en: 'Restart/smoke' },
    title: { ko: '보호 포트 3999 회피', en: 'Avoid protected port 3999' },
    status: { ko: '차단', en: 'Blocked' },
    description: { ko: '별도 승인 필요', en: 'Separate approval required' },
  },
]

const operationSteps = [
  {
    id: 'alpha-push',
    phase: { ko: 'alpha push', en: 'Alpha push' },
    approval: { ko: '사용자 승인 필요', en: 'User approval required' },
    command: 'git push origin alphatest',
    target: 'origin/alphatest',
    smokeAssertion: 'remote HEAD matches the approved commit',
    stopCondition: 'stop if the target or commit range differs',
  },
  {
    id: 'demo-host-update',
    phase: { ko: 'demo host 업데이트', en: 'Demo host update' },
    approval: { ko: '별도 승인 필요', en: 'Separate approval required' },
    command: 'git pull --ff-only origin alphatest',
    target: 'approved demo host only',
    smokeAssertion: 'demo host reaches the approved commit without touching service 3999',
    stopCondition: 'stop if fast-forward pull is unavailable',
  },
]

const userDecisions = [
  {
    id: 'alpha-push',
    title: { ko: 'alpha branch push 승인', en: 'Approve alpha branch push' },
    description: { ko: '사용자가 결정', en: 'User-owned decision' },
  },
]

const partialRecord = buildReleaseReadinessHistoryRecord({
  id: 'partial-record',
  savedAt: '2026-06-08T13:30:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: ['completed-work'],
  capturedHandoffItemIds: ['rollback-plan'],
  reviewedAlertIds: ['runtime-retention'],
  reviewedLocalEvidenceExportIds: ['mcp-dry-run-json-bundle'],
  reviewItems,
  evidenceItems,
  alertReviewItems,
  trendEvidenceItems,
  automationContextItems,
  evidenceReviewItems,
  localEvidenceExportItems,
  handoffItems,
  runbookGuardrails,
  operationSteps,
  userDecisions,
})

equal(partialRecord.schemaVersion, RELEASE_READINESS_HISTORY_SCHEMA_VERSION, 'history record should carry the schema version')
equal(partialRecord.source, 'settings.release-readiness', 'history record should identify the readiness workspace source')
equal(partialRecord.storageSurface, 'local-browser', 'history record should use the local browser storage surface')
equal(partialRecord.externalActionsExecuted, false, 'history record must not claim push/deploy/restart execution')
equal(partialRecord.pushDeployRestartBoundary, 'approval-required', 'external release actions should stay approval-owned')
equal(partialRecord.summary.reviewedCount, 1, 'reviewed item count should be preserved')
equal(partialRecord.summary.capturedHandoffCount, 1, 'captured handoff count should be preserved')
equal(partialRecord.summary.reviewedAlertCount, 1, 'reviewed alert count should be preserved')
equal(partialRecord.summary.trendEvidenceCount, 2, 'trend evidence count should be preserved')
equal(partialRecord.summary.readyForExport, false, 'partial records should not be marked export ready')
equal(partialRecord.automationContext.length, 2, 'automation context should persist with readiness records')
equal(partialRecord.automationContext[1]?.boundary, 'opt-in-only', 'MCP automation context should preserve opt-in-only boundary')
equal(partialRecord.evidenceReview.length, 2, 'operator evidence review items should persist with readiness records')
equal(partialRecord.localEvidenceExports.length, 2, 'local evidence export bundles should persist with readiness records')
equal(partialRecord.summary.localEvidenceExportCount, 2, 'local evidence export bundle count should persist')
equal(partialRecord.summary.reviewedLocalEvidenceExportCount, 1, 'reviewed local evidence export count should persist')
equal(partialRecord.localEvidenceExports.find((item) => item.id === 'mcp-dry-run-json-bundle')?.status, 'reviewed', 'reviewed local evidence export bundle status should persist')
equal(partialRecord.localEvidenceExports.find((item) => item.id === 'readiness-markdown-bundle')?.status, 'open', 'open local evidence export bundle status should persist')
equal(partialRecord.evidenceReview[1]?.approvalBoundary, 'approval-required', 'approval-gated evidence review boundaries should persist')
equal(partialRecord.checklist.find((item) => item.id === 'completed-work')?.status, 'checked', 'checked review status should persist')
equal(partialRecord.checklist.find((item) => item.id === 'evidence')?.status, 'open', 'open review status should persist')
equal(partialRecord.observabilityAlerts.find((item) => item.id === 'runtime-retention')?.status, 'reviewed', 'reviewed alert status should persist')
equal(partialRecord.observabilityAlerts.find((item) => item.id === 'media-review-queue')?.status, 'open', 'open alert status should persist')
equal(partialRecord.observabilityAlerts.find((item) => item.id === 'runtime-retention')?.approvalBoundary, 'approval-required', 'approval-required alert boundaries should persist')
equal(partialRecord.trendEvidence.find((item) => item.id === 'dependency-audit-trend')?.metric, 'vulnerability-count-trend', 'trend evidence metric should persist')
equal(partialRecord.trendEvidence.find((item) => item.id === 'release-handoff-trend')?.approvalBoundary, 'approval-required', 'approval-gated trend evidence should persist')
equal(partialRecord.handoff.find((item) => item.id === 'rollback-plan')?.status, 'captured', 'captured handoff status should persist')
equal(partialRecord.handoff.find((item) => item.id === 'smoke-evidence')?.status, 'open', 'open handoff status should persist')
equal(partialRecord.operationSteps.length, 2, 'approval-gated operation steps should persist')
equal(partialRecord.userDecisions[0]?.status, 'approval-required', 'user decisions should remain separate approval items')

const completeRecord = buildReleaseReadinessHistoryRecord({
  id: 'complete-record',
  savedAt: '2026-06-08T13:31:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: reviewItems.map((item) => item.id),
  capturedHandoffItemIds: handoffItems.map((item) => item.id),
  reviewedAlertIds: alertReviewItems.map((item) => item.id),
  reviewedLocalEvidenceExportIds: localEvidenceExportItems.map((item) => item.id),
  reviewItems,
  evidenceItems,
  alertReviewItems,
  trendEvidenceItems,
  automationContextItems,
  evidenceReviewItems,
  localEvidenceExportItems,
  handoffItems,
  runbookGuardrails,
  operationSteps,
  userDecisions,
})

equal(completeRecord.summary.readyForExport, true, 'complete evidence records should be ready for later export')

const handoffMarkdown = buildReleaseReadinessHandoffMarkdown(completeRecord)
ok(handoffMarkdown.includes('# CoNAI Release Readiness Handoff'), 'handoff export should have a stable title')
ok(handoffMarkdown.includes('- externalActionsExecuted: false'), 'handoff export should preserve the no-external-action boundary')
ok(handoffMarkdown.includes('- pushDeployRestartBoundary: approval-required'), 'handoff export should preserve approval boundaries')
ok(handoffMarkdown.includes('## Automation Context'), 'handoff export should include automation context separately')
ok(handoffMarkdown.includes('## Operator Evidence Review Console'), 'handoff export should include operator evidence review console separately')
ok(handoffMarkdown.includes('npm run export:mcp-dry-run-evidence'), 'handoff export should include MCP dry-run evidence anchors')
ok(handoffMarkdown.includes('docs/systems/local-automation-context-operations-map.md'), 'handoff export should include the local automation context map')
ok(handoffMarkdown.includes('opt in only'), 'handoff export should preserve opt-in-only automation boundaries')
ok(handoffMarkdown.includes('## Local Evidence Export Bundles'), 'handoff export should include local evidence export bundles separately')
ok(handoffMarkdown.includes('mcp-dry-run-evidence'), 'handoff export should include MCP dry-run JSON bundle evidence')
ok(handoffMarkdown.includes('## Captured Handoff Evidence'), 'handoff export should include captured handoff evidence separately')
ok(handoffMarkdown.includes('## Observability Alert Review'), 'handoff export should include observability alert review separately')
ok(handoffMarkdown.includes('retention-approval-threshold'), 'handoff export should include runtime retention alert evidence')
ok(handoffMarkdown.includes('approval required'), 'handoff export should preserve approval-required alert boundaries')
ok(handoffMarkdown.includes('## Trend Evidence'), 'handoff export should include trend evidence separately')
ok(handoffMarkdown.includes('vulnerability-count-trend'), 'handoff export should include dependency audit trend evidence')
ok(handoffMarkdown.includes('captured-handoff-readiness'), 'handoff export should include release handoff trend evidence')
ok(handoffMarkdown.includes('## Approval-Gated Operation Checklist'), 'handoff export should include the approval-gated operation checklist')
ok(handoffMarkdown.includes('git push origin alphatest'), 'handoff export should include the alpha push command for later approval')
ok(handoffMarkdown.includes('## User-Owned Decisions'), 'handoff export should separate user-owned release decisions')
ok(handoffMarkdown.includes('alpha branch push'), 'handoff export should carry user decision details')
equal(buildReleaseReadinessHandoffFilename(completeRecord), 'conai-release-readiness-20260608133100.md', 'handoff export filename should derive from savedAt')

const storage = new MemoryStorage()
saveReleaseReadinessHistoryRecord(partialRecord, storage)
saveReleaseReadinessHistoryRecord(completeRecord, storage)
const savedDocument = readReleaseReadinessHistoryFromStorage(storage)

equal(savedDocument.records.length, 2, 'history document should keep saved records')
equal(savedDocument.records[0]?.id, 'complete-record', 'newest saved record should be first')
deepEqual(savedDocument.records[0]?.capturedHandoffItemIds, ['smoke-evidence', 'rollback-plan'], 'handoff item ids should keep contract order')
deepEqual(savedDocument.records[0]?.reviewedLocalEvidenceExportIds, ['readiness-markdown-bundle', 'mcp-dry-run-json-bundle'], 'local evidence export review ids should keep contract order')

for (let index = 0; index < MAX_RELEASE_READINESS_HISTORY_RECORDS + 3; index += 1) {
  saveReleaseReadinessHistoryRecord(
    buildReleaseReadinessHistoryRecord({
      id: `record-${index}`,
      savedAt: new Date(Date.UTC(2026, 5, 9, 0, index)).toISOString(),
      appVersionLabel: '26.6.3',
      reviewedItemIds: [],
      capturedHandoffItemIds: [],
      reviewedAlertIds: [],
      reviewedLocalEvidenceExportIds: [],
      reviewItems,
      evidenceItems,
      alertReviewItems,
      trendEvidenceItems,
      automationContextItems,
      evidenceReviewItems,
      localEvidenceExportItems,
      handoffItems,
      runbookGuardrails,
      operationSteps,
      userDecisions,
    }),
    storage,
  )
}

const cappedDocument = readReleaseReadinessHistoryFromStorage(storage)
equal(cappedDocument.records.length, MAX_RELEASE_READINESS_HISTORY_RECORDS, 'history document should cap retained records')
equal(cappedDocument.records[0]?.id, `record-${MAX_RELEASE_READINESS_HISTORY_RECORDS + 2}`, 'history cap should keep newest records first')

storage.setItem(RELEASE_READINESS_HISTORY_STORAGE_KEY, '{not-json')
equal(readReleaseReadinessHistoryFromStorage(storage).records.length, 0, 'corrupt local history should fail closed')

ok(releaseReadinessTab.includes('data-release-readiness-history-contract="true"'), 'release readiness UI should expose the history contract surface')
ok(releaseReadinessTab.includes('data-release-readiness-alert-review="true"'), 'release readiness UI should expose the observability alert review surface')
ok(releaseReadinessTab.includes('ALERT_REVIEW_ITEMS'), 'release readiness UI should define persisted alert review items')
ok(releaseReadinessTab.includes('data-release-readiness-trend-evidence="true"'), 'release readiness UI should expose the trend evidence surface')
ok(releaseReadinessTab.includes('TREND_EVIDENCE_ITEMS'), 'release readiness UI should define exportable trend evidence')
ok(releaseReadinessTab.includes("'dependency-audit-trend'"), 'trend evidence should include dependency audit status')
ok(releaseReadinessTab.includes("'release-handoff-trend'"), 'trend evidence should include release handoff status')
ok(releaseReadinessTab.includes("'media-review-trend'"), 'trend evidence should include media review status')
ok(releaseReadinessTab.includes("'workflow-runtime-trend'"), 'trend evidence should include workflow runtime status')
ok(releaseReadinessTab.includes("'final-verification-trend'"), 'trend evidence should include final verification status')
ok(releaseReadinessTab.includes('data-release-readiness-automation-context="true"'), 'release readiness UI should expose automation context handoff')
ok(releaseReadinessTab.includes('data-release-readiness-operator-evidence-console="true"'), 'release readiness UI should expose operator evidence review console')
ok(releaseReadinessTab.includes('data-local-evidence-export-hardening="true"'), 'release readiness UI should expose local evidence export hardening')
ok(releaseReadinessTab.includes('data-local-evidence-export-hardening-summary="true"'), 'local evidence export hardening should expose an operator summary row')
ok(releaseReadinessTab.includes('reviewedLocalEvidenceExportIds'), 'release readiness UI should persist reviewed local evidence export ids')
ok(releaseReadinessTab.includes('toggleLocalEvidenceExportItem'), 'release readiness UI should let operators review export bundles')
ok(releaseReadinessTab.includes('OPERATOR_EVIDENCE_REVIEW_ITEMS'), 'release readiness UI should define operator evidence review items')
ok(releaseReadinessTab.includes('LOCAL_EVIDENCE_EXPORT_ITEMS'), 'release readiness UI should define local evidence export bundles')
ok(releaseReadinessTab.includes('AUTOMATION_CONTEXT_ITEMS'), 'release readiness UI should define automation context items')
ok(releaseReadinessTab.includes("'local-automation-context-map'"), 'automation context should include the local context map')
ok(releaseReadinessTab.includes("'mcp-automation-opt-in'"), 'automation context should include MCP opt-in entry points')
ok(releaseReadinessTab.includes("'review-queue-threshold'"), 'alert review should persist media review queue threshold state')
ok(releaseReadinessTab.includes("'quality-backlog-threshold'"), 'alert review should persist quality backlog threshold state')
ok(releaseReadinessTab.includes("'similarity-review-threshold'"), 'alert review should persist similarity decision threshold state')
ok(releaseReadinessTab.includes("'cleanup-approval-threshold'"), 'alert review should keep cleanup staging approval-gated')
ok(releaseReadinessTab.includes("'queue-pressure-threshold'"), 'alert review should persist workflow queue pressure threshold state')
ok(releaseReadinessTab.includes("'retry-stop-threshold'"), 'alert review should persist retry stop threshold state')
ok(releaseReadinessTab.includes("'recovery-mismatch-threshold'"), 'alert review should persist recovery mismatch threshold state')
ok(releaseReadinessTab.includes("'retention-approval-threshold'"), 'alert review should persist retention approval threshold state')
ok(releaseReadinessTab.includes("'terminal-failure-threshold'"), 'alert review should persist terminal failure threshold state')
ok(releaseReadinessTab.includes('data-release-readiness-runbook-export="true"'), 'release readiness UI should expose the runbook export surface')
ok(releaseReadinessTab.includes('data-release-readiness-handoff-output="true"'), 'release readiness UI should expose the handoff output surface')
ok(releaseReadinessTab.includes('saveReleaseReadinessHistoryRecord'), 'release readiness UI should save evidence snapshots')
ok(releaseReadinessTab.includes('readReleaseReadinessHistoryFromStorage'), 'release readiness UI should restore saved evidence snapshots')
ok(releaseReadinessTab.includes('RELEASE_READINESS_HISTORY_SCHEMA_VERSION'), 'release readiness UI should show the active history schema')
ok(releaseReadinessTab.includes('buildReleaseReadinessHandoffMarkdown'), 'release readiness UI should render a local handoff export')
ok(releaseReadinessTab.includes('copyTextToClipboard'), 'release readiness UI should support copying handoff output')
ok(releaseReadinessTab.includes('triggerBlobDownload'), 'release readiness UI should support local Markdown export')
ok(historyContract.includes('externalActionsExecuted: false'), 'history contract should explicitly prevent external action execution evidence')
ok(historyContract.includes("pushDeployRestartBoundary: 'approval-required'"), 'history contract should preserve release-action approval boundaries')
ok(historyContract.includes('operationSteps'), 'history contract should persist operation checklist steps')
ok(historyContract.includes('observabilityAlerts'), 'history contract should persist observability alert review items')
ok(historyContract.includes('reviewedAlertIds'), 'history contract should persist reviewed alert ids')
ok(historyContract.includes('trendEvidence'), 'history contract should persist trend evidence items')
ok(historyContract.includes('automationContext'), 'history contract should persist automation context items')
ok(historyContract.includes('evidenceReview'), 'history contract should persist operator evidence review items')
ok(historyContract.includes('localEvidenceExports'), 'history contract should persist local evidence export bundles')
ok(historyContract.includes('reviewedLocalEvidenceExportIds'), 'history contract should persist reviewed local evidence export ids')
ok(historyContract.includes('ReleaseReadinessLocalEvidenceExportContract'), 'history contract should type local evidence export bundles')
ok(historyContract.includes('ReleaseReadinessTrendEvidenceContract'), 'history contract should type trend evidence records')
ok(historyContract.includes('ReleaseReadinessAutomationContextContract'), 'history contract should type automation context records')
ok(historyContract.includes('ReleaseReadinessEvidenceReviewContract'), 'history contract should type operator evidence review records')
ok(historyContract.includes('buildReleaseReadinessHandoffMarkdown'), 'history contract should own handoff markdown formatting')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'history capture should not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'history capture should not perform external release actions')

console.log('Release readiness history contracts verified.')
