import { imageTaggerService } from '../services/imageTaggerService'
import { settingsService } from '../services/settingsService'
import { AutoScanScheduler } from '../services/autoScanScheduler'
import { autoTagScheduler } from '../services/autoTagScheduler'
import { GraphWorkflowScheduleService } from '../services/graphWorkflowScheduleService'
import { GraphWorkflowExecutionQueue } from '../services/graphWorkflowExecutionQueue'
import { GenerationQueueService } from '../services/generationQueueService'
import {
  normalizeRuntimeSideEffectRole,
  resolveRuntimeSideEffectRole,
  type RuntimeSideEffectRole,
} from './runtimeRole'

let watcherStartupPromise: Promise<void> | null = null
let watcherStartupController: AbortController | null = null

/** Cancel detached watcher startup before shutdown drains watcher registries. */
export function cancelRuntimeWatcherStartup(): void {
  watcherStartupController?.abort(new Error('Runtime watcher startup cancelled for shutdown'))
}

/** Let shutdown wait until detached watcher startup can no longer add new handles. */
export async function waitForRuntimeWatcherStartup(): Promise<void> {
  await watcherStartupPromise
}

function warnUnknownRuntimeSideEffectRole() {
  const rawRole = process.env.CONAI_RUNTIME_ROLE || process.env.CONAI_SIDE_EFFECT_ROLE
  if (rawRole && !normalizeRuntimeSideEffectRole(rawRole)) {
    console.warn(`⚠️  Unknown CONAI_RUNTIME_ROLE=${rawRole}; falling back to all`)
  }
}

/** Start runtime daemons, watchers, and schedulers after core startup succeeds. */
export async function startRuntimeSideEffectServices(
  isSafeSmokeMode: boolean,
  runtimeRole: RuntimeSideEffectRole = resolveRuntimeSideEffectRole(),
) {
  if (isSafeSmokeMode) {
    console.log('🧪 SAFE_SMOKE_MODE enabled, skipping daemon, watcher, and scheduler startup')
    return
  }

  warnUnknownRuntimeSideEffectRole()
  if (runtimeRole === 'api') {
    console.log('🧩 CONAI_RUNTIME_ROLE=api, skipping worker daemons, watchers, queues, and schedulers')
    return
  }

  if (runtimeRole === 'worker') {
    console.log('🧩 CONAI_RUNTIME_ROLE=worker, starting runtime side-effect services')
  }

  const settings = settingsService.loadSettings()

  if (settings.tagger.enabled) {
    try {
      await imageTaggerService.startDaemon()
      console.log('🤖 Tagger daemon ready')
    } catch (error) {
      console.warn('⚠️  Failed to start tagger daemon:', error instanceof Error ? error.message : error)
      console.warn('   Tagger will be started on first use')
    }
  } else {
    console.log('🤖 Tagger daemon skipped: disabled in settings')
  }

  if (process.env.ENABLE_FILE_WATCHING !== 'false') {
    // Watcher readiness waits on chokidar's initial scan (minutes on large or
    // network folders), so it must not block the HTTP server from listening.
    const startupController = new AbortController()
    watcherStartupController = startupController
    watcherStartupPromise = (async () => {
      try {
        const { FileWatcherService } = await import('../services/fileWatcherService')
        await FileWatcherService.initialize(startupController.signal)
        startupController.signal.throwIfAborted()

        const { BackupSourceWatcherService } = await import('../services/backupSourceWatcherService')
        await BackupSourceWatcherService.initialize(startupController.signal)
        startupController.signal.throwIfAborted()

        const { CustomNodeWatcherService } = await import('../services/customNodeWatcherService')
        await CustomNodeWatcherService.initialize(startupController.signal)
      } catch (error) {
        if (startupController.signal.aborted) {
          return
        }
        console.warn('⚠️  Failed to start file watcher service:', error instanceof Error ? error.message : error)
        console.warn('   Falling back to scheduled scans only')
      }
    })().finally(() => {
      if (watcherStartupController === startupController) {
        watcherStartupController = null
        watcherStartupPromise = null
      }
    })
    void watcherStartupPromise
  } else {
    console.log('👀 File watching disabled, scheduled scans only')
  }

  AutoScanScheduler.start()
  GraphWorkflowExecutionQueue.start()
  GraphWorkflowScheduleService.start()
  GenerationQueueService.start()
  const { ChatGenerationReactionService } = await import('../services/codex-chat/chatGenerationReactions')
  ChatGenerationReactionService.start()
  const { ChatTaskRunner } = await import('../services/codex-chat/chatTasks')
  ChatTaskRunner.start()
  try {
    // Audio orders whose rows were stored but not queued before the last shutdown/crash.
    const { reconcileAllAudioOrders } = await import('../services/audio/audioOrders')
    const requeued = reconcileAllAudioOrders()
    if (requeued > 0) console.log(`🔊 Re-queued ${requeued} audio order job(s)`)
  } catch (error) {
    console.warn('⚠️ Audio order reconcile failed:', error instanceof Error ? error.message : error)
  }

  const { CleanupService } = await import('../services/cleanupService')
  CleanupService.startPeriodicCleanup()

  const { DatabaseMaintenanceScheduler } = await import('../services/maintenance/databaseMaintenanceScheduler')
  DatabaseMaintenanceScheduler.start()

  const autoTagSchedulerStarted = autoTagScheduler.start()
  if (!autoTagSchedulerStarted) {
    console.log('🤖 Auto-tag scheduler skipped: all processors disabled')
  }

  try {
    const { TempImageCleanupScheduler } = await import('../cron/tempImageCleanup')
    TempImageCleanupScheduler.start()
  } catch (error) {
    console.warn('⚠️  Failed to start temp image cleanup scheduler:', error instanceof Error ? error.message : error)
    console.warn('   Temp files will not be automatically cleaned up')
  }

  // Old chat card copies move into the image library once the boot-time scan load has passed.
  setTimeout(() => {
    import('../services/codex-chat/chatCardAssets')
      .then(({ migrateLegacyChatAssets }) => migrateLegacyChatAssets())
      .catch((error) => console.warn('⚠️  Failed to move chat card images into the library:', error instanceof Error ? error.message : error))
    import('../services/codex-chat/chatProfileAssets')
      .then(({ migrateLegacyProfileAssets }) => migrateLegacyProfileAssets())
      .catch((error) => console.warn('⚠️  Failed to move chat profile images into the library:', error instanceof Error ? error.message : error))
  }, 90_000).unref()
}
