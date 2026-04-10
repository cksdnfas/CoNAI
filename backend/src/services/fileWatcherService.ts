/**
 * FileWatcherService - 실시간 파일 모니터링 서비스
 *
 * Chokidar를 사용한 폴더별 파일 시스템 이벤트 감지
 * - 새 파일 추가 감지 및 자동 처리
 * - 파일 수정 감지 및 메타데이터 업데이트
 * - 파일 삭제 감지 및 상태 변경
 * - 오류 복구 및 재시도 메커니즘
 */

import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
import { FolderScanService } from './folderScanService';
import { shouldProcessFileExtension } from '../constants/supportedExtensions';
import {
  disableWatcherInDatabase,
  findWatchedFolderForWatcher,
  listAutoScanWatcherFolders,
  markWatchedFileMissing,
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

const isVerboseScanDebugEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

/**
 * 워처 상태
 */
type WatcherState = 'initializing' | 'watching' | 'error' | 'stopped';

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
    ignored: watcherOptions.excludePatterns,
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

/** Wait for a new or changed file to stop changing size before scanning it. */
async function waitForWatcherFileWrite(filePath: string): Promise<void> {
  let previousSize = -1;
  let stableCount = 0;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const currentSize = fs.statSync(filePath).size;
      if (currentSize === previousSize) {
        stableCount += 1;
        if (stableCount >= 3) {
          return;
        }
      } else {
        stableCount = 0;
      }
      previousSize = currentSize;
    } catch {
      // 파일 접근 오류 → 대기
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
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

  const existingTimer = scanState.folderScanTimers.get(folderId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    runBatchScan(folderId);
  }, scanDebounceMs);

  scanState.folderScanTimers.set(folderId, timer);
}

/** Run one deferred folder scan while keeping folder-level scan locking consistent. */
async function runQueuedFolderScan(scanState: FileWatcherScanState, folderId: number): Promise<void> {
  if (!watchedFolderExists(folderId)) {
    console.warn(`  ⚠️  배치 스캔 취소: 폴더 삭제됨 folderId=${folderId}`);
    cleanupFolderScanState(scanState, folderId);
    return;
  }

  if (scanState.processingFolders.has(folderId)) {
    if (isVerboseScanDebugEnabled) {
      console.log(`  ⏭️  폴더 스캔 이미 진행 중: folderId=${folderId}`);
    }
    return;
  }

  const pendingFileSet = scanState.pendingFiles.get(folderId);
  if (!pendingFileSet || pendingFileSet.size === 0) {
    return;
  }

  const fileCount = pendingFileSet.size;
  if (isVerboseScanDebugEnabled) {
    console.log(`  🚀 배치 스캔 시작: folderId=${folderId}, 대기 파일 ${fileCount}개`);
  }

  scanState.processingFolders.add(folderId);

  try {
    const result = await FolderScanService.scanFolder(folderId, false, { quietIfNoChanges: true });

    if (isVerboseScanDebugEnabled || result.newImages > 0 || result.updatedPaths > 0 || result.missingImages > 0 || result.errors.length > 0) {
      console.log(`  ✅ 배치 스캔 완료: 신규 ${result.newImages}개, 기존 ${result.existingImages}개, 업데이트 ${result.updatedPaths}개, 오류 ${result.errors.length}개`);
    }

    scanState.pendingFiles.delete(folderId);
    scanState.folderScanTimers.delete(folderId);
  } catch (error) {
    console.error(`  ❌ 배치 스캔 실패: folderId=${folderId}`, error);
  } finally {
    scanState.processingFolders.delete(folderId);
  }
}

/** Run one force-rescan for a changed file when the folder is idle. */
async function runChangeFolderScan(scanState: FileWatcherScanState, folderId: number, filePath: string): Promise<void> {
  if (scanState.processingFolders.has(folderId)) {
    if (isVerboseScanDebugEnabled) {
      console.log(`  ⏭️  폴더 스캔 진행 중, 변경 이벤트 대기: ${path.basename(filePath)}`);
    }
    return;
  }

  scanState.processingFolders.add(folderId);

  try {
    await waitForWatcherFileWrite(filePath);

    if (isVerboseScanDebugEnabled) {
      console.log(`  🔄 파일 변경 감지, 강제 재스캔: ${path.basename(filePath)}`);
    }

    const result = await FolderScanService.scanFolder(folderId, true);

    if (isVerboseScanDebugEnabled || result.newImages > 0 || result.updatedPaths > 0 || result.missingImages > 0 || result.errors.length > 0) {
      console.log(`  ✅ 파일 업데이트 완료: 신규 ${result.newImages}개, 기존 ${result.existingImages}개, 업데이트 ${result.updatedPaths}개, 오류 ${result.errors.length}개`);
    }
  } catch (error) {
    console.error(`  ❌ 파일 업데이트 중 오류: ${path.basename(filePath)}`, error);
  } finally {
    scanState.processingFolders.delete(folderId);
  }
}

