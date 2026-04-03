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
  extensions: string[] | null;
  excludePatterns: string[] | null;
}

/**
 * 파일 워처 서비스
 */
export class FileWatcherService {
  // 워처 레지스트리 (folderId → WatcherEntry)
  private static watcherRegistry = new Map<number, WatcherEntry>();

  // 처리 중인 폴더 (폴더 단위 락킹)
  private static processingFolders = new Set<number>();

  // 폴더별 스캔 타이머 (디바운스용)
  private static folderScanTimers = new Map<number, NodeJS.Timeout>();

  // 폴더별 대기 중인 파일 목록
  private static pendingFiles = new Map<number, Set<string>>();

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
    console.log('👀 FileWatcherService 초기화 중...');

    try {
      const folders = listAutoScanWatcherFolders();

      console.log(`  📁 활성 폴더 ${folders.length}개 발견`);

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
            console.log(`  ✅ 워처 시작: ${folder.folder_name}`);
          } catch (error) {
            errorCount++;
            console.error(`  ❌ 워처 시작 실패: ${folder.folder_name}`, error);

            try {
              const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
              disableWatcherInDatabase(folder.id, `초기화 실패: ${errorMessage}`);
            } catch (dbError) {
              console.error(`  ❌ DB 업데이트 실패:`, dbError);
            }
          }
        }
      }

      if (startedCount > 0) {
        console.log(`✅ FileWatcherService 초기화 완료: ${startedCount}개 워처 시작, ${errorCount}개 오류`);
      } else if (errorCount > 0) {
        console.warn(`⚠️  FileWatcherService 초기화: 모든 워처 시작 실패 (${errorCount}개 오류)`);
      } else {
        console.log(`ℹ️  FileWatcherService 초기화: 활성화된 워처 없음`);
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
    // 최대 워처 수 확인
    if (this.watcherRegistry.size >= this.MAX_WATCHERS) {
      throw new Error(`최대 워처 수 초과 (${this.MAX_WATCHERS})`);
    }

    // 이미 실행 중인 워처 확인
    const existing = this.watcherRegistry.get(folderId);
    if (existing && existing.state === 'watching') {
      console.log(`  ℹ️  이미 실행 중인 워처: folderId=${folderId}`);
      return;
    }

    // 기존 워처가 있으면 먼저 중지
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
      console.log(`  ✅ 폴더 자동 생성: ${resolvedPath}`);
    }

    if (isVerboseScanDebugEnabled) {
      console.log(`👀 [Watcher Debug] 경로 접근 권한 확인 완료`);
    }

    const excludeExtensions = parseWatcherJsonArray(folder.exclude_extensions);
    const excludePatterns = parseWatcherJsonArray(folder.exclude_patterns);
    const pollingOptions = resolveWatcherPollingOptions(folder, resolvedPath);

    if (pollingOptions.pollingReason === 'user-configured') {
      console.log(`  ⚙️  사용자 설정 폴링 간격: ${pollingOptions.pollingInterval}ms`);
    } else if (pollingOptions.pollingReason === 'network-drive') {
      console.warn(`  ⚠️  네트워크 드라이브 감지: ${folder.folder_name}`);
      console.warn(`     폴링 모드 활성화 (간격: ${pollingOptions.pollingInterval}ms)`);
    }

    const chokidarOptions = {
      ignored: excludePatterns,
      persistent: true,
      ignoreInitial: true,  // 기존 파일 이벤트 무시
      awaitWriteFinish: {
        stabilityThreshold: this.STABILITY_THRESHOLD,
        pollInterval: 100
      },
      depth: folder.recursive === 1 ? undefined : 0,
      usePolling: pollingOptions.usePolling,
      interval: pollingOptions.pollingInterval,
      alwaysStat: true
    };

    // Chokidar 워처 생성
    const watcher = chokidar.watch(resolvedPath, chokidarOptions);

    // 워처 엔트리 생성
    const entry: WatcherEntry = {
      folderId,
      folderPath: resolvedPath,
      folderName: folder.folder_name,
      watcher,
      state: 'initializing',
      eventCount: 0,
      retryAttempts: 0
    };

    this.watcherRegistry.set(folderId, entry);

    // 이벤트 핸들러 등록
    this.registerEventHandlers(entry, excludeExtensions);

    // 초기화 완료 대기
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('워처 초기화 타임아웃'));
      }, 10000);

      watcher.on('ready', () => {
        clearTimeout(timeout);
        entry.state = 'watching';
        this.updateWatcherStatus(folderId, 'watching', null);
        console.log(`  ✅ 워처 준비 완료: ${folder.folder_name}`);
        resolve();
      });

      watcher.on('error', (error: unknown) => {
        clearTimeout(timeout);
        entry.state = 'error';
        entry.error = error instanceof Error ? error.message : 'Unknown error';
        this.updateWatcherStatus(folderId, 'error', entry.error);
        reject(error);
      });
    });
  }

  /**
   * 이벤트 핸들러 등록
   */
  private static registerEventHandlers(entry: WatcherEntry, excludeExtensions: string[]): void {
    const { watcher, folderId, folderName } = entry;

    // 'add' 이벤트: 새 파일 추가
    watcher.on('add', async (filePath: string, stats?: fs.Stats) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      entry.eventCount++;
      entry.lastEvent = new Date();
      this.updateLastEventTime(folderId);

      console.log(`👀 [워처:${folderName}] 파일 추가: ${path.basename(filePath)}`);

      // handleAddEvent에 디바운스 로직 내장됨
      await this.handleAddEvent(filePath, folderId);
    });

    // 'change' 이벤트: 파일 수정
    watcher.on('change', async (filePath: string, stats?: fs.Stats) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      entry.eventCount++;
      entry.lastEvent = new Date();
      this.updateLastEventTime(folderId);

      console.log(`📝 [워처:${folderName}] 파일 변경: ${path.basename(filePath)}`);

      await this.handleChangeEvent(filePath, folderId);
    });

    // 'unlink' 이벤트: 파일 삭제
    watcher.on('unlink', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, excludeExtensions)) return;

      entry.eventCount++;
      entry.lastEvent = new Date();
      this.updateLastEventTime(folderId);

      console.log(`🗑️  [워처:${folderName}] 파일 삭제: ${path.basename(filePath)}`);

      this.handleUnlinkEvent(filePath, folderId);
    });

    // 'error' 이벤트: 워처 오류
    watcher.on('error', async (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [워처:${folderName}] 오류:`, error);
      entry.state = 'error';
      entry.error = errorMessage;
      this.updateWatcherStatus(folderId, 'error', errorMessage);

      // 재시도 로직
      await this.scheduleWatcherRestart(folderId);
    });
  }

  /**
   * 'add' 이벤트 처리
   * 이벤트 큐잉 + 디바운스로 배치 처리 (연속 생성 최적화)
   */
  private static async handleAddEvent(filePath: string, folderId: number): Promise<void> {
    try {
      // 파일 쓰기 완료 확인
      await this.waitForFileWrite(filePath);

      // 대기 큐에 파일 추가
      if (!this.pendingFiles.has(folderId)) {
        this.pendingFiles.set(folderId, new Set());
      }
      this.pendingFiles.get(folderId)!.add(filePath);

      console.log(`  📝 파일 큐에 추가: ${path.basename(filePath)} (대기 중: ${this.pendingFiles.get(folderId)!.size}개)`);

      // 기존 타이머 취소 (디바운스)
      const existingTimer = this.folderScanTimers.get(folderId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // 새 타이머 설정 (SCAN_DEBOUNCE_MS 후 스캔 실행)
      const timer = setTimeout(() => {
        this.executeBatchScan(folderId);
      }, this.SCAN_DEBOUNCE_MS);

      this.folderScanTimers.set(folderId, timer);

    } catch (error) {
      console.error(`  ❌ 파일 이벤트 처리 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * 배치 스캔 실행 (디바운스 타이머 완료 후)
   */
  private static async executeBatchScan(folderId: number): Promise<void> {
    // Safety check: verify folder still exists in database
    if (!watchedFolderExists(folderId)) {
      console.warn(`  ⚠️  배치 스캔 취소: 폴더 삭제됨 folderId=${folderId}`);
      this.cleanupFolderState(folderId);
      return;
    }

    // 이미 스캔 중이면 스킵 (폴더 단위 락킹)
    if (this.processingFolders.has(folderId)) {
      console.log(`  ⏭️  폴더 스캔 이미 진행 중: folderId=${folderId}`);
      return;
    }

    const pendingFileSet = this.pendingFiles.get(folderId);
    if (!pendingFileSet || pendingFileSet.size === 0) {
      return;
    }

    const fileCount = pendingFileSet.size;
    console.log(`  🚀 배치 스캔 시작: folderId=${folderId}, 대기 파일 ${fileCount}개`);

    this.processingFolders.add(folderId);

    try {
      const result = await FolderScanService.scanFolder(folderId, false);

      console.log(`  ✅ 배치 스캔 완료: 신규 ${result.newImages}개, 기존 ${result.existingImages}개`);

      // 성공적으로 처리된 파일들 큐에서 제거
      this.pendingFiles.delete(folderId);
      this.folderScanTimers.delete(folderId);

    } catch (error) {
      console.error(`  ❌ 배치 스캔 실패: folderId=${folderId}`, error);

      // 실패 시 재시도를 위해 큐 유지 (다음 이벤트에서 재시도)
    } finally {
      this.processingFolders.delete(folderId);
    }
  }

  /**
   * 'change' 이벤트 처리
   * 파일 변경 시 강제 재스캔 (폴더 단위 락킹)
   */
  private static async handleChangeEvent(filePath: string, folderId: number): Promise<void> {
    // 폴더가 이미 스캔 중이면 대기
    if (this.processingFolders.has(folderId)) {
      console.log(`  ⏭️  폴더 스캔 진행 중, 변경 이벤트 대기: ${path.basename(filePath)}`);
      return;
    }

    this.processingFolders.add(folderId);

    try {
      await this.waitForFileWrite(filePath);

      console.log(`  🔄 파일 변경 감지, 강제 재스캔: ${path.basename(filePath)}`);

      // 강제 재스캔으로 수정된 파일 재처리
      const result = await FolderScanService.scanFolder(folderId, true);

      console.log(`  ✅ 파일 업데이트 완료: 신규 ${result.newImages}개, 업데이트 ${result.existingImages}개`);

    } catch (error) {
      console.error(`  ❌ 파일 업데이트 중 오류: ${path.basename(filePath)}`, error);
    } finally {
      this.processingFolders.delete(folderId);
    }
  }

  /**
   * 'unlink' 이벤트 처리
   */
  private static handleUnlinkEvent(filePath: string, folderId: number): void {
    try {
      const changes = markWatchedFileMissing(filePath, new Date().toISOString());

      if (changes > 0) {
        console.log(`  ✅ 파일 상태 변경: ${path.basename(filePath)} → missing`);
      } else {
        console.log(`  ℹ️  파일이 데이터베이스에 없음: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(`  ❌ 파일 상태 변경 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * Clean up all in-memory state for a folder
   */
  private static cleanupFolderState(folderId: number): void {
    // Clear pending files
    this.pendingFiles.delete(folderId);

    // Cancel and clear scan timer
    const timer = this.folderScanTimers.get(folderId);
    if (timer) {
      clearTimeout(timer);
      this.folderScanTimers.delete(folderId);
    }

    // Remove from processing set
    this.processingFolders.delete(folderId);

    console.log(`  🧹 상태 정리 완료: folderId=${folderId}`);
  }

  /**
   * 워처 중지
   */
  static async stopWatcher(folderId: number): Promise<void> {
    const entry = this.watcherRegistry.get(folderId);
    if (!entry) {
      console.log(`  ℹ️  워처가 없음: folderId=${folderId}`);
      // Clean up state even if no watcher entry
      this.cleanupFolderState(folderId);
      return;
    }

    try {
      await entry.watcher.close();
      entry.state = 'stopped';
      this.watcherRegistry.delete(folderId);

      // Clean up all related state
      this.cleanupFolderState(folderId);

      this.updateWatcherStatus(folderId, 'stopped', null);
      console.log(`  ✅ 워처 중지: ${entry.folderName}`);
    } catch (error) {
      console.error(`  ❌ 워처 중지 실패: ${entry.folderName}`, error);
      throw error;
    }
  }

  /**
   * 워처 재시작
   */
  static async restartWatcher(folderId: number): Promise<void> {
    console.log(`  🔄 워처 재시작: folderId=${folderId}`);
    await this.stopWatcher(folderId);
    await new Promise(resolve => setTimeout(resolve, 1000));  // 1초 대기
    await this.startWatcher(folderId);
  }

  /**
   * 워처 재시작 예약 (오류 복구)
   */
  private static async scheduleWatcherRestart(folderId: number): Promise<void> {
    const entry = this.watcherRegistry.get(folderId);
    if (!entry) return;

    // 이미 재시도 진행 중이면 스킵 (중복 재시도 방지)
    if (entry.isRetrying) {
      console.log(`  ⏭️  재시도 이미 진행 중: ${entry.folderName}`);
      return;
    }

    entry.retryAttempts++;

    if (entry.retryAttempts >= this.MAX_RETRY_ATTEMPTS) {
      console.error(`  ❌ 최대 재시도 횟수 초과: ${entry.folderName}`);
      entry.state = 'error';

      // DB에서 워처 비활성화 및 에러 상태 저장
      try {
        disableWatcherInDatabase(folderId, '최대 재시도 횟수 초과 - 자동 비활성화됨');
        console.error(`  🔒 워처 자동 비활성화됨: ${entry.folderName} (DB 업데이트 완료)`);
      } catch (dbError) {
        console.error(`  ❌ DB 업데이트 실패:`, dbError);
      }

      return;
    }

    // 지수 백오프 적용 (선형 → 지수)
    const delay = this.RETRY_DELAY_MS * Math.pow(2, entry.retryAttempts - 1);
    console.log(`  🔄 워처 재시작 예약: ${entry.folderName} (${delay}ms 후, 시도 ${entry.retryAttempts}/${this.MAX_RETRY_ATTEMPTS})`);

    entry.isRetrying = true;  // 재시도 플래그 설정

    setTimeout(async () => {
      try {
        await this.restartWatcher(folderId);
        entry.retryAttempts = 0;  // 성공 시 재시도 카운터 리셋
        entry.isRetrying = false;  // 재시도 플래그 해제
        console.log(`  ✅ 워처 재시작 성공: ${entry.folderName}`);
      } catch (error) {
        console.error(`  ❌ 워처 재시작 실패: ${entry.folderName}`, error);
        entry.isRetrying = false;  // 재시도 플래그 해제

        // 재귀 호출 전에 재시도 가능 여부 확인 (무한 루프 방지)
        if (entry.retryAttempts < this.MAX_RETRY_ATTEMPTS) {
          await this.scheduleWatcherRestart(folderId);
        } else {
          console.error(`  ❌ 최대 재시도 횟수 도달, 워처 비활성화`);
          entry.state = 'error';

          // DB에서 워처 비활성화
          try {
            disableWatcherInDatabase(folderId, '재시작 실패 - 자동 비활성화됨');
            console.error(`  🔒 워처 자동 비활성화됨: ${entry.folderName}`);
          } catch (dbError) {
            console.error(`  ❌ DB 업데이트 실패:`, dbError);
          }
        }
      }
    }, delay);
  }

  /**
   * 모든 워처 중지
   */
  static async stopAll(): Promise<void> {
    console.log('🛑 모든 워처 중지 중...');
    const folderIds = Array.from(this.watcherRegistry.keys());
    for (const folderId of folderIds) {
      await this.stopWatcher(folderId);
    }
    console.log('✅ 모든 워처 중지 완료');
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
    // 심볼릭 링크 스킵
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        console.log(`  ⏭️  심볼릭 링크 스킵: ${path.basename(filePath)}`);
        return false;
      }
    } catch (error) {
      return false;
    }

    // 확장자 검증: 지원 확장자인지 + 제외 목록에 없는지
    const ext = path.extname(filePath).toLowerCase();
    return shouldProcessFileExtension(ext, excludeExtensions);
  }

  /**
   * 파일 쓰기 완료 대기
   */
  private static async waitForFileWrite(filePath: string): Promise<void> {
    let previousSize = -1;
    let stableCount = 0;

    // 최대 10초 대기
    for (let i = 0; i < 20; i++) {
      try {
        const currentSize = fs.statSync(filePath).size;
        if (currentSize === previousSize) {
          stableCount++;
          if (stableCount >= 3) {
            // 3번 연속 같은 크기 → 쓰기 완료
            return;
          }
        } else {
          stableCount = 0;
        }
        previousSize = currentSize;
      } catch (error) {
        // 파일 접근 오류 → 대기
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
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
