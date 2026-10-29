import { db } from '../../database/init';
import { WatchedFolderService } from '../watchedFolderService';
import { BackgroundProcessorService } from '../backgroundProcessorService';
import { resolveFolderPath } from '../../utils/pathResolver';
import { FileDiscoveryService } from './fileDiscoveryService';
import { FastRegistrationService } from './fastRegistrationService';
import { ScanResult } from './types';
import { SystemMaintenanceLockService } from '../systemMaintenanceLockService';
import { getWatcherRuntimeStatus } from '../fileWatcher/watcherRuntimeStatus';
import { maybeTruncateImagesWal } from '../../database/walMaintenance';
// 타입 전용 임포트라 런타임 의존성이 생기지 않는다(잡 핸들러 → 스캔 서비스 방향만 유지).
import type { RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner';

const isVerboseScanDebugEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';
const isVerboseAutoScanLoggingEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

// 재시작 직후에는 모든 폴더의 last_scan_date 가 한꺼번에 만료돼 첫 주기에 전체
// 폴더가 연속으로 풀스캔되고, 그동안 디스크·스레드풀이 점유돼 웹 탐색이 밀린다.
// 주기당 스캔 폴더 수를 제한해 밀린 폴더를 여러 주기(1분 간격)에 분산한다.
// getFoldersNeedingScan 이 오래된 순으로 정렬하므로 다음 주기가 이어서 처리한다.
function resolveAutoScanMaxFoldersPerTick(): number {
  const parsed = Number.parseInt(process.env.CONAI_AUTO_SCAN_MAX_FOLDERS_PER_TICK ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}
const AUTO_SCAN_MAX_FOLDERS_PER_TICK = resolveAutoScanMaxFoldersPerTick();

interface ScanFolderOptions {
  quietIfNoChanges?: boolean;
  candidateFiles?: string[];
}

interface ActiveFolderFileRow {
  id: number;
  original_file_path: string;
}

/**
 * 폴더 스캔 오케스트레이터
 * Facade 패턴으로 모든 하위 서비스를 조율
 *
 * 통합 서비스:
 * - FileDiscoveryService: 파일 발견 및 스캔
 * - FastRegistrationService: 빠른 등록
 * - ThumbnailGenerationService: 썸네일 생성 (Phase 2)
 * - ScanProgressTracker: 진행률 추적
 * - DuplicateDetectionService: 중복 감지
 */
export class FolderScanService {
  private static readonly MISSING_RECONCILE_PAGE_SIZE = 5000;
  private static readonly MISSING_RECONCILE_WRITE_BATCH_SIZE = 500;
  private static readonly folderScans = new Map<number, Promise<void>>();

  /** Capture active rows before discovery, without retaining the library in JS memory. */
  private static async captureReconcileBaseline(folderId: number): Promise<void> {
    const maxId = (db.prepare('SELECT MAX(id) AS id FROM image_files WHERE folder_id = ?')
      .get(folderId) as { id: number | null }).id ?? 0;
    const selectIds = db.prepare(`
      SELECT id FROM image_files
      WHERE folder_id = ? AND file_status = 'active' AND id > ? AND id <= ?
      ORDER BY id LIMIT ?
    `);
    const capture = db.prepare(`
      INSERT INTO temp.folder_scan_baseline
        (folder_id, id, original_file_path, last_verified_date, file_size, file_modified_date, mime_type, composite_hash)
      SELECT folder_id, id, original_file_path, last_verified_date, file_size, file_modified_date, mime_type, composite_hash
      FROM image_files
      WHERE folder_id = ? AND file_status = 'active' AND id > ? AND id <= ?
    `);
    let lastId = 0;
    for (;;) {
      const rows = selectIds.all(folderId, lastId, maxId, this.MISSING_RECONCILE_PAGE_SIZE) as Array<{ id: number }>;
      if (rows.length === 0) break;
      const endId = rows.at(-1)!.id;
      capture.run(folderId, lastId, endId);
      lastId = endId;
      if (rows.length < this.MISSING_RECONCILE_PAGE_SIZE) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private static async clearReconcileBaseline(folderId: number): Promise<void> {
    const clear = db.prepare(`
      DELETE FROM temp.folder_scan_baseline WHERE folder_id = ? AND id IN (
        SELECT id FROM temp.folder_scan_baseline WHERE folder_id = ? LIMIT ?
      )
    `);
    while (clear.run(folderId, folderId, this.MISSING_RECONCILE_PAGE_SIZE).changes > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Mark only active rows that were absent from one completely successful full scan.
   * Discovery and per-file stat/registration must finish first, otherwise a transient
   * filesystem failure could incorrectly hide a whole library.
   */
  private static async reconcileMissingFiles(
    folderId: number,
    discoveredFiles: readonly string[],
  ): Promise<number> {
    const discoveredPaths = new Set(discoveredFiles);
    const selectPage = db.prepare(`
      SELECT f.id, f.original_file_path
      FROM image_files f
      JOIN temp.folder_scan_baseline s ON s.folder_id = f.folder_id AND s.id = f.id
      WHERE f.folder_id = ?
        AND f.file_status = 'active'
        AND f.id > ?
        AND f.original_file_path IS s.original_file_path
        AND f.last_verified_date IS s.last_verified_date
        AND f.file_size IS s.file_size
        AND f.file_modified_date IS s.file_modified_date
        AND f.mime_type IS s.mime_type
        AND f.composite_hash IS s.composite_hash
      ORDER BY f.id
      LIMIT ?
    `);
    const markMissing = db.prepare(`
      UPDATE image_files
      SET file_status = 'missing'
      WHERE id = ?
        AND folder_id = ?
        AND file_status = 'active'
        AND EXISTS (
          SELECT 1 FROM temp.folder_scan_baseline s
          WHERE s.folder_id = image_files.folder_id AND s.id = image_files.id
            AND image_files.original_file_path IS s.original_file_path
            AND image_files.last_verified_date IS s.last_verified_date
            AND image_files.file_size IS s.file_size
            AND image_files.file_modified_date IS s.file_modified_date
            AND image_files.mime_type IS s.mime_type
            AND image_files.composite_hash IS s.composite_hash
        )
    `);
    const markBatch = db.transaction((ids: number[]) => {
      let changed = 0;
      for (const id of ids) {
        changed += markMissing.run(id, folderId).changes;
      }
      return changed;
    });

    let lastId = 0;
    let missingCount = 0;
    for (;;) {
      const rows = selectPage.all(
        folderId,
        lastId,
        this.MISSING_RECONCILE_PAGE_SIZE,
      ) as ActiveFolderFileRow[];
      if (rows.length === 0) {
        break;
      }

      const missingIds = rows
        .filter((row) => !discoveredPaths.has(row.original_file_path))
        .map((row) => row.id);
      for (let index = 0; index < missingIds.length; index += this.MISSING_RECONCILE_WRITE_BATCH_SIZE) {
        missingCount += markBatch(missingIds.slice(index, index + this.MISSING_RECONCILE_WRITE_BATCH_SIZE));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      lastId = rows.at(-1)!.id;
      if (rows.length < this.MISSING_RECONCILE_PAGE_SIZE) {
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return missingCount;
  }

  /**
   * 폴더 스캔 실행 (병렬 처리 최적화)
   */
  static async scanFolder(
    folderId: number,
    fullRescan: boolean = false,
    options: ScanFolderOptions = {}
  ): Promise<ScanResult> {
    const previous = this.folderScans.get(folderId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.folderScans.set(folderId, current);
    try {
      if (previous) await previous;
      return await this.scanFolderUnlocked(folderId, fullRescan, options);
    } finally {
      release();
      if (this.folderScans.get(folderId) === current) this.folderScans.delete(folderId);
    }
  }

  private static async scanFolderUnlocked(
    folderId: number,
    fullRescan: boolean,
    options: ScanFolderOptions,
  ): Promise<ScanResult> {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      throw new Error('시스템 유지보수 작업 중이라 폴더 스캔을 시작할 수 없습니다.');
    }

    const startTime = Date.now();
    const result: ScanResult = {
      folderId,
      totalScanned: 0,
      newImages: 0,
      existingImages: 0,
      updatedPaths: 0,
      missingImages: 0,
      errors: [],
      duration: 0,
      thumbnailsGenerated: 0,
      backgroundTasks: 0
    };

    let hasBaseline = false;
    try {
      // 1. 폴더 정보 조회
      const folder = await WatchedFolderService.getFolder(folderId);
      if (!folder) {
        throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
      }

      if (!folder.is_active) {
        throw new Error('비활성화된 폴더입니다');
      }

      // 2. 폴더 경로 해석 (상대 경로 → 절대 경로)
      const resolvedPath = resolveFolderPath(folder.folder_path);
      if (isVerboseScanDebugEnabled) {
        console.log(`🔍 [Scan Debug] 경로 해석: ${folder.folder_path} → ${resolvedPath}`);
      }

      // 3. 폴더 경로 유효성 확인
      const validation = await WatchedFolderService.validateFolderPath(resolvedPath);
      if (isVerboseScanDebugEnabled) {
        console.log(`🔍 [Scan Debug] 경로 유효성: exists=${validation.exists}, isDir=${validation.isDirectory}`);
      }
      if (!validation.exists || !validation.isDirectory) {
        throw new Error(validation.error || '유효하지 않은 폴더 경로');
      }

      // 4. 스캔 상태 업데이트
      await WatchedFolderService.updateScanStatus(folderId, 'in_progress');

      if (fullRescan && !options.candidateFiles) {
        db.exec(`CREATE TEMP TABLE IF NOT EXISTS folder_scan_baseline (
          folder_id INTEGER NOT NULL, id INTEGER NOT NULL, original_file_path TEXT NOT NULL,
          last_verified_date TEXT, file_size INTEGER, file_modified_date TEXT, mime_type TEXT, composite_hash TEXT,
          PRIMARY KEY (folder_id, id)
        )`);
        hasBaseline = true;
        // Rows left by a scan whose cleanup failed would collide with this capture.
        await this.clearReconcileBaseline(folderId);
        await this.captureReconcileBaseline(folderId);
      }

      // 5. 파일 목록 수집
      const files = options.candidateFiles
        ? Array.from(new Set(options.candidateFiles))
        : await FileDiscoveryService.collectFiles(resolvedPath, {
            recursive: folder.recursive === 1,
            excludeExtensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
            excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
          });

      const quietScan = options.quietIfNoChanges === true && !fullRescan;

      if (!quietScan || isVerboseScanDebugEnabled) {
        console.log(`📂 스캔 시작: ${resolvedPath} (${files.length}개 파일 발견)`);
      }
      if (files.length === 0 && isVerboseScanDebugEnabled) {
        console.log(`ℹ️ [Scan Debug] 빈 스캔 결과: recursive=${folder.recursive === 1}, exclude_extensions=${folder.exclude_extensions}`);
      }

      // 6. 배치별로 파일 처리 (Phase 1: 빠른 등록)
      await FastRegistrationService.processFastRegistration(files, folderId, result, {
        quietIfIdle: options.quietIfNoChanges === true,
        // A watcher in another process must leave a revision even when stat data
        // is unchanged, so an overlapping full scan cannot hide its file.
        verifyUnchanged: Boolean(options.candidateFiles),
      });

      // 7. 전체 재스캔의 누락 판정은 완전한 탐색과 모든 파일 stat/등록이
      // 성공한 뒤에만 실행한다. 일부 탐색 결과로 기존 행을 숨기지 않는다.
      if (fullRescan && !options.candidateFiles && result.errors.length === 0) {
        result.missingImages = await this.reconcileMissingFiles(folderId, files);
        if (!quietScan || isVerboseScanDebugEnabled || result.missingImages > 0) {
          console.log(`  🔄 전체 재스캔: ${result.missingImages}개 파일 상태 변경`);
        }
      }

      // 7.5. Phase 2 백그라운드 처리 트리거
      BackgroundProcessorService.triggerHashGeneration({
        quietIfIdle: options.quietIfNoChanges === true,
      });

      // 8. 스캔 완료 상태 업데이트
      await WatchedFolderService.updateScanStatus(
        folderId,
        result.errors.length > 0 ? 'error' : 'success',
        options.candidateFiles ? undefined : result.newImages + result.existingImages,
        result.errors.length > 0 ? `${result.errors.length}개 파일 처리 실패` : undefined
      );

      result.duration = Date.now() - startTime;

      const hasMeaningfulChanges =
        result.newImages > 0 ||
        result.updatedPaths > 0 ||
        result.missingImages > 0 ||
        result.errors.length > 0;

      // Quiet watcher/automatic scans only keep actionable history.
      if (!options.quietIfNoChanges || hasMeaningfulChanges) {
        this.saveScanLog(folderId, result);
      }

      if (!options.quietIfNoChanges || hasMeaningfulChanges || isVerboseScanDebugEnabled) {
        console.log(`✅ 스캔 완료: ${result.duration}ms`);
        console.log(`  📊 신규: ${result.newImages}, 기존 확인: ${result.existingImages}, 업데이트: ${result.updatedPaths}, 누락: ${result.missingImages}, 오류: ${result.errors.length}`);
      }

      if (!options.candidateFiles) {
        maybeTruncateImagesWal('folder-scan');
      }

      return result;
    } catch (error) {
      await WatchedFolderService.updateScanStatus(
        folderId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    } finally {
      if (hasBaseline) await this.clearReconcileBaseline(folderId);
    }
  }

  /**
   * 모든 활성 폴더 스캔
   *
   * `ctx` 가 주어지면 폴더 경계마다 진행률을 보고하고 취소 요청을 확인한다.
   * 취소 지점이 **폴더 경계뿐인 이유**: 폴더 스캔 내부는 청크 트랜잭션 구조라
   * 트랜잭션 도중 빠져나오면 부분 커밋 상태가 꼬인다.
   */
  static async scanAllFolders(ctx?: RuntimeJobContext): Promise<ScanResult[]> {
    const folders = await WatchedFolderService.listFolders({ active_only: true });
    const results: ScanResult[] = [];

    ctx?.flush({
      total: folders.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: folders[0]?.folder_name ?? null,
    });

    let succeeded = 0;
    let failed = 0;

    for (const folder of folders) {
      ctx?.throwIfCancelled();
      ctx?.report({ currentLabel: folder.folder_name });

      try {
        console.log(`\n🔍 폴더 스캔 시작: ${folder.folder_name} (${folder.folder_path})`);
        const result = await this.scanFolder(folder.id);
        results.push(result);
        succeeded++;
      } catch (error) {
        console.error(`❌ 폴더 스캔 실패: ${folder.folder_path}`, error);
        ctx?.recordError(folder.folder_path, error);
        results.push({
          folderId: folder.id,
          totalScanned: 0,
          newImages: 0,
          existingImages: 0,
          updatedPaths: 0,
          missingImages: 0,
          errors: [{
            file: folder.folder_path,
            error: error instanceof Error ? error.message : 'Unknown'
          }],
          duration: 0,
          thumbnailsGenerated: 0,
          backgroundTasks: 0
        });
        failed++;
      }

      ctx?.report({
        processed: succeeded + failed,
        succeeded,
        failed,
        currentLabel: folder.folder_name,
      });
      await ctx?.yield();
    }

    ctx?.flush({ processed: succeeded + failed, succeeded, failed, currentLabel: null });

    return results;
  }

  /**
   * 자동 스캔 실행 (스케줄러용)
   * 실시간 워처가 활성화된 폴더는 전체 스캔 건너뛰기 (백업 검증만 수행)
   */
  static async runAutoScan(): Promise<ScanResult[]> {
    const folders = await WatchedFolderService.getFoldersNeedingScan();

    if (folders.length === 0) {
      if (isVerboseAutoScanLoggingEnabled) {
        console.log('🤖 자동 스캔 건너뜀: 스캔이 필요한 폴더가 없습니다.');
      }
      return [];
    }

    const results: ScanResult[] = [];
    let didLogAutoScanStart = false;
    let scannedThisTick = 0;
    let deferredCount = 0;

    for (const folder of folders) {
      // 워처 스킵 폴더는 상한을 소모하지 않도록 실제 스캔 수만 센다.
      if (scannedThisTick >= AUTO_SCAN_MAX_FOLDERS_PER_TICK) {
        deferredCount++;
        continue;
      }

      try {
        // 워처 상태 확인
        const watcherStatus = getWatcherRuntimeStatus(folder.id);
        const isWatcherActive = watcherStatus && watcherStatus.state === 'watching';

        // 워처가 활성화되어 있고 최근 이벤트가 있으면 전체 스캔 건너뛰기
        if (isWatcherActive && watcherStatus.lastEvent) {
          const timeSinceLastEvent = Date.now() - watcherStatus.lastEvent.getTime();
          const oneHourMs = 60 * 60 * 1000;

          // 마지막 이벤트가 1시간 이내면 전체 스캔 스킵
          if (timeSinceLastEvent < oneHourMs) {
            if (isVerboseAutoScanLoggingEnabled) {
              console.log(`  ⏭️  워처 활성: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
            }
            continue;
          } else if (isVerboseAutoScanLoggingEnabled) {
            console.log(`  🔄 백업 검증 스캔: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
          }
        }

        if (isVerboseAutoScanLoggingEnabled && !didLogAutoScanStart) {
          console.log('🤖 자동 스캔 시작...');
          console.log(`  📂 스캔 대상: ${folders.length}개 폴더`);
          didLogAutoScanStart = true;
        }

        if (isVerboseAutoScanLoggingEnabled) {
          console.log(`\n🔍 자동 스캔: ${folder.folder_name}`);
        }
        // 실패한 시도도 I/O 를 소모하므로 성공 여부와 무관하게 상한을 소모한다.
        scannedThisTick++;
        const result = await this.scanFolder(folder.id, false, { quietIfNoChanges: true });
        results.push(result);
      } catch (error) {
        console.error(`❌ 자동 스캔 실패: ${folder.folder_path}`, error);
        results.push({
          folderId: folder.id,
          totalScanned: 0,
          newImages: 0,
          existingImages: 0,
          updatedPaths: 0,
          missingImages: 0,
          errors: [{
            file: folder.folder_path,
            error: error instanceof Error ? error.message : 'Unknown'
          }],
          duration: 0,
          thumbnailsGenerated: 0,
          backgroundTasks: 0
        });
      }
    }

    if (deferredCount > 0) {
      console.log(`  ⏳ 자동 스캔 분산: 이번 주기 ${scannedThisTick}개 처리, ${deferredCount}개 폴더는 다음 주기로 연기`);
    }

    if (isVerboseAutoScanLoggingEnabled && didLogAutoScanStart) {
      console.log('\n✅ 자동 스캔 완료');
    }
    return results;
  }

  /**
   * 스캔 로그 저장
   */
  /**
   * 스캔 로그 저장
   * - 최근 로그와 상태(성공여부, 스캔/신규/기존 수량)가 동일하면 시간만 업데이트
   * - 다르면 신규 기록
   * - 폴더별 최대 300개 유지
   */
  private static saveScanLog(folderId: number, result: ScanResult): void {
    try {
      const scanDate = new Date().toISOString();
      const scanStatus = result.errors.length > 0 ? 'error' : 'success';
      const errorDetails = result.errors.length > 0 ? JSON.stringify(result.errors) : null;

      // 1. 최근 로그 조회
      const lastLog = db.prepare(`
        SELECT id, scan_status, total_scanned, new_images, existing_images 
        FROM scan_logs 
        WHERE folder_id = ? 
        ORDER BY scan_date DESC 
        LIMIT 1
      `).get(folderId) as any;

      // 2. 상태 비교 (성공여부, 스캔, 신규, 기존)
      const isIdentical = lastLog &&
        lastLog.scan_status === scanStatus &&
        lastLog.total_scanned === result.totalScanned &&
        lastLog.new_images === result.newImages &&
        lastLog.existing_images === result.existingImages;

      if (isIdentical) {
        // 3a. 동일하면 업데이트 (시간, 소요시간만)
        db.prepare(`
          UPDATE scan_logs 
          SET scan_date = ?, duration_ms = ?
          WHERE id = ?
        `).run(scanDate, result.duration, lastLog.id);
        // console.log(`  📝 스캔 로그 통합: ID ${lastLog.id} (변동 없음)`);
      } else {
        // 3b. 다르면 신규 추가
        db.prepare(`
          INSERT INTO scan_logs (
            folder_id, scan_date, scan_status,
            total_scanned, new_images, existing_images, updated_paths, missing_images,
            errors_count, duration_ms, error_details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          folderId,
          scanDate,
          scanStatus,
          result.totalScanned,
          result.newImages,
          result.existingImages,
          result.updatedPaths,
          result.missingImages,
          result.errors.length,
          result.duration,
          errorDetails
        );
      }

      // 4. 로그 제한 (300개)
      // 간단한 방법: ID 역순 정렬 후 300번째 이후 삭제
      // 좀 더 안전한 방법: 서브쿼리 이용
      db.prepare(`
        DELETE FROM scan_logs 
        WHERE folder_id = ? 
        AND id NOT IN (
          SELECT id FROM scan_logs 
          WHERE folder_id = ? 
          ORDER BY scan_date DESC 
          LIMIT 300
        )
      `).run(folderId, folderId);

    } catch (error) {
      console.error('스캔 로그 저장 실패:', error);
    }
  }

  /**
   * 스캔 로그 조회
   */
  static getScanLogs(folderId: number, limit: number = 50): any[] {
    const logs = db.prepare(`
      SELECT * FROM scan_logs
      WHERE folder_id = ?
      ORDER BY scan_date DESC
      LIMIT ?
    `).all(folderId, limit) as any[];

    return logs.map(log => ({
      ...log,
      error_details: log.error_details ? JSON.parse(log.error_details) : []
    }));
  }

  /**
   * 최근 스캔 로그 조회 (모든 폴더)
   */
  static getRecentScanLogs(limit: number = 100): any[] {
    const logs = db.prepare(`
      SELECT sl.*, wf.folder_name, wf.folder_path
      FROM scan_logs sl
      JOIN watched_folders wf ON sl.folder_id = wf.id
      ORDER BY sl.scan_date DESC
      LIMIT ?
    `).all(limit) as any[];

    return logs.map(log => ({
      ...log,
      error_details: log.error_details ? JSON.parse(log.error_details) : []
    }));
  }
}

// Export all sub-services for direct access if needed
export { FileDiscoveryService } from './fileDiscoveryService';
export { FastRegistrationService } from './fastRegistrationService';
export { ThumbnailGenerationService } from './thumbnailGenerationService';
export { ScanProgressTracker } from './scanProgressTracker';
export { DuplicateDetectionService } from './duplicateDetectionService';
export type { ScanResult, ProcessedFileData } from './types';
