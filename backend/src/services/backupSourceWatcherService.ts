import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { isSupportedExtension } from '../constants/supportedExtensions';
import { existingBackupFiles, importBackupFile } from './backupSourceImporter';
import { assertBackupSourceDirectory, BackupSource, BackupSourceService, ensureBackupTargetDirectory, normalizeBackupComparePath } from './backupSourceService';
import { clampWatcherPollingIntervalMs } from './fileWatcher/fileWatcherPathUtils';
import { restartWatcherAfterDelay, waitForChokidarReady } from './watcherLifecycleUtils';

const isVerboseBackupWatcherLoggingEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

type WatcherState = 'initializing' | 'watching' | 'error' | 'stopped';

interface BackupWatcherEntry {
  sourceId: number;
  controller: AbortController;
  ready?: Promise<void>;
  closing?: Promise<void>;
  stopRequests: number;
  watcher?: FSWatcher;
  tasks: Set<Promise<unknown>>;
  imports: Set<string>;
  state: WatcherState;
}

interface InitialImportSummary {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
}

export class BackupSourceWatcherService {
  private static watcherRegistry = new Map<number, BackupWatcherEntry>();
  private static pendingRestarts = new Map<number, AbortController>();
  // 초기 임포트는 오래 걸릴 수 있으므로 이 간격마다 소스 활성 여부를 다시 읽는다.
  private static readonly INITIAL_IMPORT_ACTIVE_RECHECK_INTERVAL = 100;

  /** Start all enabled backup source watchers on boot. */
  static async initialize(signal?: AbortSignal): Promise<void> {
    const sources = await BackupSourceService.listSources({ active_only: true });

    for (const source of sources) {
      if (signal?.aborted) {
        break;
      }

      if (source.watcher_enabled !== 1) {
        continue;
      }

      try {
        await this.startWatcher(source.id, signal);
      } catch (error) {
        if (signal?.aborted) {
          await this.stopWatcher(source.id);
          break;
        }

        if (!(error instanceof Error && error.name === 'AbortError')) console.warn(`⚠️  백업 소스 워처 시작 실패: ${source.display_name || source.source_path}`, error);
      }
    }

    console.log(`📥 Backup source watchers ready: ${this.watcherRegistry.size} active`);
  }

  /** Start a watcher for one backup source. */
  static async startWatcher(sourceId: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const existing = this.watcherRegistry.get(sourceId);
    if (existing) {
      const closing = existing.closing ?? (existing.state === 'error' ? this.stopWatcher(sourceId) : undefined);
      if (!closing) return existing.ready;
      const version = existing.stopRequests;
      await closing;
      if (version !== existing.stopRequests) throw new DOMException('Watcher start cancelled', 'AbortError');
      return this.startWatcher(sourceId, signal);
    }
    // Register before the first await so a concurrent start shares readiness and stop can cancel a lookup.
    const entry: BackupWatcherEntry = { sourceId, state: 'initializing', stopRequests: 0, controller: new AbortController(), tasks: new Set(), imports: new Set() };
    this.watcherRegistry.set(sourceId, entry);
    const startup = signal ? AbortSignal.any([signal, entry.controller.signal]) : entry.controller.signal;
    entry.ready = this.openWatcher(entry, startup).catch(async error => {
      if (!entry.controller.signal.aborted) {
        if (!startup.aborted) BackupSourceService.updateWatcherState(sourceId, 'error', error instanceof Error ? error.message : 'Unknown error');
        entry.controller.abort();
        await entry.watcher?.close();
        await Promise.allSettled(entry.tasks);
        if (this.watcherRegistry.get(sourceId) === entry) this.watcherRegistry.delete(sourceId);
      }
      throw error;
    });
    return entry.ready;
  }

