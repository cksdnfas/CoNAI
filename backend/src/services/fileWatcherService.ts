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
import { SingleFileProcessor } from './singleFileProcessor';
import { WatchedFolderService } from './watchedFolderService';
import { resolveFolderPath } from '../utils/pathResolver';

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

  // 처리 중인 파일 (중복 방지)
  private static processingFiles = new Set<string>();

  // 디바운스 타이머 (파일 경로 → 타이머)
  private static debounceTimers = new Map<string, NodeJS.Timeout>();

  // 이벤트 큐 (folderId → 파일 경로 Set)
  private static eventQueues = new Map<number, Set<string>>();

  // 설정
  private static readonly MAX_WATCHERS = parseInt(process.env.MAX_WATCHERS || '50');
  private static readonly DEBOUNCE_MS = parseInt(process.env.WATCHER_DEBOUNCE_MS || '300');
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
               file_extensions, exclude_patterns, watcher_enabled
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

      console.log(`✅ FileWatcherService 초기화 완료: ${startedCount}개 워처 시작, ${errorCount}개 오류`);

    } catch (error) {
      console.error('❌ FileWatcherService 초기화 실패:', error);
      throw error;
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
             file_extensions, exclude_patterns
      FROM watched_folders
      WHERE id = ? AND is_active = 1
    `).get(folderId) as any;

    if (!folder) {
      throw new Error(`폴더를 찾을 수 없거나 비활성화됨: folderId=${folderId}`);
    }

    // 폴더 경로 확인
    const resolvedPath = resolveFolderPath(folder.folder_path);
    console.log(`👀 [Watcher Debug] 경로 해석: ${folder.folder_path} → ${resolvedPath}`);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`폴더 경로가 존재하지 않음: ${resolvedPath}`);
    }

    // 접근 권한 확인
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
      console.log(`👀 [Watcher Debug] 경로 접근 권한 확인 완료`);
    } catch (error) {
      throw new Error(`폴더 읽기 권한 없음: ${resolvedPath}`);
    }

    // 워처 옵션 구성
    const extensions = folder.file_extensions ? JSON.parse(folder.file_extensions) : null;
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
    this.registerEventHandlers(entry, extensions);

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
  private static registerEventHandlers(entry: WatcherEntry, extensions: string[] | null): void {
    const { watcher, folderId, folderName } = entry;

    // 'add' 이벤트: 새 파일 추가
    watcher.on('add', async (filePath: string, stats?: fs.Stats) => {
      if (!this.shouldProcessFile(filePath, extensions)) return;

      entry.eventCount++;
      entry.lastEvent = new Date();
      this.updateLastEventTime(folderId);

      console.log(`👀 [워처:${folderName}] 파일 추가: ${path.basename(filePath)}`);

      this.debounceEvent(filePath, async () => {
        await this.handleAddEvent(filePath, folderId);
      });
    });

    // 'change' 이벤트: 파일 수정
    watcher.on('change', async (filePath: string, stats?: fs.Stats) => {
      if (!this.shouldProcessFile(filePath, extensions)) return;

      entry.eventCount++;
      entry.lastEvent = new Date();
      this.updateLastEventTime(folderId);

      console.log(`📝 [워처:${folderName}] 파일 변경: ${path.basename(filePath)}`);

      this.debounceEvent(filePath, async () => {
        await this.handleChangeEvent(filePath, folderId);
      });
    });

    // 'unlink' 이벤트: 파일 삭제
    watcher.on('unlink', async (filePath: string) => {
      if (!this.shouldProcessFile(filePath, extensions)) return;

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
   */
  private static async handleAddEvent(filePath: string, folderId: number): Promise<void> {
    // 중복 처리 방지
    if (this.processingFiles.has(filePath)) {
      console.log(`  ⏭️  이미 처리 중: ${path.basename(filePath)}`);
      return;
    }

    this.processingFiles.add(filePath);

    try {
      // 파일 쓰기 완료 확인
      await this.waitForFileWrite(filePath);

      // 단일 파일 처리
      const result = await SingleFileProcessor.processFile(filePath, folderId, {
        skipIfExists: false,
        updateIfModified: false,
        generateThumbnail: true
      });

      if (result.success) {
        console.log(`  ✅ 파일 처리 완료: ${path.basename(filePath)} (${result.action})`);
      } else {
        console.error(`  ❌ 파일 처리 실패: ${path.basename(filePath)} - ${result.error}`);
      }

    } catch (error) {
      console.error(`  ❌ 파일 처리 중 오류: ${path.basename(filePath)}`, error);
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  /**
   * 'change' 이벤트 처리
   */
  private static async handleChangeEvent(filePath: string, folderId: number): Promise<void> {
    if (this.processingFiles.has(filePath)) {
      console.log(`  ⏭️  이미 처리 중: ${path.basename(filePath)}`);
      return;
    }

    this.processingFiles.add(filePath);

    try {
      await this.waitForFileWrite(filePath);

      const result = await SingleFileProcessor.processFile(filePath, folderId, {
        skipIfExists: false,
        updateIfModified: true,
        generateThumbnail: true
      });

      if (result.success) {
        console.log(`  ✅ 파일 업데이트 완료: ${path.basename(filePath)} (${result.action})`);
      } else {
        console.error(`  ❌ 파일 업데이트 실패: ${path.basename(filePath)} - ${result.error}`);
      }

    } catch (error) {
      console.error(`  ❌ 파일 업데이트 중 오류: ${path.basename(filePath)}`, error);
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  /**
   * 'unlink' 이벤트 처리
   */
  private static handleUnlinkEvent(filePath: string, folderId: number): void {
    try {
      const success = SingleFileProcessor.markFileAsMissing(filePath);
      if (success) {
        console.log(`  ✅ 파일 상태 변경: ${path.basename(filePath)} → missing`);
      } else {
        console.log(`  ℹ️  파일이 데이터베이스에 없음: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(`  ❌ 파일 상태 변경 실패: ${path.basename(filePath)}`, error);
    }
  }

  /**
   * 워처 중지
   */
  static async stopWatcher(folderId: number): Promise<void> {
    const entry = this.watcherRegistry.get(folderId);
    if (!entry) {
      console.log(`  ℹ️  워처가 없음: folderId=${folderId}`);
      return;
    }

    try {
      await entry.watcher.close();
      entry.state = 'stopped';
      this.watcherRegistry.delete(folderId);
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
  private static shouldProcessFile(filePath: string, allowedExtensions: string[] | null): boolean {
    // 심볼릭 링크 스킵
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        console.log(`  ⏭️  심볼릭 링크 스킵: ${path.basename(filePath)}`);
        return false;
      }
    } catch (error) {
      return false;
    }

    // 확장자 검증
    return SingleFileProcessor.isValidImageExtension(filePath, allowedExtensions || undefined);
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
   * 디바운싱 이벤트 처리
   */
  private static debounceEvent(filePath: string, callback: () => void): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      callback();
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(filePath, timer);
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
