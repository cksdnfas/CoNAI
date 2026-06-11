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
const triageDoc = readFileSync(join(root, '../docs/systems/media-runtime-caveat-triage-contracts.md'), 'utf8')

const mediaRuntimeTriageQueueItems = [
  {
    id: 'review-backlog-before-cleanup',
    axis: 'media-review' as const,
    priority: 'now' as const,
    title: { ko: '정리 전 review backlog', en: 'Review backlog before cleanup' },
    evidenceAnchor: 'media-review-queue + media-quality-backlog',
    triageQuestion: { ko: 'backlog 분리 여부', en: 'Backlog separation' },
    safeNextStep: { ko: 'operator-review 큐로 고정', en: 'Pin as operator-review queue' },
    approvalBoundary: 'operator-review' as const,
  },
  {
    id: 'similarity-cleanup-approval-gate',
    axis: 'media-review' as const,
    priority: 'next' as const,
    title: { ko: '유사도/정리 승인 게이트', en: 'Similarity and cleanup approval gate' },
    evidenceAnchor: 'media-similarity-decision + media-cleanup-staging',
    triageQuestion: { ko: '비파괴 staging 여부', en: 'Non-destructive staging' },
    safeNextStep: { ko: '삭제 없이 export', en: 'Export without deletion' },
    approvalBoundary: 'approval-required' as const,
  },
]

const record = buildReleaseReadinessHistoryRecord({
  id: 'media-runtime-triage-record',
  savedAt: '2026-06-11T01:00:00.000Z',
  appVersionLabel: '26.6.3',
  reviewedItemIds: [],
  capturedHandoffItemIds: [],
  reviewedAlertIds: [],
  reviewedMediaRuntimeTriageIds: ['similarity-cleanup-approval-gate'],
  reviewItems: [],
  evidenceItems: [],
  alertReviewItems: [],
  trendEvidenceItems: [],
  automationContextItems: [],
  readinessIntelligenceItems: [],
  mediaRuntimeTriageQueueItems,
  evidenceReviewItems: [],
  handoffItems: [],
  runbookGuardrails: [],
  operationSteps: [],
  userDecisions: [],
})

equal(record.summary.mediaRuntimeTriageQueueCount, 2, 'history summary should count media/runtime triage queue items')
equal(record.summary.reviewedMediaRuntimeTriageCount, 1, 'history summary should count reviewed media/runtime triage items')
equal(record.mediaRuntimeTriageQueue[1]?.approvalBoundary, 'approval-required', 'triage queue should preserve approval boundaries')
equal(record.mediaRuntimeTriageQueue[1]?.status, 'reviewed', 'triage queue should persist reviewed operator state')
const markdown = buildReleaseReadinessHandoffMarkdown(record)
ok(markdown.includes('## Media Runtime Caveat Triage Queue'), 'handoff markdown should export the triage queue section')
ok(markdown.includes('Similarity and cleanup approval gate'), 'handoff markdown should include approval-gated cleanup triage')
ok(releaseReadinessTab.includes('MEDIA_RUNTIME_TRIAGE_QUEUE_ITEMS'), 'release readiness UI should define media/runtime triage queue items')
ok(releaseReadinessTab.includes('data-media-runtime-caveat-triage="true"'), 'release readiness UI should expose the triage queue surface')
ok(releaseReadinessTab.includes('data-media-runtime-caveat-triage-summary="true"'), 'triage queue should expose a summary row')
ok(releaseReadinessTab.includes('data-media-runtime-caveat-triage-item={item.id}'), 'triage cards should be individually addressable')
ok(releaseReadinessTab.includes('mediaRuntimeTriageApprovalCount'), 'triage queue should count approval-required cards')
ok(releaseReadinessTab.includes('mediaRuntimeTriageOperatorCount'), 'triage queue should count operator-review cards')
ok(releaseReadinessTab.includes('reviewedMediaRuntimeTriage'), 'triage queue should expose operator review check state')
ok(releaseReadinessTab.includes('toggleMediaRuntimeTriageItem'), 'triage queue should allow individual operator-review toggles')
ok(releaseReadinessTab.includes("'review-backlog-before-cleanup'"), 'triage queue should include review backlog before cleanup')
ok(releaseReadinessTab.includes("'runtime-rerun-readiness-review'"), 'triage queue should include runtime rerun readiness')
ok(historyContract.includes('ReleaseReadinessMediaRuntimeTriageQueueContract'), 'history contract should type media/runtime triage records')
ok(historyContract.includes('mediaRuntimeTriageQueue'), 'history records should persist media/runtime triage queues')
ok(triageDoc.includes('Media/runtime caveat triage contracts'), 'system doc should describe the triage contract')
ok(triageDoc.includes('No external side effects'), 'system doc should preserve local-only boundaries')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'triage queue must not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'triage queue must not perform external actions')

console.log('Media/runtime caveat triage contracts verified.')
