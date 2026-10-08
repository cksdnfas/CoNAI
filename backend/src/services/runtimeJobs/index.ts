import { RuntimeJobRunner } from './runtimeJobRunner'
import { registerFolderScanJobHandlers } from './handlers/folderScanHandlers'
import { registerGroupRematchJobHandlers } from './handlers/groupRematchHandlers'
import { registerPromptSearchIndexJobHandlers } from './handlers/promptSearchIndexHandlers'
import { registerThumbnailJobHandlers } from './handlers/thumbnailHandlers'
import { registerThumbnailRepairJobHandlers } from './handlers/thumbnailRepairHandlers'
import { registerVideoPosterJobHandlers } from './handlers/videoPosterHandlers'
import { registerMediaOrphanCleanupJobHandlers } from './handlers/mediaOrphanCleanupHandlers'
import { registerDatabaseBackupJobHandlers } from './handlers/databaseBackupHandlers'
import { registerRecycleBinRetentionJobHandlers } from './handlers/recycleBinRetentionHandlers'
import { registerDatabaseCompactionJobHandlers } from './handlers/databaseCompactionHandlers'
import { registerDuplicateGroupScanJobHandlers } from './handlers/duplicateGroupScanHandlers'
import { registerLibraryMaintenanceJobHandlers } from './handlers/libraryMaintenanceHandlers'
import { registerSpriteJobHandlers } from '../sprite/spriteService'
import { registerAudioExportJobHandlers } from '../audio/audioExportJob'
import { registerAudioLegacyImportJobHandlers } from '../audio/audioLegacyImportJob'
import { registerImageBatchResizeJobHandlers } from '../imageBatchResize/imageBatchResizeService'

export { RuntimeJobRunner, RuntimeJobCancelledError } from './runtimeJobRunner'
export type { RuntimeJobContext, RuntimeJobHandlerOptions } from './runtimeJobRunner'
export {
  RuntimeJobConflictError,
  RuntimeJobStore,
  RUNTIME_JOB_STALE_AFTER_MS,
  RUNTIME_JOB_TTL_MS,
} from './runtimeJobStore'

let handlersRegistered = false

/**
 * Register every runtime job handler exactly once.
 *
 * 라우트/기동 시퀀스/subprocess 러너가 모두 이 함수를 거치므로, 어느 진입점으로 들어와도
 * 레지스트리 구성이 동일하다.
 */
export function registerRuntimeJobHandlers(): void {
  if (handlersRegistered) {
    return
  }

  handlersRegistered = true
  registerThumbnailJobHandlers()
  registerThumbnailRepairJobHandlers()
  registerVideoPosterJobHandlers()
  registerPromptSearchIndexJobHandlers()
  registerGroupRematchJobHandlers()
  registerFolderScanJobHandlers()
  registerMediaOrphanCleanupJobHandlers()
  registerDatabaseBackupJobHandlers()
  registerRecycleBinRetentionJobHandlers()
  registerDatabaseCompactionJobHandlers()
  registerDuplicateGroupScanJobHandlers()
  registerLibraryMaintenanceJobHandlers()
  registerSpriteJobHandlers()
  registerAudioExportJobHandlers()
  registerAudioLegacyImportJobHandlers()
  registerImageBatchResizeJobHandlers()
}

/** Register handlers and recover interrupted jobs. `index.ts` 기동 시퀀스가 1회 호출한다. */
export function bootstrapRuntimeJobs(): void {
  registerRuntimeJobHandlers()
  RuntimeJobRunner.bootstrap()
}
