import {
  batchTagLibrary,
  recalculateAllRatingScores,
  resetAllAutoTags,
  type BatchTagLibraryParams,
} from '../../maintenance/autoTagMaintenanceService'
import { libraryBatchHooksFromJob } from '../../maintenance/libraryBatch'
import { FileVerificationService } from '../../fileVerificationService'
import { MaintenanceService } from '../../maintenanceService'
import { PromptSimilarityService } from '../../promptSimilarityService'
import { RuntimeJobRunner } from '../runtimeJobRunner'

/**
 * Whole-library maintenance that used to run inside its HTTP request. Every handler pages by key, writes one page per
 * transaction and yields between pages (services/maintenance/libraryBatch.ts), so progress and cancel work and the
 * server keeps answering while it runs.
 */

type NoParams = Record<string, never>

/** Jobs that rewrite auto_tags / rating_score share one slot so they never interleave their writes. */
const AUTO_TAG_SLOT = 'library-auto-tags'

export function registerLibraryMaintenanceJobHandlers(): void {
  RuntimeJobRunner.register<NoParams, unknown>({
    kind: 'auto-tag-reset',
    singletonKey: () => AUTO_TAG_SLOT,
    handler: (ctx) => resetAllAutoTags(libraryBatchHooksFromJob(ctx)),
  })

  RuntimeJobRunner.register<NoParams, unknown>({
    kind: 'rating-score-recalculate',
    singletonKey: () => AUTO_TAG_SLOT,
    handler: (ctx) => recalculateAllRatingScores(libraryBatchHooksFromJob(ctx)),
  })

  RuntimeJobRunner.register<BatchTagLibraryParams, unknown>({
    kind: 'auto-tag-batch-all',
    singletonKey: () => AUTO_TAG_SLOT,
    handler: (ctx) => batchTagLibrary({ limit: ctx.params?.limit ?? null }, libraryBatchHooksFromJob(ctx)),
  })

  RuntimeJobRunner.register<NoParams, unknown>({
    kind: 'auto-tag-collection-sync',
    singletonKey: () => 'auto-tag-collection-sync',
    handler: (ctx) => MaintenanceService.syncAutoTags(libraryBatchHooksFromJob(ctx)),
  })

  RuntimeJobRunner.register<NoParams, unknown>({
    kind: 'prompt-similarity-rebuild',
    singletonKey: () => 'prompt-similarity-rebuild',
    handler: (ctx) => PromptSimilarityService.rebuildAll(libraryBatchHooksFromJob(ctx)),
  })

  RuntimeJobRunner.register<NoParams, unknown>({
    kind: 'file-verification',
    singletonKey: () => 'file-verification',
    handler: (ctx) => FileVerificationService.verifyAllFiles({ hooks: libraryBatchHooksFromJob(ctx), verificationType: 'manual' }),
  })
}
