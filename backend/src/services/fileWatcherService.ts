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
import { db } from '../database/init';
import path from 'path';
import fs from 'fs';
import { FolderScanService } from './folderScanService';
import { WatchedFolderService } from './watchedFolderService';
import { resolveFolderPath } from '../utils/pathResolver';
import { shouldProcessFileExtension } from '../constants/supportedExtensions';

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
      // 활성화된 auto_scan 폴더 목록 가져오기
      const folders = db.prepare(`
        SELECT id, folder_path, folder_name, recursive,
               exclude_extensions, exclude_patterns, watcher_enabled
        FROM watched_folders
        WHERE is_active = 1 AND auto_scan = 1
      `).all() as any[];

      console.log(`  📁 활성 폴더 ${folders.length}개 발견`);

      let startedCount = 0;
      let errorCount = 0;

      for (const folder of folders) {
        // watcher_enabled가 명시적으로 1인 폴더만 워처 시작
        if (folder.watcher_enabled === 1) {
          try {
            await this.startWatcher(folder.id);
            startedCount++;
            console.log(`  ✅ 워처 시작: ${folder.folder_name}`);
          } catch (error) {
            errorCount++;
            console.error(`  ❌ 워처 시작 실패: ${folder.folder_name}`, error);
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
      // 개별 워처 실패는 이미 처리되었으므로, 전체 초기화는 실패로 처리하지 않음
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

    // 폴더 정보 조회
    const folder = db.prepare(`
      SELECT id, folder_path, folder_name, recursive,
             exclude_extensions, exclude_patterns
      FROM watched_folders
      WHERE id = ? AND is_active = 1
    `).get(folderId) as any;

    if (!folder) {
      throw new Error(`폴더를 찾을 수 없거나 비활성화됨: folderId=${folderId}`);
    }

    // 폴더 경로 확인
    const resolvedPath = resolveFolderPath(folder.folder_path);
    console.log(`👀 [Watcher Debug] 경로 해석: ${folder.folder_path} → ${resolvedPath}`);

    // 폴더가 존재하지 않는 경우 처리
    if (!fs.existsSync(resolvedPath)) {
      // 상대 경로인 경우 자동으로 생성 시도
      if (!path.isAbsolute(folder.folder_path)) {
        try {
          fs.mkdirSync(resolvedPath, { recursive: true });
          console.log(`  ✅ 폴더 자동 생성: ${resolvedPath}`);
        } catch (error) {
          console.warn(`  ⚠️  워처 건너뜀 (폴더 생성 실패): ${folder.folder_name}`);
          console.warn(`     경로: ${resolvedPath}`);
          return; // 에러를 던지지 않고 건너뜀
        }
      } else {
        // 절대 경로인 경우 생성하지 않고 경고만 출력
        console.warn(`  ⚠️  워처 건너뜀 (폴더 없음): ${folder.folder_name}`);
        console.warn(`     경로: ${resolvedPath}`);
        return; // 에러를 던지지 않고 건너뜀
      }
    }

    // 접근 권한 확인
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
      console.log(`👀 [Watcher Debug] 경로 접근 권한 확인 완료`);
    } catch (error) {
      console.warn(`  ⚠️  워처 건너뜀 (읽기 권한 없음): ${folder.folder_name}`);
      console.warn(`     경로: ${resolvedPath}`);
      return; // 에러를 던지지 않고 건너뜀
    }

    // 워처 옵션 구성
    const excludeExtensions = folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [];
    const excludePatterns = folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : [];

    const isNetworkDrive = this.isNetworkDrive(resolvedPath);
    if (isNetworkDrive) {
      console.warn(`  ⚠️  네트워크 드라이브 감지: ${folder.folder_name}`);
      console.warn(`     폴링 모드 활성화 (성능 저하 가능)`);
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
      usePolling: isNetworkDrive,
      interval: isNetworkDrive ? 1000 : undefined,
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
    const folderExists = db.prepare('SELECT id FROM watched_folders WHERE id = ?').get(folderId);

    if (!folderExists) {
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
      // 파일 상태를 'missing'으로 변경
      const result = db.prepare(`
        UPDATE image_files
        SET file_status = 'missing',
            last_verified_date = ?
        WHERE original_file_path = ?
      `).run(new Date().toISOString(), filePath);

      if (result.changes > 0) {
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

    entry.retryAttempts++;

    if (entry.retryAttempts >= this.MAX_RETRY_ATTEMPTS) {
      console.error(`  ❌ 최대 재시도 횟수 초과: ${entry.folderName}`);
      entry.state = 'error';
      return;
    }

    const delay = this.RETRY_DELAY_MS * entry.retryAttempts;
    console.log(`  🔄 워처 재시작 예약: ${entry.folderName} (${delay}ms 후, 시도 ${entry.retryAttempts}/${this.MAX_RETRY_ATTEMPTS})`);

    setTimeout(async () => {
      try {
        await this.restartWatcher(folderId);
        entry.retryAttempts = 0;  // 성공 시 재시도 카운터 리셋
      } catch (error) {
        console.error(`  ❌ 워처 재시작 실패: ${entry.folderName}`, error);
        await this.scheduleWatcherRestart(folderId);  // 재귀적 재시도
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
      db.prepare(`
        UPDATE watched_folders
        SET watcher_status = ?,
            watcher_error = ?
        WHERE id = ?
      `).run(status, error, folderId);
    } catch (err) {
      console.error(`  ❌ 워처 상태 업데이트 실패: folderId=${folderId}`, err);
    }
  }

  /**
   * 마지막 이벤트 시간 업데이트
   */
  private static updateLastEventTime(folderId: number): void {
    try {
      db.prepare(`
        UPDATE watched_folders
        SET watcher_last_event = ?
        WHERE id = ?
      `).run(new Date().toISOString(), folderId);
    } catch (err) {
      console.error(`  ❌ 마지막 이벤트 시간 업데이트 실패: folderId=${folderId}`, err);
    }
  }

  /**
   * 네트워크 드라이브 감지
   */
  private static isNetworkDrive(folderPath: string): boolean {
    // Windows UNC 경로
    if (folderPath.startsWith('\\\\')) return true;

    // Unix 네트워크 마운트
    if (folderPath.includes('/mnt/') || folderPath.includes('/net/')) return true;

    return false;
  }
}
