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
  private static generation = 0;
  private static activeSync: Promise<void> | null = null;
  private static stopping: Promise<void> | null = null;
  private static hasPendingSync = false;

  /** Start one chokidar watcher for local file-based custom node folders. */
  static async initialize(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();

    if (this.watcher || this.stopping) {
      return;
    }

    const generation = this.generation;
    this.state = 'initializing';
    try {
      await CustomNodeRegistryService.ensureCustomNodesDirectory();
      signal?.throwIfAborted();
    } catch (error) {
      if (generation === this.generation && !this.watcher) this.state = signal?.aborted ? 'stopped' : 'error';
      throw error;
    }
    if (generation !== this.generation || this.watcher) return;

    const watcher = chokidar.watch(runtimePaths.customNodesDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
      depth: 3,
    });

    this.watcher = watcher;
    const scheduleSync = (eventType: string, targetPath: string) => {
      if (this.watcher !== watcher) return;
      console.log(`🧩 Custom node watcher event: ${eventType} -> ${targetPath}`);
      this.scheduleRegistrySync(watcher);
    };

    watcher
      .on('add', (targetPath) => scheduleSync('add', targetPath))
      .on('change', (targetPath) => scheduleSync('change', targetPath))
      .on('unlink', (targetPath) => scheduleSync('unlink', targetPath))
      .on('addDir', (targetPath) => scheduleSync('addDir', targetPath))
      .on('unlinkDir', (targetPath) => scheduleSync('unlinkDir', targetPath))
      .on('error', (error) => {
        if (this.watcher !== watcher) return;
        this.state = 'error';
        console.warn('⚠️  Custom node watcher error:', error instanceof Error ? error.message : error);
      })
      .on('ready', () => {
        if (this.watcher !== watcher) return;
        this.state = 'watching';
        console.log(`✅ Custom node watcher ready: ${runtimePaths.customNodesDir}`);
      });
  }

  /** Detach callbacks immediately, then drain the accepted scan before SQLite closes. */
  static stopAll(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.generation++;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const watcher = this.watcher;
    this.watcher = null;
    this.hasPendingSync = false;
    this.state = 'stopped';
    this.stopping = (async () => {
      try { await watcher?.close(); } finally { await this.activeSync; }
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  /** Return the current watcher state for debugging and future status surfaces. */
  static getStatus() {
    return {
      state: this.state,
      watchingPath: this.watcher ? runtimePaths.customNodesDir : null,
      isSyncRunning: this.activeSync !== null,
      hasPendingSync: this.hasPendingSync,
    };
  }

  /** Debounce file-system bursts before resyncing custom nodes into module_definitions. */
  private static scheduleRegistrySync(watcher: FSWatcher) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.watcher === watcher) this.runRegistrySync(watcher);
    }, this.RESCAN_DEBOUNCE_MS);
  }

  /** Run one registry sync, coalescing overlapping watcher bursts into one follow-up pass. */
  private static runRegistrySync(watcher: FSWatcher) {
    if (this.activeSync) {
      this.hasPendingSync = true;
      return;
    }

    this.activeSync = (async () => {
      do {
        this.hasPendingSync = false;
        try {
          const result = await CustomNodeRegistryService.syncCustomNodesFromFileSystem();
          console.log(`🧩 Custom node watcher sync complete: ${result.nodes.length} loaded, ${result.errors.length} errors, ${result.createdCount} created, ${result.updatedCount} updated, ${result.deactivatedCount} deactivated`);
        } catch (error) {
          console.warn('⚠️  Custom node watcher sync failed:', error instanceof Error ? error.message : error);
        }
      } while (this.watcher === watcher && this.hasPendingSync);
    })().finally(() => { this.activeSync = null; });
  }
}
