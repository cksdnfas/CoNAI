import chokidar, { type FSWatcher } from 'chokidar';
import { runtimePaths } from '../config/runtimePaths';
import { CustomNodeRegistryService } from './customNodeRegistryService';

type CustomNodeWatcherState = 'initializing' | 'watching' | 'stopped' | 'error';

/** Watch `user/custom_nodes` and debounce registry resync after file changes. */
export class CustomNodeWatcherService {
  private static watcher: FSWatcher | null = null;
  private static state: CustomNodeWatcherState = 'stopped';
  private static debounceTimer: NodeJS.Timeout | null = null;
  private static readonly RESCAN_DEBOUNCE_MS = parseInt(process.env.CUSTOM_NODE_WATCH_DEBOUNCE_MS || '800', 10);
  private static isSyncRunning = false;
  private static hasPendingSync = false;

  /** Start one chokidar watcher for local file-based custom node folders. */
  static async initialize(): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.state = 'initializing';
    await CustomNodeRegistryService.ensureCustomNodesDirectory();

    const watcher = chokidar.watch(runtimePaths.customNodesDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
      depth: 3,
    });

    const scheduleSync = (eventType: string, targetPath: string) => {
      console.log(`🧩 Custom node watcher event: ${eventType} -> ${targetPath}`);
      this.scheduleRegistrySync();
    };

    watcher
      .on('add', (targetPath) => scheduleSync('add', targetPath))
      .on('change', (targetPath) => scheduleSync('change', targetPath))
      .on('unlink', (targetPath) => scheduleSync('unlink', targetPath))
      .on('addDir', (targetPath) => scheduleSync('addDir', targetPath))
      .on('unlinkDir', (targetPath) => scheduleSync('unlinkDir', targetPath))
      .on('error', (error) => {
        this.state = 'error';
        console.warn('⚠️  Custom node watcher error:', error instanceof Error ? error.message : error);
      })
      .on('ready', () => {
        this.state = 'watching';
        console.log(`✅ Custom node watcher ready: ${runtimePaths.customNodesDir}`);
      });

    this.watcher = watcher;
  }

  /** Stop the watcher and clear any pending debounce timer. */
  static async stopAll(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.state = 'stopped';
  }

  /** Return the current watcher state for debugging and future status surfaces. */
  static getStatus() {
    return {
      state: this.state,
      watchingPath: this.watcher ? runtimePaths.customNodesDir : null,
      isSyncRunning: this.isSyncRunning,
      hasPendingSync: this.hasPendingSync,
    };
  }

  /** Debounce file-system bursts before resyncing custom nodes into module_definitions. */
  private static scheduleRegistrySync() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRegistrySync();
    }, this.RESCAN_DEBOUNCE_MS);
  }

  /** Run one registry sync, coalescing overlapping watcher bursts into one follow-up pass. */
  private static async runRegistrySync(): Promise<void> {
    if (this.isSyncRunning) {
      this.hasPendingSync = true;
      return;
    }

    this.isSyncRunning = true;

    try {
      const result = await CustomNodeRegistryService.syncCustomNodesFromFileSystem();
      console.log(`🧩 Custom node watcher sync complete: ${result.nodes.length} loaded, ${result.errors.length} errors, ${result.createdCount} created, ${result.updatedCount} updated, ${result.deactivatedCount} deactivated`);
    } catch (error) {
      console.warn('⚠️  Custom node watcher sync failed:', error instanceof Error ? error.message : error);
    } finally {
      this.isSyncRunning = false;
    }

    if (this.hasPendingSync) {
      this.hasPendingSync = false;
      await this.runRegistrySync();
    }
  }
}
