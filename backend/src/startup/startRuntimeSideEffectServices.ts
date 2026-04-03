import { imageTaggerService } from '../services/imageTaggerService'
import { settingsService } from '../services/settingsService'
import { AutoScanScheduler } from '../services/autoScanScheduler'
import { autoTagScheduler } from '../services/autoTagScheduler'

/** Start runtime daemons, watchers, and schedulers after core startup succeeds. */
export async function startRuntimeSideEffectServices(isSafeSmokeMode: boolean) {
  const settings = settingsService.loadSettings()

  if (isSafeSmokeMode) {
    console.log('🧪 SAFE_SMOKE_MODE enabled - skipping daemon, watcher, and scheduler startup')
    return
  }

  if (settings.tagger.enabled) {
    console.log('🤖 Starting tagger daemon...')
    try {
      await imageTaggerService.startDaemon()
      console.log('✅ Tagger daemon started successfully')
    } catch (error) {
      console.warn('⚠️  Failed to start tagger daemon:', error instanceof Error ? error.message : error)
      console.warn('   Tagger will be started on first use')
    }
  } else {
    console.log('⏭️  Tagger is disabled - skipping daemon startup')
  }

  if (process.env.ENABLE_FILE_WATCHING !== 'false') {
    try {
      console.log('👀 Starting file watcher service...')
      const { FileWatcherService } = await import('../services/fileWatcherService')
      await FileWatcherService.initialize()
      console.log('✅ File watcher service started successfully')

      console.log('📥 Starting backup source watcher service...')
      const { BackupSourceWatcherService } = await import('../services/backupSourceWatcherService')
      await BackupSourceWatcherService.initialize()
      console.log('✅ Backup source watcher service started successfully')
    } catch (error) {
      console.warn('⚠️  Failed to start file watcher service:', error instanceof Error ? error.message : error)
      console.warn('   Falling back to scheduled scans only')
    }
  } else {
    console.log('⏭️  File watching is disabled - using scheduled scans only')
  }

  console.log('🤖 Starting auto-scan scheduler...')
  AutoScanScheduler.start()
  console.log('✅ Auto-scan scheduler started successfully')

  console.log('🤖 Starting auto-tag scheduler...')
  const autoTagSchedulerStarted = autoTagScheduler.start()
  if (autoTagSchedulerStarted) {
    console.log('✅ Auto-tag scheduler started successfully')
  } else {
    console.log('⏭️  Auto-tag scheduler skipped (all auto-tag processors disabled)')
  }

  try {
    console.log('🧹 Starting temp image cleanup scheduler...')
    const { TempImageCleanupScheduler } = await import('../cron/tempImageCleanup')
    TempImageCleanupScheduler.start()
    console.log('✅ Temp image cleanup scheduler started successfully')
  } catch (error) {
    console.warn('⚠️  Failed to start temp image cleanup scheduler:', error instanceof Error ? error.message : error)
    console.warn('   Temp files will not be automatically cleaned up')
  }
}
