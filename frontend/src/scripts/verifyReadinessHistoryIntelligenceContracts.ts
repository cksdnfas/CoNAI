import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildReleaseReadinessHandoffMarkdown,
  buildReleaseReadinessHistoryIntelligenceSummary,
  buildReleaseReadinessHistoryRecord,
} from '../features/settings/release-readiness-history'

const root = process.cwd()
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')
const historyContract = readFileSync(join(root, 'src/features/settings/release-readiness-history.ts'), 'utf8')
const intelligenceDoc = readFileSync(join(root, '../docs/systems/readiness-history-intelligence-contracts.md'), 'utf8')
const frontendPackageJson = readFileSync(join(root, 'package.json'), 'utf8')

const readinessIntelligenceItems = [
  {
    id: 'release-handoff-priority',
    domain: 'release-operations' as const,
    sourceSurface: 'Settings > Release readiness history',
    priority: 'high' as const,
    title: { ko: '릴리즈 핸드오프 우선순위', en: 'Release handoff priority' },
    caveat: { ko: 'push/deploy/restart 승인 필요', en: 'Push/deploy/restart approval is required' },
    evidenceAnchor: 'captured-handoff-readiness + final-verification-trend',
    recommendedReview: { ko: '최근 export readiness를 먼저 비교', en: 'Compare latest export readiness first' },
    approvalBoundary: 'approval-required' as const,
  },
  {
    id: 'workflow-runtime-caveat',
    domain: 'workflow-runtime' as const,
    sourceSurface: 'Module graph > runtime health + terminal history',
    priority: 'medium' as const,
    title: { ko: '워크플로우 런타임 caveat', en: 'Workflow runtime caveat' },
    caveat: { ko: 'rerun/restart 전 운영 검토', en: 'Operator review before rerun/restart' },
    evidenceAnchor: 'queue-retry-recovery-retention-signals',
    recommendedReview: { ko: 'stop condition 확인', en: 'Check stop conditions' },
    approvalBoundary: 'operator-review' as const,
  },
  {
    id: 'media-stewardship-caveat',
    domain: 'media-review' as const,
    sourceSurface: 'Media review > operational trends + similarity history',
    priority: 'watch' as const,
    title: { ko: '미디어 스튜어드십 caveat', en: 'Media stewardship caveat' },
    caveat: { ko: '삭제/retention 변경 승인 필요', en: 'Deletion/retention changes need approval' },
    evidenceAnchor: 'review-quality-cleanup-signals',
    recommendedReview: { ko: '공개 전 caveat 확인', en: 'Review caveats before release' },
    approvalBoundary: 'approval-required' as const,
  },
]

const summary = buildReleaseReadinessHistoryIntelligenceSummary(readinessIntelligenceItems)
equal(summary.signals.length, 3, 'intelligence summary should retain the three foundation signals')
deepEqualSorted(summary.priorityHighlights, ['release-handoff-priority: captured-handoff-readiness + final-verification-trend'], 'high priority highlight should be explicit')
ok(summary.caveats.some((item) => item.includes('workflow-runtime-caveat')), 'operator-review runtime caveat should be summarized')
ok(summary.caveats.some((item) => item.includes('media-stewardship-caveat')), 'approval-gated media caveat should be summarized')

const record = buildReleaseReadinessHistoryRecord({
  id: 'intelligence-record',
  savedAt: '2026-06-11T00:00:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: [],
  capturedHandoffItemIds: [],
  reviewedAlertIds: [],
  reviewedAutomationRehearsalIds: [],
  reviewItems: [],
  evidenceItems: [],
  alertReviewItems: [],
  trendEvidenceItems: [],
  automationContextItems: [],
  automationRehearsalItems: [],
  readinessIntelligenceItems,
  evidenceReviewItems: [],
  handoffItems: [],
  runbookGuardrails: [],
  operationSteps: [],
  userDecisions: [],
})

equal(record.summary.readinessIntelligenceSignalCount, 3, 'history record should count readiness intelligence signals')
equal(record.readinessIntelligence.priorityHighlights.length, 1, 'history record should expose high-priority highlights')
const handoffMarkdown = buildReleaseReadinessHandoffMarkdown(record)
ok(handoffMarkdown.includes('## Readiness History Intelligence'), 'handoff export should include readiness intelligence')
ok(handoffMarkdown.includes('release-handoff-priority'), 'handoff export should include release handoff priority')
ok(handoffMarkdown.includes('workflow-runtime-caveat'), 'handoff export should include workflow runtime caveat')
ok(handoffMarkdown.includes('media-stewardship-caveat'), 'handoff export should include media stewardship caveat')

ok(historyContract.includes('ReleaseReadinessHistoryIntelligenceSignalContract'), 'history contract should type readiness intelligence signals')
ok(historyContract.includes('readinessIntelligenceSignalCount'), 'history contract should persist readiness intelligence counts')
ok(historyContract.includes('Readiness History Intelligence'), 'history handoff should export readiness intelligence')
ok(releaseReadinessTab.includes('READINESS_HISTORY_INTELLIGENCE_SIGNALS'), 'release readiness UI should define intelligence signals')
ok(releaseReadinessTab.includes('data-release-readiness-history-intelligence="true"'), 'release readiness UI should expose the intelligence surface')
ok(releaseReadinessTab.includes('release-handoff-priority'), 'UI should include release operations priority')
ok(releaseReadinessTab.includes('workflow-runtime-caveat'), 'UI should include workflow runtime caveat')
ok(releaseReadinessTab.includes('media-stewardship-caveat'), 'UI should include media stewardship caveat')
ok(releaseReadinessTab.includes('does not push, deploy, restart, or clean up'), 'UI should preserve side-effect boundaries')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'intelligence capture should not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'intelligence capture should not perform external actions')
ok(intelligenceDoc.includes('priority/caveat summaries'), 'docs should describe priority/caveat summaries')
ok(intelligenceDoc.includes('must not push, deploy, restart'), 'docs should preserve external side-effect boundaries')
ok(frontendPackageJson.includes('"verify:readiness-history-intelligence-contracts"'), 'frontend package should expose the verifier')

console.log('Readiness history intelligence contracts verified.')

function deepEqualSorted(actual: string[], expected: string[], message: string) {
  equal(JSON.stringify([...actual].sort()), JSON.stringify([...expected].sort()), message)
}