  private static async openWatcher(entry: BackupWatcherEntry, signal: AbortSignal): Promise<void> {
    const { sourceId } = entry;
    const source = await BackupSourceService.getSource(sourceId);
    signal.throwIfAborted();
    if (!source || source.is_active !== 1) {
      throw new Error(`백업 소스를 찾을 수 없거나 비활성화됨: ${sourceId}`);
    }

    assertBackupSourceDirectory(source.source_path);
    const root = ensureBackupTargetDirectory(source.target_folder_name);

    const isNetworkPath = source.source_path.startsWith('\\\\') || source.source_path.startsWith('//');
    const usePolling = source.watcher_polling_interval != null || isNetworkPath;
    const pollingInterval = source.watcher_polling_interval != null
      ? clampWatcherPollingIntervalMs(source.watcher_polling_interval, source.source_path)
      : (isNetworkPath ? 5000 : undefined);

    const watcher = chokidar.watch(source.source_path, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 100,
      },
      depth: source.recursive === 1 ? undefined : 0,
      usePolling,
      interval: pollingInterval,
    });

    entry.watcher = watcher;
    BackupSourceService.updateWatcherState(sourceId, 'initializing', null);

    watcher.on('add', (filePath) => {
      if (!entry.controller.signal.aborted && isSupportedExtension(path.extname(filePath))) {
        this.trackTask(entry, this.importOne(entry, source, root, filePath, false));
      }
    });

    watcher.on('error', (error) => {
      if (entry.controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Unknown error';
      entry.state = 'error';
      BackupSourceService.updateWatcherState(sourceId, 'error', message);
    });

    await waitForChokidarReady({
      watcher, signal, timeoutMessage: '백업 소스 워처 초기화 타임아웃',
      onReady: () => {
        entry.state = 'watching';
        BackupSourceService.updateWatcherState(sourceId, 'watching', null);
        this.trackTask(entry, this.runInitialImport(entry, source, root));
      },
    });
  }

  /** Stop a watcher for one backup source. */
  static async stopWatcher(sourceId: number): Promise<void> {
    this.pendingRestarts.get(sourceId)?.abort();
    this.pendingRestarts.delete(sourceId);
    const entry = this.watcherRegistry.get(sourceId);
    if (!entry) {
      BackupSourceService.updateWatcherState(sourceId, 'stopped', null);
      return;
    }

    entry.stopRequests++;
    if (entry.closing) return entry.closing;
    entry.state = 'stopped';
    entry.controller.abort();
    entry.closing = (async () => {
      try { await entry.watcher?.close(); }
      finally {
        await Promise.allSettled([entry.ready, ...entry.tasks]);
        this.watcherRegistry.delete(sourceId);
        BackupSourceService.updateWatcherState(sourceId, 'stopped', null);
      }
    })();
    return entry.closing;
  }

  /** Close every watcher, then drain imports that already own filesystem work. */
  static async stopAll(): Promise<void> {
    const sourceIds = [...new Set([...this.watcherRegistry.keys(), ...this.pendingRestarts.keys()])];
    await Promise.allSettled(sourceIds.map((sourceId) => this.stopWatcher(sourceId)));
  }

  private static trackTask(entry: BackupWatcherEntry, task: Promise<unknown>): void {
    entry.tasks.add(task);
    void task.then(() => entry.tasks.delete(task), error => {
      entry.tasks.delete(task);
      if (entry.controller.signal.aborted) return;
      BackupSourceService.updateWatcherState(entry.sourceId, 'error', error instanceof Error ? error.message : 'Unknown error');
      console.error(`❌ [BackupSource] 초기 스캔 실패: ${entry.sourceId}`, error);
    });
  }

  /** Restart a watcher for one backup source. */
  static async restartWatcher(sourceId: number): Promise<void> {
    await restartWatcherAfterDelay(this.pendingRestarts, sourceId, 300,
      () => this.stopWatcher(sourceId),
      (signal) => this.startWatcher(sourceId, signal));
  }

  /** Scan the current source tree once so existing files are imported too. */
  private static async runInitialImport(entry: BackupWatcherEntry, source: BackupSource, root: string): Promise<void> {
    const summary: InitialImportSummary = { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    for await (const file of existingBackupFiles(source.source_path, source.recursive === 1, entry.controller.signal)) {
      if (entry.state !== 'watching') break;
      if (summary.scanned && summary.scanned % this.INITIAL_IMPORT_ACTIVE_RECHECK_INTERVAL === 0
        && (await BackupSourceService.getSource(source.id))?.is_active !== 1) break;
      summary.scanned++;
      summary[await this.importOne(entry, source, root, file, true)]++;
    }
    if (summary.imported || summary.failed || isVerboseBackupWatcherLoggingEnabled) {
      console.log(`📥 [BackupSource] Initial sync: ${source.display_name || source.source_path} (scanned=${summary.scanned}, imported=${summary.imported}, skipped=${summary.skipped}, failed=${summary.failed})`);
    }
  }

  /** Import a newly added supported media file into uploads. */
  private static async importOne(entry: BackupWatcherEntry, source: BackupSource, root: string, filePath: string, initial: boolean): Promise<'imported' | 'skipped' | 'failed'> {
    const { signal } = entry.controller;
    const key = process.platform === 'win32' ? normalizeBackupComparePath(filePath) : path.resolve(filePath);
    if (signal.aborted || entry.imports.has(key)) return 'skipped';
    entry.imports.add(key);
    try {
      if (!initial && (await BackupSourceService.getSource(source.id))?.is_active !== 1) return 'skipped';
      const targetPath = await importBackupFile(source, root, filePath, initial, signal);
      if (!targetPath) return 'skipped';
      if (!signal.aborted && entry.state !== 'error') BackupSourceService.updateWatcherLastEvent(source.id);

      if (isVerboseBackupWatcherLoggingEnabled) {
        console.log(`📥 [BackupSource] ${path.basename(filePath)} -> ${targetPath}`);
      }
      return 'imported';
    } catch (error) {
      if (signal.aborted) return 'skipped';
      const message = error instanceof Error ? error.message : 'Unknown error';
      BackupSourceService.updateWatcherState(source.id, 'error', message);
      console.error(`❌ [BackupSource] 파일 가져오기 실패: ${filePath}`, error);
      return 'failed';
    } finally {
      entry.imports.delete(key);
    }
  }
}
