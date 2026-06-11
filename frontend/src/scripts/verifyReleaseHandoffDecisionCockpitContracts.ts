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
const cockpitDoc = readFileSync(join(root, '../docs/systems/release-handoff-decision-cockpit-contracts.md'), 'utf8')

const decisionCockpitItems = [
  {
    id: 'verification-baseline',
    lane: 'local-verification' as const,
    title: { ko: '로컬 검증 baseline', en: 'Local verification baseline' },
    source: 'npm run build + npm run verify:release-readiness + git diff --check',
    decisionQuestion: { ko: '로컬 근거 최신 여부', en: 'Local evidence currency' },
    localEvidence: 'canonical local checks only',
    boundary: 'local-evidence' as const,
  },
  {
    id: 'approval-gate-register',
    lane: 'approval-gate' as const,
    title: { ko: '승인 게이트 등록부', en: 'Approval gate register' },
    source: 'USER_DECISIONS + OPERATION_STEPS + RUNBOOK_GUARDRAILS',
    decisionQuestion: { ko: '사용자 결정 분리 여부', en: 'User decision separation' },
    localEvidence: 'approval-required boundaries remain visible',
    boundary: 'approval-required' as const,
  },
]

const record = buildReleaseReadinessHistoryRecord({
  id: 'decision-cockpit-record',
  savedAt: '2026-06-11T00:30:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: [],
  capturedHandoffItemIds: [],
  reviewedAlertIds: [],
  reviewItems: [],
  evidenceItems: [],
  decisionCockpitItems,
  alertReviewItems: [],
  trendEvidenceItems: [],
  automationContextItems: [],
  evidenceReviewItems: [],
  handoffItems: [],
  runbookGuardrails: [],
  operationSteps: [],
  userDecisions: [],
})

equal(record.summary.decisionCockpitItemCount, 2, 'history summary should count decision cockpit cards')
equal(record.decisionCockpit[1]?.boundary, 'approval-required', 'decision cockpit should preserve approval boundaries')
const markdown = buildReleaseReadinessHandoffMarkdown(record)
ok(markdown.includes('## Release Handoff Decision Cockpit'), 'handoff markdown should export the decision cockpit section')
ok(markdown.includes('Approval gate register'), 'handoff markdown should include approval gate evidence')
ok(releaseReadinessTab.includes('DECISION_COCKPIT_ITEMS'), 'release readiness UI should define decision cockpit cards')
ok(releaseReadinessTab.includes('data-release-handoff-decision-cockpit="true"'), 'release readiness UI should expose the decision cockpit surface')
ok(releaseReadinessTab.includes('data-release-handoff-decision-cockpit-summary="true"'), 'decision cockpit should expose an operator summary row')
ok(releaseReadinessTab.includes('data-release-handoff-decision-cockpit-boundary-summary="true"'), 'decision cockpit should summarize local/operator/approval boundaries')
ok(releaseReadinessTab.includes('data-release-readiness-selected-cockpit-boundaries="true"'), 'saved handoff output should preserve selected cockpit boundary summaries')
ok(releaseReadinessTab.includes('selectedDecisionCockpitBoundaryState'), 'selected handoff output should compute persisted cockpit approval/operator/local counts')
ok(releaseReadinessTab.includes('data-release-handoff-decision-cockpit-item={item.id}'), 'decision cockpit cards should be individually addressable')
ok(releaseReadinessTab.includes('decisionCockpitApprovalCount'), 'decision cockpit should count approval-required cards for operators')
ok(releaseReadinessTab.includes('decisionCockpitOperatorReviewCount'), 'decision cockpit should count operator-review cards for operators')
ok(releaseReadinessTab.includes("'local-commit-range'"), 'decision cockpit should include local commit range review')
ok(releaseReadinessTab.includes("'demo-host-readiness'"), 'decision cockpit should include demo host readiness review')
ok(releaseReadinessTab.includes("'caveat-triage-snapshot'"), 'decision cockpit should include caveat triage review')
ok(releaseReadinessTab.includes("'handoff-export-packet'"), 'decision cockpit should include handoff export review')
ok(historyContract.includes('ReleaseReadinessDecisionCockpitItemContract'), 'history contract should type decision cockpit records')
ok(historyContract.includes('decisionCockpit'), 'history records should persist decision cockpit cards')
ok(cockpitDoc.includes('Release handoff decision cockpit'), 'system doc should describe the cockpit')
ok(cockpitDoc.includes('demo host'), 'system doc should describe demo host readiness boundaries')
ok(cockpitDoc.includes('No external side effects'), 'system doc should preserve local-only boundaries')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'decision cockpit must not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'decision cockpit must not perform external release actions')

console.log('Release handoff decision cockpit contracts verified.')
