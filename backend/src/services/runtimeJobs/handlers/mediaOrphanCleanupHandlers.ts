import {
  runMediaOrphanCleanup,
  type MediaOrphanCleanupOptions,
  type MediaOrphanCleanupResult,
} from '../../maintenance/mediaOrphanCleanupService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

export type MediaOrphanCleanupJobParams = Partial<MediaOrphanCleanupOptions>

async function runMediaOrphanCleanupJob(
  ctx: RuntimeJobContext<MediaOrphanCleanupJobParams>,
): Promise<MediaOrphanCleanupResult> {
  return runMediaOrphanCleanup(ctx.params, {
    phase: (phase) => ctx.flush({ phase, processed: 0, currentLabel: phase }),
    progress: (processed) => ctx.report({ processed }),
    warn: (message) => ctx.recordWarning(message),
    yield: () => ctx.yield(),
    throwIfCancelled: () => ctx.throwIfCancelled(),
  })
}

export function registerMediaOrphanCleanupJobHandlers(): void {
  RuntimeJobRunner.register<MediaOrphanCleanupJobParams, MediaOrphanCleanupResult>({
    kind: 'media-orphan-cleanup',
    // Dry runs and real runs walk the same tables; one at a time keeps the counts meaningful.
    singletonKey: () => 'media-orphan-cleanup',
    handler: runMediaOrphanCleanupJob,
  })
}
