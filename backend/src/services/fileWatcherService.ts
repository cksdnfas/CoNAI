/**
 * FileWatcherService - 실시간 파일 모니터링 서비스
 *
 * Chokidar를 사용한 폴더별 파일 시스템 이벤트 감지
 * - 새 파일 추가 감지 및 자동 처리
 * - 파일 수정 감지 및 메타데이터 업데이트
 * - 파일 삭제 감지 및 DB 정리
 * - 오류 복구 및 재시도 메커니즘
 */

import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
import { FolderScanService } from './folderScan';
import { shouldProcessFileExtension } from '../constants/supportedExtensions';
import {
  disableWatcherInDatabase,
  findWatchedFolderForWatcher,
  listAutoScanWatcherFolders,
  deleteWatchedFileRecord,
  updateWatcherLastEventInDatabase,
  updateWatcherStatusInDatabase,
  watchedFolderExists,
  type WatchedFolderWatcherRecord,
} from './fileWatcher/fileWatcherStore';
import {
  parseWatcherJsonArray,
  prepareWatcherStartPath,
  resolveWatcherPollingOptions,
  validateInitialWatcherPath,
} from './fileWatcher/fileWatcherPathUtils';
import {
  removeWatcherRuntimeStatus,
  setWatcherRuntimeStatus,
  type WatcherRuntimeState,
} from './fileWatcher/watcherRuntimeStatus';
import { createExcludePatternMatcher } from './folderScan/excludePatternUtils';
import { resolveWatcherReadyTimeoutMs, sleep, waitForChokidarReady } from './watcherLifecycleUtils';

const isVerboseScanDebugEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

/**
 * 워처 상태
 */
type WatcherState = WatcherRuntimeState;

/**
 * 워처 레지스트리 엔트리
 */
interface WatcherEntry {
  folderId: number;
  folderPath: string;
  folderName: string;
  watcher: FSWatcher;
  state: WatcherState;
  error?: string;
  lastEvent?: Date;
  eventCount: number;
  retryAttempts: number;
  isRetrying?: boolean;  // 재시도 진행 중 플래그 (중복 재시도 방지)
}

interface WatcherRetryState {
  retryAttempts: number;
  isRetrying: boolean;
}

/**
 * 워처 설정
 */
interface WatcherOptions {
  recursive: boolean;
  excludeExtensions: string[];
  excludePatterns: string[];
}

interface FileWatcherScanState {
  processingFolders: Set<number>;
  folderScanTimers: Map<number, NodeJS.Timeout>;
  pendingFiles: Map<number, Set<string>>;
}

/** Build the parsed watcher rules that are reused across startup and events. */
function buildWatcherOptions(folder: WatchedFolderWatcherRecord): WatcherOptions {
  return {
    recursive: folder.recursive === 1,
    excludeExtensions: parseWatcherJsonArray(folder.exclude_extensions),
    excludePatterns: parseWatcherJsonArray(folder.exclude_patterns),
  };
}

/** Build the chokidar runtime options for one watched folder. */
function buildChokidarOptions(
  folder: WatchedFolderWatcherRecord,
  resolvedPath: string,
  stabilityThreshold: number,
  watcherOptions: WatcherOptions,
) {
  const pollingOptions = resolveWatcherPollingOptions(folder, resolvedPath);

  if (pollingOptions.pollingReason === 'network-drive') {
    console.warn(`  ⚠️  네트워크 드라이브 감지: ${folder.folder_name}`);
    console.warn(`     폴링 모드 활성화 (간격: ${pollingOptions.pollingInterval}ms)`);
  }

  return {
    // chokidar compares string matchers with exact equality, so bare exclude
    // names must be applied through a MatchFunction instead. 판정은 감시 루트
    // 기준 상대 경로로만 수행한다 (루트 자신이 패턴과 겹쳐 통째로 무시되는 것 방지).
    ignored: createExcludePatternMatcher(watcherOptions.excludePatterns, resolvedPath),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval: 100,
    },
    depth: watcherOptions.recursive ? undefined : 0,
    usePolling: pollingOptions.usePolling,
    interval: pollingOptions.pollingInterval,
    alwaysStat: true,
  };
}

