export const SHUTDOWN_DRAIN_TIMEOUT_MS = 3000;
export const SHUTDOWN_FORCE_EXIT_TIMEOUT_MS = 10000;

export interface GracefulShutdownServer {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

export interface ShutdownTimerHandle {
  unref(): void;
}

export interface GracefulShutdownDependencies {
  shutdownRuntimeEventStreams(): number | Promise<number>;
  stopGenerationQueue(): void | Promise<void>;
  stopGraphWorkflowExecutionQueue(): void | Promise<void>;
  stopGraphWorkflowScheduleService(): void | Promise<void>;
  cancelRuntimeWatcherStartup(): void | Promise<void>;
  waitForRuntimeWatcherStartup(): void | Promise<void>;
  stopBackupSourceWatcher(): void | Promise<void>;
  stopFileWatcher(): void | Promise<void>;
  stopCustomNodeWatcher(): void | Promise<void>;
  stopAutoScanScheduler(): void | Promise<void>;
  stopAutoTagScheduler(): void | Promise<void>;
  stopTempImageCleanupScheduler(): void | Promise<void>;
  stopGenerationHistoryCleanupScheduler(): void | Promise<void>;
  cleanupTempFiles(): void | Promise<void>;
  stopTaggerDaemon(): void | Promise<void>;
  shutdownRuntimeJobs(): number | Promise<number>;
  closeMainDatabase(): void | Promise<void>;
  closeUserSettingsDatabase(): void | Promise<void>;
  closeApiGenerationDatabase(): void | Promise<void>;
  scheduleTimeout(callback: () => void, delayMs: number): ShutdownTimerHandle;
  processExit(code: number): void;
}

export interface GracefulShutdownOptions {
  server: GracefulShutdownServer | null;
  isSafeSmokeMode: boolean;
  shouldOwnTempFileLifecycle: boolean;
  dependencies?: GracefulShutdownDependencies;
  drainTimeoutMs?: number;
  forceExitTimeoutMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export type GracefulShutdown = (signal: string) => Promise<void>;

export interface ShutdownSignalRegistrar {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** Build the production adapters separately so the coordinator can be exercised without process or DB effects. */
export function createProductionGracefulShutdownDependencies(): GracefulShutdownDependencies {
  return {
    shutdownRuntimeEventStreams: async () => {
      const { RuntimeEventBroadcaster } = await import('../services/runtime-events/runtimeEventBroadcaster');
      return RuntimeEventBroadcaster.shutdown();
    },
    stopGenerationQueue: async () => {
      const { GenerationQueueService } = await import('../services/generationQueueService');
      await GenerationQueueService.stopAndDrain();
    },
    stopGraphWorkflowExecutionQueue: async () => {
      const { GraphWorkflowExecutionQueue } = await import('../services/graphWorkflowExecutionQueue');
      await GraphWorkflowExecutionQueue.stop();
    },
    stopGraphWorkflowScheduleService: async () => {
      const { GraphWorkflowScheduleService } = await import('../services/graphWorkflowScheduleService');
      await GraphWorkflowScheduleService.stopAndDrain();
    },
    cancelRuntimeWatcherStartup: async () => {
      const { cancelRuntimeWatcherStartup } = await import('./startRuntimeSideEffectServices');
      cancelRuntimeWatcherStartup();
    },
    waitForRuntimeWatcherStartup: async () => {
      const { waitForRuntimeWatcherStartup } = await import('./startRuntimeSideEffectServices');
      await waitForRuntimeWatcherStartup();
    },
    stopBackupSourceWatcher: async () => {
      const { BackupSourceWatcherService } = await import('../services/backupSourceWatcherService');
      await BackupSourceWatcherService.stopAll();
    },
    stopFileWatcher: async () => {
      const { FileWatcherService } = await import('../services/fileWatcherService');
      await FileWatcherService.stopAll();
    },
    stopCustomNodeWatcher: async () => {
      const { CustomNodeWatcherService } = await import('../services/customNodeWatcherService');
      await CustomNodeWatcherService.stopAll();
    },
    stopAutoScanScheduler: async () => {
      const { AutoScanScheduler } = await import('../services/autoScanScheduler');
      AutoScanScheduler.stop();
    },
    stopAutoTagScheduler: async () => {
      const { autoTagScheduler } = await import('../services/autoTagScheduler');
      autoTagScheduler.stop();
    },
    stopTempImageCleanupScheduler: async () => {
      const { TempImageCleanupScheduler } = await import('../cron/tempImageCleanup');
      TempImageCleanupScheduler.stop();
    },
    stopGenerationHistoryCleanupScheduler: async () => {
      const { CleanupService } = await import('../services/cleanupService');
      CleanupService.stopPeriodicCleanup();
    },
    cleanupTempFiles: async () => {
      const { TempImageService } = await import('../services/tempImageService');
      const { settingsService } = await import('../services/settingsService');
      const settings = settingsService.loadSettings();
      const shouldCleanupCanvas = settings.general.autoCleanupCanvasOnShutdown ?? false;
      await TempImageService.cleanupAll(!shouldCleanupCanvas);
    },
    stopTaggerDaemon: async () => {
      const { imageTaggerService } = await import('../services/imageTaggerService');
      await imageTaggerService.stopDaemon();
    },
    shutdownRuntimeJobs: async () => {
      const { RuntimeJobRunner } = await import('../services/runtimeJobs/runtimeJobRunner');
      return RuntimeJobRunner.shutdown();
    },
    closeMainDatabase: async () => {
      const { closeDatabase } = await import('../database/init');
      closeDatabase();
    },
    closeUserSettingsDatabase: async () => {
      const { closeUserSettingsDb } = await import('../database/userSettingsDb');
      closeUserSettingsDb();
    },
    closeApiGenerationDatabase: async () => {
      const { closeApiGenerationDb } = await import('../database/apiGenerationDb');
      closeApiGenerationDb();
    },
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    processExit: (code) => process.exit(code),
  };
}

async function runCleanupStep<T>(
  action: () => T | Promise<T>,
  onSuccess: (result: T) => void,
  warning: string,
  logger: Pick<Console, 'warn'>,
): Promise<void> {
  try {
    const result = await action();
    onSuccess(result);
  } catch (error) {
    logger.warn(warning, error);
  }
}

/** Coordinate the established shutdown sequence without owning startup or server creation. */
export function createGracefulShutdownCoordinator(options: GracefulShutdownOptions): GracefulShutdown {
  const {
    server,
    isSafeSmokeMode,
    shouldOwnTempFileLifecycle,
    dependencies = createProductionGracefulShutdownDependencies(),
    drainTimeoutMs = SHUTDOWN_DRAIN_TIMEOUT_MS,
    forceExitTimeoutMs = SHUTDOWN_FORCE_EXIT_TIMEOUT_MS,
    logger = console,
  } = options;
  let isShuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.log(`Received ${signal}, but shutdown is already in progress...`);
      return;
    }

