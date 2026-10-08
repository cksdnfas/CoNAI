import { runRecycleBinRetention, type RecycleBinRetentionResult } from '../../maintenance/recycleBinRetentionService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export interface RecycleBinRetentionJobParams {
  retentionDays: number
}

async function runRecycleBinRetentionJob(ctx: RuntimeJobContext<RecycleBinRetentionJobParams>): Promise<RecycleBinRetentionResult> {
  return runRecycleBinRetention({ retentionDays: ctx.params.retentionDays }, {
    progress: (processed, total) => ctx.report({ processed, total }),
    yield: () => ctx.yield(),
    throwIfCancelled: () => ctx.throwIfCancelled(),
  })
}

export function registerRecycleBinRetentionJobHandlers(): void {
  RuntimeJobRunner.register<RecycleBinRetentionJobParams, RecycleBinRetentionResult>({
    kind: 'recycle-bin-retention',
    singletonKey: () => 'recycle-bin-retention',
    handler: runRecycleBinRetentionJob,
  })
}