/** Record one watcher event and persist its last-event timestamp. */
function recordWatcherEvent(entry: WatcherEntry, updateLastEventTime: (folderId: number) => void): void {
  entry.eventCount += 1;
  entry.lastEvent = new Date();
  updateLastEventTime(entry.folderId);
}

/** Clear queued scan timers and pending files for one folder. */
function cleanupFolderScanState(scanState: FileWatcherScanState, folderId: number): void {
  scanState.pendingFiles.delete(folderId);

  const timer = scanState.folderScanTimers.get(folderId);
  if (timer) {
    clearTimeout(timer);
    scanState.folderScanTimers.delete(folderId);
  }

  scanState.processingFolders.delete(folderId);

  if (isVerboseScanDebugEnabled) {
    console.log(`  🧹 상태 정리 완료: folderId=${folderId}`);
  }
}

/** Schedule one debounced folder scan, replacing any older timer. */
function scheduleFolderBatchScan(
  scanState: FileWatcherScanState,
  folderId: number,
  scanDebounceMs: number,
  runBatchScan: (folderId: number) => void,
): void {
  const existingTimer = scanState.folderScanTimers.get(folderId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    runBatchScan(folderId);
  }, scanDebounceMs);

  scanState.folderScanTimers.set(folderId, timer);
}

/** Queue one file for the next debounced folder scan. */
function queueFolderBatchScan(
  scanState: FileWatcherScanState,
  folderId: number,
  filePath: string,
  scanDebounceMs: number,
  runBatchScan: (folderId: number) => void,
): void {
  if (!scanState.pendingFiles.has(folderId)) {
    scanState.pendingFiles.set(folderId, new Set());
  }
  scanState.pendingFiles.get(folderId)!.add(filePath);

  if (isVerboseScanDebugEnabled) {
    console.log(`  📝 파일 큐에 추가: ${path.basename(filePath)} (대기 중: ${scanState.pendingFiles.get(folderId)!.size}개)`);
  }

  scheduleFolderBatchScan(scanState, folderId, scanDebounceMs, runBatchScan);
}

/** Run one deferred folder scan while keeping folder-level scan locking consistent. */
async function runQueuedFolderScan(
  scanState: FileWatcherScanState,
  folderId: number,
  scanDebounceMs: number,
  runBatchScan: (folderId: number) => void,
): Promise<void> {
  scanState.folderScanTimers.delete(folderId);

  if (!watchedFolderExists(folderId)) {
    console.warn(`  ⚠️  배치 스캔 취소: 폴더 삭제됨 folderId=${folderId}`);
    cleanupFolderScanState(scanState, folderId);
    return;
  }

  if (scanState.processingFolders.has(folderId)) {
    if (isVerboseScanDebugEnabled) {
      console.log(`  ⏭️  폴더 스캔 이미 진행 중: folderId=${folderId}`);
    }
    scheduleFolderBatchScan(scanState, folderId, scanDebounceMs, runBatchScan);
    return;
  }

  const pendingFileSet = scanState.pendingFiles.get(folderId);
  if (!pendingFileSet || pendingFileSet.size === 0) {
    return;
  }

  const pendingFiles = Array.from(pendingFileSet);
  const fileCount = pendingFiles.length;
  if (isVerboseScanDebugEnabled) {
    console.log(`  🚀 배치 스캔 시작: folderId=${folderId}, 대기 파일 ${fileCount}개`);
  }

  scanState.pendingFiles.delete(folderId);
  scanState.processingFolders.add(folderId);
  let completed = false;

  try {
    const result = await FolderScanService.scanFolder(folderId, false, {
      quietIfNoChanges: true,
      candidateFiles: pendingFiles,
    });

    if (isVerboseScanDebugEnabled || result.newImages > 0 || result.updatedPaths > 0 || result.missingImages > 0 || result.errors.length > 0) {
      console.log(`  ✅ 배치 스캔 완료: 신규 ${result.newImages}개, 기존 ${result.existingImages}개, 업데이트 ${result.updatedPaths}개, 오류 ${result.errors.length}개`);
    }

    completed = true;
  } catch (error) {
    const retryFiles = scanState.pendingFiles.get(folderId) ?? new Set<string>();
    for (const filePath of pendingFiles) {
      retryFiles.add(filePath);
    }
    scanState.pendingFiles.set(folderId, retryFiles);
    console.error(`  ❌ 배치 스캔 실패: folderId=${folderId}`, error);
  } finally {
    scanState.processingFolders.delete(folderId);
    if (completed && (scanState.pendingFiles.get(folderId)?.size ?? 0) > 0) {
      scheduleFolderBatchScan(scanState, folderId, scanDebounceMs, runBatchScan);
    }
  }
}