    isShuttingDown = true;
    logger.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

    const forceExitTimer = dependencies.scheduleTimeout(() => {
      logger.error('❌ Forced shutdown after timeout');
      dependencies.processExit(1);
    }, forceExitTimeoutMs);
    forceExitTimer.unref();

    const activeServer = server;
    let serverClosePromise: Promise<void> | null = null;
    if (activeServer) {
      // Stop accepting new requests first, but keep SSE alive while workers drain
      // so their final state remains observable.
      serverClosePromise = new Promise<void>((resolve) => {
        try {
          activeServer.close((error) => {
            if (error) {
              logger.warn('⚠️  Error closing HTTP server:', error);
            }
            resolve();
          });
        } catch (error) {
          logger.warn('⚠️  Error closing HTTP server:', error);
          resolve();
        }

        try {
          activeServer.closeIdleConnections?.();
        } catch (error) {
          logger.warn('⚠️  Error closing idle HTTP connections:', error);
        }
      });
    }

    if (!isSafeSmokeMode) {
      await runCleanupStep(
        dependencies.stopGraphWorkflowScheduleService,
        () => logger.log('✅ Graph workflow schedule service stopped'),
        '⚠️  Error stopping graph workflow schedule service:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopGraphWorkflowExecutionQueue,
        () => logger.log('✅ Graph workflow execution queue drained'),
        '⚠️  Error stopping graph workflow execution queue:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopGenerationQueue,
        () => logger.log('✅ Generation queue drained'),
        '⚠️  Error stopping generation queue:',
        logger,
      );
      await runCleanupStep(
        dependencies.cancelRuntimeWatcherStartup,
        () => undefined,
        '⚠️  Error cancelling runtime watcher startup:',
        logger,
      );
      await runCleanupStep(
        dependencies.waitForRuntimeWatcherStartup,
        () => undefined,
        '⚠️  Error waiting for runtime watcher startup:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopBackupSourceWatcher,
        () => logger.log('✅ Backup source watcher service stopped'),
        '⚠️  Error stopping backup source watcher service:',
        logger,
      );
    }

