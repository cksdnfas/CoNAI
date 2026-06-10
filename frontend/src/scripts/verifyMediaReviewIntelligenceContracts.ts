import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildMediaReviewCleanupStagingPlan,
  getMediaReviewGroupQualityChecks,
  getMediaReviewRecommendedQueues,
  getMediaReviewSignalSummary,
  buildMediaReviewSimilarityDecisionHistory,
  buildMediaReviewStewardshipWorkspace,
  getMediaReviewSimilarityDecisionSummary,
  getMediaReviewTagQualitySuggestions,
} from '../features/media-review/media-review-utils'
import type { GroupWithHierarchy } from '../types/group'
import type { ImageRecord } from '../types/image'

const reviewImages: ImageRecord[] = [
  {
    id: 1,
    composite_hash: 'ready-grouped',
    groups: [{ id: 10, name: 'Ready', collection_type: 'manual' }],
    rating_score: 42,
    auto_tags: {
      general: { sky: 0.9, tree: 0.8, cloud: 0.7, river: 0.6, grass: 0.5, sunlight: 0.4 },
      character: {},
      rating: { general: 0.98 },
    },
  },
  {
    id: 2,
    composite_hash: 'missing-tags',
    groups: [],
    rating_score: null,
    auto_tags: null,
  },
  {
    id: 3,
    composite_hash: 'sparse-tags',
    groups: [],
    rating_score: null,
    auto_tags: {
      general: { face: 0.8, portrait: 0.7 },
      character: {},
      rating: {},
    },
  },
  {
    id: 4,
    composite_hash: 'recoverable',
    groups: [],
    rating_score: null,
    file_status: 'missing',
    auto_tags: null,
  },
]

const groups: GroupWithHierarchy[] = [
  {
    id: 10,
    name: 'Ready',
    parent_id: null,
    image_count: 1,
    child_count: 0,
    has_children: false,
    auto_collect_enabled: true,
    auto_collect_last_run: null,
  },
  {
    id: 20,
    name: 'Empty',
    parent_id: null,
    image_count: 0,
    child_count: 0,
    has_children: false,
  },
]

const similarHashSet = new Set(['sparse-tags'])
const summary = getMediaReviewSignalSummary(reviewImages, similarHashSet)
const recommendations = getMediaReviewRecommendedQueues(summary, { reviewedCount: 1 })
const tagSuggestions = getMediaReviewTagQualitySuggestions(summary)
const groupChecks = getMediaReviewGroupQualityChecks(reviewImages, groups)
const decisionHistory = buildMediaReviewSimilarityDecisionHistory(
  reviewImages,
  'ready-grouped',
  'duplicate-candidate',
  '2026-06-08T16:00:00.000Z',
  similarHashSet,
)
const decisionSummary = getMediaReviewSimilarityDecisionSummary(decisionHistory)
const cleanupStagingPlan = buildMediaReviewCleanupStagingPlan(reviewImages, similarHashSet)
const stewardshipWorkspace = buildMediaReviewStewardshipWorkspace({
  summary,
  decisionSummary,
  cleanupStagingPlan,
  stagedCleanupItems: cleanupStagingPlan.items.slice(0, 2),
})

equal(recommendations[0].queue, 'recoverable', 'recoverable queue should be recommended before normal quality queues')
ok(recommendations.some((recommendation) => recommendation.queue === 'missing-tags'), 'recommended queues should include missing tag work')
ok(recommendations.some((recommendation) => recommendation.queue === 'ungrouped'), 'recommended queues should include ungrouped media work')
ok(tagSuggestions.some((suggestion) => suggestion.key === 'retag-missing' && suggestion.queue === 'missing-tags'), 'tag suggestions should route untagged work to the missing-tags queue')
ok(tagSuggestions.some((suggestion) => suggestion.key === 'retag-sparse' && suggestion.queue === 'sparse-tags'), 'tag suggestions should route sparse tags to the sparse-tags queue')
ok(tagSuggestions.some((suggestion) => suggestion.key === 'review-unrated' && suggestion.queue === 'unrated'), 'tag suggestions should surface unrated media')
ok(groupChecks.some((check) => check.key === 'ungrouped-loaded' && check.queue === 'ungrouped'), 'group checks should route loaded ungrouped media')
ok(groupChecks.some((check) => check.key === 'empty-groups' && check.groupIds.includes(20)), 'group checks should surface empty groups')
ok(groupChecks.some((check) => check.key === 'auto-collect-not-run' && check.groupIds.includes(10)), 'group checks should surface enabled auto-collect groups without a run record')
equal(decisionHistory.length, 3, 'similarity decision history should record target decisions while excluding the anchor')
equal(decisionSummary.duplicateCandidateCount, 3, 'decision summary should count duplicate-candidate decisions')
ok(decisionHistory.some((item) => item.targetHash === 'sparse-tags' && item.matchState === 'similar-match'), 'decision history should preserve whether a target came from similarity results')
equal(cleanupStagingPlan.items.length, reviewImages.length, 'cleanup staging should stage selected items as review records')
equal(cleanupStagingPlan.recoverableCount, 1, 'cleanup staging should count missing/deleted records as recoverable review')
equal(cleanupStagingPlan.destructiveCount, 0, 'cleanup staging should never plan destructive cleanup')
ok(cleanupStagingPlan.items.every((item) => item.destructiveAction === false), 'cleanup staging items should be explicitly non-destructive')
equal(stewardshipWorkspace.destructiveActionCount, 0, 'stewardship workspace should never plan destructive actions')
ok(stewardshipWorkspace.lanes.some((lane) => lane.key === 'duplicate-review' && lane.queue === 'similar'), 'stewardship workspace should expose duplicate review as a non-destructive lane')
ok(stewardshipWorkspace.lanes.some((lane) => lane.key === 'retention-candidates' && lane.approvalBoundary === 'approval-required'), 'retention candidates should remain approval-gated')
ok(stewardshipWorkspace.lanes.every((lane) => lane.destructiveAction === false), 'stewardship lanes should be explicit non-destructive evidence lanes')

const root = process.cwd()
const reviewPage = readFileSync(join(root, 'src/features/media-review/media-review-page.tsx'), 'utf8')

ok(reviewPage.includes('data-media-review-intelligence-panel="true"'), 'media review page should render the intelligence panel')
ok(reviewPage.includes('data-media-review-recommended-queues="true"'), 'media review page should render recommended queues')
ok(reviewPage.includes('data-media-review-tag-quality-suggestions="true"'), 'media review page should render tag quality suggestions')
ok(reviewPage.includes('data-media-review-group-quality-checks="true"'), 'media review page should render group quality checks')
ok(reviewPage.includes('data-media-review-similarity-history="true"'), 'media review page should render similarity decision history')
ok(reviewPage.includes('data-media-review-cleanup-staging="true"'), 'media review page should render reversible cleanup staging')
ok(reviewPage.includes('data-media-review-stewardship-workspace="true"'), 'media review page should render the non-destructive stewardship workspace')
ok(reviewPage.includes('data-media-review-stewardship-lane={lane.key}'), 'stewardship workspace should render evidence lanes')
ok(reviewPage.includes('handleStageCleanupSelected'), 'media review cleanup staging should be a local staging action')
ok(!reviewPage.includes('deleteImages('), 'media review intelligence should not add destructive deletion actions')
ok(!reviewPage.includes('triggerBlobDownload'), 'media review intelligence should not turn quality checks into downloads')

console.log('Media review intelligence contracts verified.')