/** Delete one tracked file row for an unlink event. A later scan can relink moved/renamed duplicates by hash. */
function deleteWatcherFileRecord(filePath: string): void {
  const changes = deleteWatchedFileRecord(filePath);

  if (changes > 0) {
    console.warn(`⚠️  Watched file deleted from DB: ${path.basename(filePath)}`);
  } else if (isVerboseScanDebugEnabled) {
    console.log(`  ℹ️  파일이 데이터베이스에 없음: ${path.basename(filePath)}`);
  }
}

/** Disable one watcher after retry recovery is no longer safe to continue. */
function disableWatcherAfterRetryFailure(folderId: number, folderName: string, errorMessage: string): void {
  try {
    disableWatcherInDatabase(folderId, errorMessage);
    console.error(`  🔒 워처 자동 비활성화됨: ${folderName}`);
  } catch (dbError) {
    console.error('  ❌ DB 업데이트 실패:', dbError);
  }
}

/** Compute the exponential backoff delay for the next watcher restart attempt. */
function getWatcherRetryDelay(retryDelayMs: number, retryAttempts: number): number {
  return retryDelayMs * Math.pow(2, retryAttempts - 1);
}

/** Wait for one chokidar watcher to either become ready or fail during boot. */
async function waitForWatcherReady(
  entry: WatcherEntry,
  updateWatcherStatus: (folderId: number, status: string, error: string | null) => void,
  timeoutMs: number,
): Promise<void> {
  await waitForChokidarReady({
    watcher: entry.watcher,
    timeoutMs,
    timeoutMessage: '워처 초기화 타임아웃',
    onReady: () => {
      entry.state = 'watching';
      updateWatcherStatus(entry.folderId, 'watching', null);
    },
    onError: (_error, errorMessage) => {
      entry.state = 'error';
      entry.error = errorMessage;
      updateWatcherStatus(entry.folderId, 'error', errorMessage);
    },
  });
}

/**
 * 파일 워처 서비스
 */
export class FileWatcherService {
  // 워처 레지스트리 (folderId → WatcherEntry)
  private static watcherRegistry = new Map<number, WatcherEntry>();

  // 처리 중인 폴더 (폴더 단위 락킹)
  private static scanState: FileWatcherScanState = {
    processingFolders: new Set<number>(),
    folderScanTimers: new Map<number, NodeJS.Timeout>(),
    pendingFiles: new Map<number, Set<string>>(),
  };

  // 설정
  private static readonly MAX_WATCHERS = parseInt(process.env.MAX_WATCHERS || '50');
  private static readonly SCAN_DEBOUNCE_MS = parseInt(process.env.SCAN_DEBOUNCE_MS || '2000'); // 폴더 스캔 디바운스 (2초)
  private static readonly STABILITY_THRESHOLD = parseInt(process.env.WATCHER_STABILITY_THRESHOLD || '2000');
  private static readonly MAX_RETRY_ATTEMPTS = parseInt(process.env.WATCHER_RETRY_ATTEMPTS || '3');
  private static readonly RETRY_DELAY_MS = parseInt(process.env.WATCHER_RETRY_DELAY_MS || '5000');
  private static readonly READY_TIMEOUT_MS = resolveWatcherReadyTimeoutMs();

