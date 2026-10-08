import { runDatabaseBackup, type DatabaseBackupResult } from '../../maintenance/databaseBackupService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export interface DatabaseBackupJobParams {
  keep?: number
}

async function runDatabaseBackupJob(ctx: RuntimeJobContext<DatabaseBackupJobParams>): Promise<DatabaseBackupResult> {
  return runDatabaseBackup({
    keep: ctx.params.keep,
    hooks: {
      // Per file, in bytes: phase/currentLabel name the file, processed/total are that file's copied/total bytes.
      progress: (fileName, totalPages, remainingPages, pageSize) => ctx.report({
        phase: fileName,
        currentLabel: fileName,
        total: totalPages * pageSize,
        processed: (totalPages - remainingPages) * pageSize,
      }),
      throwIfCancelled: () => ctx.throwIfCancelled(),
    },
  })
}

export function registerDatabaseBackupJobHandlers(): void {
  RuntimeJobRunner.register<DatabaseBackupJobParams, DatabaseBackupResult>({
    kind: 'database-backup',
    singletonKey: () => 'database-backup',
    handler: runDatabaseBackupJob,
  })
}
