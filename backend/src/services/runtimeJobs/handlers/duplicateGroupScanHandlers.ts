import { ImageSimilarityModel } from '../../../models/Image/ImageSimilarityModel'
import { DuplicateGroupScanStore } from '../../duplicateGroupScanStore'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export type DuplicateGroupScanJobParams = {
  threshold: number
  minGroupSize: number
}

export type DuplicateGroupScanJobResult = DuplicateGroupScanJobParams & {
  totalGroups: number
  totalImages: number
}

/** Whole-library duplicate grouping for libraries too large to group inside a request; groups are paged by the route. */
async function runDuplicateGroupScanJob(ctx: RuntimeJobContext<DuplicateGroupScanJobParams>): Promise<DuplicateGroupScanJobResult> {
  const { threshold, minGroupSize } = ctx.params
  ctx.flush({ phase: 'grouping', processed: 0 })
  const refs = await ImageSimilarityModel.scanDuplicateGroupRefs({
    threshold,
    minGroupSize,
    hooks: {
      onProgress: async (processed, total) => {
        ctx.report({ processed, total })
        ctx.throwIfCancelled()
        await ctx.yield()
      },
    },
  })
  ctx.throwIfCancelled()
  DuplicateGroupScanStore.write(ctx.jobId, refs)
  return {
    threshold,
    minGroupSize,
    totalGroups: refs.length,
    totalImages: refs.reduce((sum, ref) => sum + ref.fileIds.length, 0),
  }
}

export function registerDuplicateGroupScanJobHandlers(): void {
  RuntimeJobRunner.register<DuplicateGroupScanJobParams, DuplicateGroupScanJobResult>({
    kind: 'duplicate-group-scan',
    singletonKey: () => 'duplicate-group-scan',
    handler: runDuplicateGroupScanJob,
  })
}