  private static syncRuntimeStatus(entry: WatcherEntry): void {
    setWatcherRuntimeStatus({
      folderId: entry.folderId,
      folderPath: entry.folderPath,
      folderName: entry.folderName,
      state: entry.state,
      error: entry.error,
      lastEvent: entry.lastEvent,
      eventCount: entry.eventCount,
      retryAttempts: entry.retryAttempts,
      isRetrying: entry.isRetrying,
    });
  }

  /**
   * 서비스 초기화
   */
  static async initialize(): Promise<void> {
    try {
      const folders = listAutoScanWatcherFolders();

      let startedCount = 0;
      let errorCount = 0;

      for (const folder of folders) {
        if (folder.watcher_enabled === 1) {
          try {
            const validation = validateInitialWatcherPath(folder.folder_path);
            if (!validation.isValid) {
              console.warn(`  ⏭️  워처 건너뜀 (${validation.errorMessage}): ${folder.folder_name}`);
              console.warn(`     경로: ${validation.resolvedPath}`);
              disableWatcherInDatabase(folder.id, validation.errorMessage || '초기화 시 경로 접근 실패');
              errorCount++;
              continue;
            }

            await this.startWatcher(folder.id);
            startedCount++;
          } catch (error) {
            errorCount++;
            console.error(`  ❌ 워처 시작 실패: ${folder.folder_name}`, error);

            try {
              const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
              disableWatcherInDatabase(folder.id, `초기화 실패: ${errorMessage}`);
            } catch (dbError) {
              console.error('  ❌ DB 업데이트 실패:', dbError);
            }
          }
        }
      }

      if (startedCount > 0) {
        console.log(`👀 File watchers ready: ${startedCount} active, ${errorCount} issues`);
      } else if (errorCount > 0) {
        console.warn(`⚠️  File watcher startup failed for all folders (${errorCount} issues)`);
      } else {
        console.log('👀 File watchers: no enabled folders');
      }
    } catch (error) {
      console.error('❌ FileWatcherService 초기화 실패:', error);
      console.warn('⚠️  일부 워처 초기화 실패. 서버는 계속 실행됩니다.');
    }
  }

