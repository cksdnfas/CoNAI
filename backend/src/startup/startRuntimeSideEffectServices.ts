import { imageTaggerService } from '../services/imageTaggerService'
import { settingsService } from '../services/settingsService'
import { AutoScanScheduler } from '../services/autoScanScheduler'
import { autoTagScheduler } from '../services/autoTagScheduler'
import { GraphWorkflowScheduleService } from '../services/graphWorkflowScheduleService'
import { GraphWorkflowExecutionQueue } from '../services/graphWorkflowExecutionQueue'
import { GenerationQueueService } from '../services/generationQueueService'

type RuntimeSideEffectRole = 'all' | 'api' | 'worker'

function resolveRuntimeSideEffectRole(): RuntimeSideEffectRole {
  const rawRole = (process.env.CONAI_RUNTIME_ROLE || process.env.CONAI_SIDE_EFFECT_ROLE || 'all').trim().toLowerCase()
  if (rawRole === 'api' || rawRole === 'worker' || rawRole === 'all') {
    return rawRole
  }

  console.warn(`⚠️  Unknown CONAI_RUNTIME_ROLE=${rawRole}; falling back to all`)
  return 'all'
}

/** Start runtime daemons, watchers, and schedulers after core startup succeeds. */
export async function startRuntimeSideEffectServices(isSafeSmokeMode: boolean) {
  const settings = settingsService.loadSettings()

  if (isSafeSmokeMode) {
    console.log('🧪 SAFE_SMOKE_MODE enabled, skipping daemon, watcher, and scheduler startup')
    return
  }

  const runtimeRole = resolveRuntimeSideEffectRole()
  if (runtimeRole === 'api') {
    console.log('🧩 CONAI_RUNTIME_ROLE=api, skipping worker daemons, watchers, queues, and schedulers')
    return
  }

  if (runtimeRole === 'worker') {
    console.log('🧩 CONAI_RUNTIME_ROLE=worker, starting runtime side-effect services')
  }

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
    try {
      const { FileWatcherService } = await import('../services/fileWatcherService')
      await FileWatcherService.initialize()

      const { BackupSourceWatcherService } = await import('../services/backupSourceWatcherService')
      await BackupSourceWatcherService.initialize()

      const { CustomNodeWatcherService } = await import('../services/customNodeWatcherService')
      await CustomNodeWatcherService.initialize()
    } catch (error) {
      console.warn('⚠️  Failed to start file watcher service:', error instanceof Error ? error.message : error)
      console.warn('   Falling back to scheduled scans only')
    }
  } else {
    console.log('👀 File watching disabled, scheduled scans only')
  }

  AutoScanScheduler.start()
  GraphWorkflowExecutionQueue.start()
  GraphWorkflowScheduleService.start()
  GenerationQueueService.start()

  const { CleanupService } = await import('../services/cleanupService')
  CleanupService.startPeriodicCleanup()

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
}