/** Persist a missing-file state update for one unlink event. */
function markWatcherFileMissing(filePath: string): void {
  const changes = markWatchedFileMissing(filePath, new Date().toISOString());

  if (changes > 0) {
    console.warn(`⚠️  Watched file missing: ${path.basename(filePath)}`);
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
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const { watcher, folderId } = entry;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('워처 초기화 타임아웃'));
    }, 10000);

    const handleReady = () => {
      cleanup();
      entry.state = 'watching';
      updateWatcherStatus(folderId, 'watching', null);
      resolve();
    };

    const handleError = (error: unknown) => {
      cleanup();
      entry.state = 'error';
      entry.error = error instanceof Error ? error.message : 'Unknown error';
      updateWatcherStatus(folderId, 'error', entry.error);
      reject(error instanceof Error ? error : new Error(entry.error));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      watcher.off('ready', handleReady);
      watcher.off('error', handleError);
    };

    watcher.on('ready', handleReady);
    watcher.on('error', handleError);
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
  static async startWatcher(folderId: number): Promise<void> {
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
      retryAttempts: 0,
    };

    this.watcherRegistry.set(folderId, entry);
    this.registerEventHandlers(entry, watcherOptions.excludeExtensions);
    await waitForWatcherReady(entry, this.updateWatcherStatus.bind(this));
  }

  /**
   * 이벤트 핸들러 등록
   */
  private static registerEventHandlers(entry: WatcherEntry, excludeExtensions: string[]): void {
    const { watcher, folderName } = entry;

    watcher.on('add', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));

      if (isVerboseScanDebugEnabled) {
        console.log(`👀 [워처:${folderName}] 파일 추가: ${path.basename(filePath)}`);
      }

      await this.handleAddEvent(filePath, entry.folderId);
    });

    watcher.on('change', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));

      if (isVerboseScanDebugEnabled) {
        console.log(`📝 [워처:${folderName}] 파일 변경: ${path.basename(filePath)}`);
      }

      await this.handleChangeEvent(filePath, entry.folderId);
    });

    watcher.on('unlink', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      recordWatcherEvent(entry, this.updateLastEventTime.bind(this));

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
      await waitForWatcherFileWrite(filePath);
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
    await runQueuedFolderScan(this.scanState, folderId);
  }

  /**
   * 'change' 이벤트 처리
   * 파일 변경 시 강제 재스캔 (폴더 단위 락킹)
   */
  private static async handleChangeEvent(filePath: string, folderId: number): Promise<void> {
    await runChangeFolderScan(this.scanState, folderId, filePath);
  }

  /**
   * 'unlink' 이벤트 처리
   */
  private static handleUnlinkEvent(filePath: string): void {
    try {
      markWatcherFileMissing(filePath);
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
      this.cleanupFolderState(folderId);
      return;
    }

    try {
      await entry.watcher.close();
      entry.state = 'stopped';
      this.watcherRegistry.delete(folderId);
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
  static async restartWatcher(folderId: number): Promise<void> {
    console.warn(`⚠️  Restarting watcher: folderId=${folderId}`);
    await this.stopWatcher(folderId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startWatcher(folderId);
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

    entry.retryAttempts += 1;

    if (entry.retryAttempts >= this.MAX_RETRY_ATTEMPTS) {
      console.error(`  ❌ 최대 재시도 횟수 초과: ${entry.folderName}`);
      entry.state = 'error';
      disableWatcherAfterRetryFailure(folderId, entry.folderName, '최대 재시도 횟수 초과 - 자동 비활성화됨');
      return;
    }

    const delay = getWatcherRetryDelay(this.RETRY_DELAY_MS, entry.retryAttempts);
    console.warn(`⚠️  Watcher restart scheduled: ${entry.folderName} (${delay}ms, attempt ${entry.retryAttempts}/${this.MAX_RETRY_ATTEMPTS})`);

    entry.isRetrying = true;

    setTimeout(async () => {
      try {
        await this.restartWatcher(folderId);
        entry.retryAttempts = 0;
        entry.isRetrying = false;
        console.warn(`✅ Watcher recovered: ${entry.folderName}`);
      } catch (error) {
        console.error(`  ❌ 워처 재시작 실패: ${entry.folderName}`, error);
        entry.isRetrying = false;

        if (entry.retryAttempts < this.MAX_RETRY_ATTEMPTS) {
          await this.scheduleWatcherRestart(folderId);
        } else {
          console.error('  ❌ 최대 재시도 횟수 도달, 워처 비활성화');
          entry.state = 'error';
          disableWatcherAfterRetryFailure(folderId, entry.folderName, '재시작 실패 - 자동 비활성화됨');
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
   * 파일 처리 여부 확인
   */
  private static shouldProcessFile(filePath: string, excludeExtensions: string[]): boolean {
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        if (isVerboseScanDebugEnabled) {
          console.log(`  ⏭️  심볼릭 링크 스킵: ${path.basename(filePath)}`);
        }
        return false;
      }
    } catch {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    return shouldProcessFileExtension(ext, excludeExtensions);
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