  /**
   * 워처 시작
   */
  static async startWatcher(
    folderId: number,
    retryState: WatcherRetryState = { retryAttempts: 0, isRetrying: false },
  ): Promise<void> {
    if (this.watcherRegistry.size >= this.MAX_WATCHERS) {
      throw new Error(`최대 워처 수 초과 (${this.MAX_WATCHERS})`);
    }

    const existing = this.watcherRegistry.get(folderId);
    if (existing && existing.state === 'watching') {
      return;
    }

    if (existing) {
      await this.stopWatcher(folderId);
    }

    const folder = findWatchedFolderForWatcher(folderId);
    if (!folder) {
      throw new Error(`폴더를 찾을 수 없거나 비활성화됨: folderId=${folderId}`);
    }

    const preparedPath = prepareWatcherStartPath(folder.folder_path);
    const resolvedPath = preparedPath.resolvedPath;
    if (isVerboseScanDebugEnabled) {
      console.log(`👀 [Watcher Debug] 경로 해석: ${folder.folder_path} → ${resolvedPath}`);
    }

    if (!preparedPath.isReady) {
      console.warn(`  ⚠️  워처 건너뜀 (${preparedPath.skipReason}): ${folder.folder_name}`);
      console.warn(`     경로: ${resolvedPath}`);
      return;
    }

    if (preparedPath.wasCreated) {
      console.log(`📁 Watcher created missing folder: ${resolvedPath}`);
    }

    if (isVerboseScanDebugEnabled) {
      console.log('👀 [Watcher Debug] 경로 접근 권한 확인 완료');
    }

    const watcherOptions = buildWatcherOptions(folder);
    const chokidarOptions = buildChokidarOptions(folder, resolvedPath, this.STABILITY_THRESHOLD, watcherOptions);
    const watcher = chokidar.watch(resolvedPath, chokidarOptions);

    const entry: WatcherEntry = {
      folderId,
      folderPath: resolvedPath,
      folderName: folder.folder_name,
      watcher,
      state: 'initializing',
      eventCount: 0,
      retryAttempts: retryState.retryAttempts,
      isRetrying: retryState.isRetrying,
    };

    this.watcherRegistry.set(folderId, entry);
    this.syncRuntimeStatus(entry);
    this.registerEventHandlers(entry, watcherOptions.excludeExtensions);
    try {
      await waitForWatcherReady(entry, this.updateWatcherStatus.bind(this), this.READY_TIMEOUT_MS);
      this.syncRuntimeStatus(entry);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      entry.state = 'error';
      entry.error = errorMessage;
      this.updateWatcherStatus(folderId, 'error', errorMessage);
      this.syncRuntimeStatus(entry);

      try {
        await watcher.close();
      } catch (closeError) {
        console.warn(`  ⚠️  실패한 워처 정리 실패: ${entry.folderName}`, closeError);
      }

      throw error;
    }
  }

  /**
   * 이벤트 핸들러 등록
   */
  private static registerEventHandlers(entry: WatcherEntry, excludeExtensions: string[]): void {
    const { watcher, folderName } = entry;

    watcher.on('add', async (filePath: string) => {
      if (!this.shouldProcessExistingFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));
      this.syncRuntimeStatus(entry);

      if (isVerboseScanDebugEnabled) {
        console.log(`👀 [워처:${folderName}] 파일 추가: ${path.basename(filePath)}`);
      }

      await this.handleAddEvent(filePath, entry.folderId);
    });

