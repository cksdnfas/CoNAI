import { runRecycleBinRetention, type RecycleBinRetentionResult } from '../../maintenance/recycleBinRetentionService'
import { purgeAudioTombstones, type AudioPurgeResult } from '../../audio/audioMaintenance'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export interface RecycleBinRetentionJobParams {
  retentionDays: number
}

export type RecycleBinRetentionJobResult = RecycleBinRetentionResult & { audio?: AudioPurgeResult }

async function runRecycleBinRetentionJob(ctx: RuntimeJobContext<RecycleBinRetentionJobParams>): Promise<RecycleBinRetentionJobResult> {
  // Soft-deleted audio candidates past the same retention leave first; their unused files land in the RecycleBin and
  // age there like everything else.
  let audio: AudioPurgeResult | undefined
  try {
    audio = await purgeAudioTombstones({ retentionDays: ctx.params.retentionDays }, {
      yield: () => ctx.yield(),
      throwIfCancelled: () => ctx.throwIfCancelled(),
    })
  } catch (error) {
    if ((error as Error)?.name === 'RuntimeJobCancelledError') throw error
    ctx.recordWarning(`audio purge failed: ${(error as Error)?.message ?? String(error)}`)
  }
  const result = await runRecycleBinRetention({ retentionDays: ctx.params.retentionDays }, {
    progress: (processed, total) => ctx.report({ processed, total }),
    yield: () => ctx.yield(),
    throwIfCancelled: () => ctx.throwIfCancelled(),
  })
  return audio ? { ...result, audio } : result
}

export function registerRecycleBinRetentionJobHandlers(): void {
  RuntimeJobRunner.register<RecycleBinRetentionJobParams, RecycleBinRetentionJobResult>({
    kind: 'recycle-bin-retention',
    singletonKey: () => 'recycle-bin-retention',
    handler: runRecycleBinRetentionJob,
  })
}
