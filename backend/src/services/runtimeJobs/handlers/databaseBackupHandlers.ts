import { runDatabaseBackup, type DatabaseBackupResult } from '../../maintenance/databaseBackupService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export interface DatabaseBackupJobParams {
  keep?: number
}

async function runDatabaseBackupJob(ctx: RuntimeJobContext<DatabaseBackupJobParams>): Promise<DatabaseBackupResult> {
  return runDatabaseBackup({
    keep: ctx.params.keep,
    hooks: {
      progress: (fileName, totalPages, remainingPages) => ctx.report({
        currentLabel: fileName,
        total: totalPages,
        processed: totalPages - remainingPages,
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