    watcher.on('change', async (filePath: string) => {
      if (!this.shouldProcessExistingFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));
      this.syncRuntimeStatus(entry);

      if (isVerboseScanDebugEnabled) {
        console.log(`📝 [워처:${folderName}] 파일 변경: ${path.basename(filePath)}`);
      }

      await this.handleChangeEvent(filePath, entry.folderId);
    });

    watcher.on('unlink', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));
      this.syncRuntimeStatus(entry);

      if (isVerboseScanDebugEnabled) {
        console.log(`🗑️  [워처:${folderName}] 파일 삭제: ${path.basename(filePath)}`);
      }

      this.handleUnlinkEvent(filePath);
    });

    watcher.on('error', async (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [워처:${folderName}] 오류:`, error);
      entry.state = 'error';
      entry.error = errorMessage;
      this.syncRuntimeStatus(entry);
      this.updateWatcherStatus(entry.folderId, 'error', errorMessage);

      await this.scheduleWatcherRestart(entry.folderId);
    });
  }

  /**
   * 'add' 이벤트 처리
   * 이벤트 큐잉 + 디바운스로 배치 처리 (연속 생성 최적화)
   */
  private static async handleAddEvent(filePath: string, folderId: number): Promise<void> {
    try {
      // 쓰기 완료 대기는 chokidar awaitWriteFinish(stabilityThreshold)가 담당
      queueFolderBatchScan(this.scanState, folderId, filePath, this.SCAN_DEBOUNCE_MS, (queuedFolderId) => {
        void this.executeBatchScan(queuedFolderId);
      });
    } catch (error) {
      console.error(`  ❌ 파일 이벤트 처리 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * 배치 스캔 실행 (디바운스 타이머 완료 후)
   */
  private static async executeBatchScan(folderId: number): Promise<void> {
    await runQueuedFolderScan(this.scanState, folderId, this.SCAN_DEBOUNCE_MS, (queuedFolderId) => {
      void this.executeBatchScan(queuedFolderId);
    });
  }

  /**
   * 'change' 이벤트 처리
   * 변경된 파일만 다음 폴더 배치에 합류
   */
  private static async handleChangeEvent(filePath: string, folderId: number): Promise<void> {
    try {
      queueFolderBatchScan(this.scanState, folderId, filePath, this.SCAN_DEBOUNCE_MS, (queuedFolderId) => {
        void this.executeBatchScan(queuedFolderId);
      });
    } catch (error) {
      console.error(`  ❌ 파일 변경 이벤트 처리 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * 'unlink' 이벤트 처리
   */
  private static handleUnlinkEvent(filePath: string): void {
    try {
      deleteWatcherFileRecord(filePath);
    } catch (error) {
      console.error(`  ❌ 파일 상태 변경 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * Clean up all in-memory state for a folder
   */
  private static cleanupFolderState(folderId: number): void {
    cleanupFolderScanState(this.scanState, folderId);
  }

  /**
   * 워처 중지
   */
  static async stopWatcher(folderId: number): Promise<void> {
    const entry = this.watcherRegistry.get(folderId);
    if (!entry) {
      removeWatcherRuntimeStatus(folderId);
      this.cleanupFolderState(folderId);
      return;
    }

    try {
      await entry.watcher.close();
      entry.state = 'stopped';
      this.watcherRegistry.delete(folderId);
      removeWatcherRuntimeStatus(folderId);
      this.cleanupFolderState(folderId);
      this.updateWatcherStatus(folderId, 'stopped', null);
    } catch (error) {
      console.error(`  ❌ 워처 중지 실패: ${entry.folderName}`, error);
      throw error;
    }
  }

  /**
   * 워처 재시작
   */
  static async restartWatcher(folderId: number, retryState?: WatcherRetryState): Promise<void> {
    console.warn(`⚠️  Restarting watcher: folderId=${folderId}`);
    await this.stopWatcher(folderId);
    await sleep(1000);
    await this.startWatcher(folderId, retryState);
  }

  /**
   * 워처 재시작 예약 (오류 복구)
   */
  private static async scheduleWatcherRestart(folderId: number): Promise<void> {
    const entry = this.watcherRegistry.get(folderId);
    if (!entry) return;

    if (entry.isRetrying) {
      if (isVerboseScanDebugEnabled) {
        console.log(`  ⏭️  재시도 이미 진행 중: ${entry.folderName}`);
      }
      return;
    }

    if (entry.retryAttempts >= this.MAX_RETRY_ATTEMPTS) {
      console.error(`  ❌ 최대 재시도 횟수 초과: ${entry.folderName}`);
      entry.state = 'error';
      this.syncRuntimeStatus(entry);
      disableWatcherAfterRetryFailure(folderId, entry.folderName, '최대 재시도 횟수 초과 - 자동 비활성화됨');
      return;
    }

    entry.retryAttempts += 1;
    this.syncRuntimeStatus(entry);

    const delay = getWatcherRetryDelay(this.RETRY_DELAY_MS, entry.retryAttempts);
    console.warn(`⚠️  Watcher restart scheduled: ${entry.folderName} (${delay}ms, attempt ${entry.retryAttempts}/${this.MAX_RETRY_ATTEMPTS})`);

    entry.isRetrying = true;
    this.syncRuntimeStatus(entry);

    const retryState: WatcherRetryState = {
      retryAttempts: entry.retryAttempts,
      isRetrying: true,
    };
    const folderName = entry.folderName;

    setTimeout(async () => {
      try {
        await this.restartWatcher(folderId, retryState);
        const restartedEntry = this.watcherRegistry.get(folderId);
        if (restartedEntry) {
          restartedEntry.retryAttempts = 0;
          restartedEntry.isRetrying = false;
          this.syncRuntimeStatus(restartedEntry);
        }
        console.warn(`✅ Watcher recovered: ${folderName}`);
      } catch (error) {
        console.error(`  ❌ 워처 재시작 실패: ${folderName}`, error);
        const failedEntry = this.watcherRegistry.get(folderId);
        if (!failedEntry) {
          return;
        }

        failedEntry.isRetrying = false;
        this.syncRuntimeStatus(failedEntry);

        if (failedEntry.retryAttempts < this.MAX_RETRY_ATTEMPTS) {
          await this.scheduleWatcherRestart(folderId);
        } else {
          console.error('  ❌ 최대 재시도 횟수 도달, 워처 비활성화');
          failedEntry.state = 'error';
          this.syncRuntimeStatus(failedEntry);
          disableWatcherAfterRetryFailure(folderId, failedEntry.folderName, '재시작 실패 - 자동 비활성화됨');
        }
      }
    }, delay);
  }

  /**
   * 모든 워처 중지
   */
  static async stopAll(): Promise<void> {
    const folderIds = Array.from(this.watcherRegistry.keys());
    for (const folderId of folderIds) {
      await this.stopWatcher(folderId);
    }
  }

  /**
   * 워처 상태 조회
   */
  static getWatcherStatus(folderId: number): WatcherEntry | null {
    return this.watcherRegistry.get(folderId) || null;
  }

  /**
   * 모든 워처 상태 조회
   */
  static getAllWatcherStatuses(): WatcherEntry[] {
    return Array.from(this.watcherRegistry.values());
  }

  /**
   * 파일 처리 여부 확인 (확장자 필터만)
   * unlink 이벤트처럼 경로가 이미 사라진 경우에도 판정 가능해야 한다.
   */
  private static shouldProcessFile(filePath: string, excludeExtensions: string[]): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return shouldProcessFileExtension(ext, excludeExtensions);
  }

  /**
   * add/change 이벤트 처리 여부 확인 (확장자 필터 + 심볼릭 링크 스킵)
   *
   * chokidar가 넘겨주는 stats는 followSymlinks 기본값(true) 때문에 링크를 따라간
   * fs.stat 결과라 isSymbolicLink()가 항상 false다. 링크 판정은 lstat로만 가능하므로
   * 심볼릭 링크 검사는 lstat 프로브로 되돌린다. followSymlinks를 끄면 링크 디렉토리
   * traversal까지 사라져 감시 범위 자체가 바뀌므로 chokidar 옵션은 건드리지 않는다.
   * 대신 확장자 필터를 먼저 통과한 파일에 대해서만 lstat를 호출해 호출 횟수를 줄인다.
   */
  private static shouldProcessExistingFile(filePath: string, excludeExtensions: string[]): boolean {
    if (!this.shouldProcessFile(filePath, excludeExtensions)) {
      return false;
    }

    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        if (isVerboseScanDebugEnabled) {
          console.log(`  ⏭️  심볼릭 링크 스킵: ${path.basename(filePath)}`);
        }
        return false;
      }
    } catch {
      // 이벤트 직후 삭제/이동된 경로 → 다음 스캔에 맡기고 이번엔 스킵
      return false;
    }

    return true;
  }

  /**
   * 데이터베이스 워처 상태 업데이트
   */
  private static updateWatcherStatus(folderId: number, status: string, error: string | null): void {
    try {
      updateWatcherStatusInDatabase(folderId, status, error);
    } catch (err) {
      console.error(`  ❌ 워처 상태 업데이트 실패: folderId=${folderId}`, err);
    }
  }

  /**
   * 마지막 이벤트 시간 업데이트
   */
  private static updateLastEventTime(folderId: number): void {
    try {
      updateWatcherLastEventInDatabase(folderId, new Date().toISOString());
    } catch (err) {
      console.error(`  ❌ 마지막 이벤트 시간 업데이트 실패: folderId=${folderId}`, err);
    }
  }
}