    if (!isSafeSmokeMode) {
      await runCleanupStep(
        dependencies.stopFileWatcher,
        () => logger.log('✅ File watcher service stopped'),
        '⚠️  Error stopping file watcher service:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopCustomNodeWatcher,
        () => logger.log('✅ Custom node watcher service stopped'),
        '⚠️  Error stopping custom node watcher service:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopAutoScanScheduler,
        () => logger.log('✅ Auto-scan scheduler stopped'),
        '⚠️  Error stopping auto-scan scheduler:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopAutoTagScheduler,
        () => logger.log('✅ Auto-tag scheduler stopped'),
        '⚠️  Error stopping auto-tag scheduler:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopTempImageCleanupScheduler,
        () => logger.log('✅ Temp image cleanup scheduler stopped'),
        '⚠️  Error stopping temp image cleanup scheduler:',
        logger,
      );
      await runCleanupStep(
        dependencies.stopGenerationHistoryCleanupScheduler,
        () => logger.log('✅ Generation history cleanup scheduler stopped'),
        '⚠️  Error stopping generation history cleanup scheduler:',
        logger,
      );
    }

    if (shouldOwnTempFileLifecycle) {
      await runCleanupStep(
        dependencies.cleanupTempFiles,
        () => logger.log('✅ All temp files cleaned up'),
        '⚠️  Error cleaning up temp files:',
        logger,
      );
    }

    if (!isSafeSmokeMode) {
      await runCleanupStep(
        dependencies.stopTaggerDaemon,
        () => logger.log('✅ Tagger daemon stopped'),
        '⚠️  Error stopping tagger daemon:',
        logger,
      );
    }

    await runCleanupStep(
      dependencies.shutdownRuntimeJobs,
      (interruptedJobCount) => {
        if (interruptedJobCount > 0) {
          logger.log(`✅ Runtime jobs marked as interrupted (${interruptedJobCount})`);
        }
      },
      '⚠️  Error closing runtime jobs:',
      logger,
    );

    await runCleanupStep(
      dependencies.shutdownRuntimeEventStreams,
      (closedStreamCount) => {
        if (closedStreamCount > 0) {
          logger.log(`✅ Runtime event streams closed (${closedStreamCount})`);
        }
      },
      '⚠️  Error closing runtime event streams:',
      logger,
    );

    if (activeServer && serverClosePromise) {
      await Promise.race([
        serverClosePromise,
        new Promise<void>((resolve) => {
          dependencies.scheduleTimeout(resolve, drainTimeoutMs).unref();
        }),
      ]);

      try {
        activeServer.closeAllConnections?.();
      } catch (error) {
        logger.warn('⚠️  Error closing remaining HTTP connections:', error);
      }
      logger.log('✅ Server closed');
    } else {
      logger.log('✅ Server was not running or already closed');
    }

    await runCleanupStep(
      dependencies.closeMainDatabase,
      () => logger.log('✅ Main database connection closed'),
      '⚠️  Error closing main database:',
      logger,
    );
    await runCleanupStep(
      dependencies.closeUserSettingsDatabase,
      () => logger.log('✅ User settings database connection closed'),
      '⚠️  Error closing user settings database:',
      logger,
    );
    await runCleanupStep(
      dependencies.closeApiGenerationDatabase,
      () => logger.log('✅ API generation database connection closed'),
      '⚠️  Error closing API generation database:',
      logger,
    );

    dependencies.processExit(0);
  };
}

/** Register only the two process signals supported by the existing backend lifecycle. */
export function registerGracefulShutdownSignalHandlers(
  shutdown: GracefulShutdown,
  registrar: ShutdownSignalRegistrar = process,
): void {
  registrar.on('SIGTERM', () => void shutdown('SIGTERM'));
  registrar.on('SIGINT', () => void shutdown('SIGINT'));
}
