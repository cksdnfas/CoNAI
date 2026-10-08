import { db } from '../../../database/init'
import { compactImagesDatabase, type DatabaseCompactionResult } from '../../maintenance/databaseCompactionService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

async function runDatabaseCompactionJob(ctx: RuntimeJobContext<Record<string, never>>): Promise<DatabaseCompactionResult> {
  ctx.flush({ phase: 'vacuum', currentLabel: 'images.db' })
  // Let the 'running' state reach the job store and any listeners before the process blocks on VACUUM.
  await ctx.yield()
  ctx.throwIfCancelled()
  return compactImagesDatabase(db, ctx.jobId)
}

export function registerDatabaseCompactionJobHandlers(): void {
  RuntimeJobRunner.register<Record<string, never>, DatabaseCompactionResult>({
    kind: 'database-compaction',
    singletonKey: () => 'database-compaction',
    handler: runDatabaseCompactionJob,
  })
}
