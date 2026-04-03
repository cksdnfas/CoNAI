import { db } from '../../database/init';
import { WatchedFolderService } from '../watchedFolderService';
import { BackgroundProcessorService } from '../backgroundProcessorService';
import { FileWatcherService } from '../fileWatcherService';
import { resolveFolderPath } from '../../utils/pathResolver';
import { FileDiscoveryService } from './fileDiscoveryService';
import { FastRegistrationService } from './fastRegistrationService';
import { ScanResult, ProcessedFileData } from './types';
import { HashGenerationService } from './hashGenerationService';
import { ThumbnailGenerationService } from './thumbnailGenerationService';
import { ScanProgressTracker } from './scanProgressTracker';
import { DuplicateDetectionService } from './duplicateDetectionService';

const isVerboseScanDebugEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

/**
 * 폴더 스캔 오케스트레이터
 * Facade 패턴으로 모든 하위 서비스를 조율
 *
 * 통합 서비스:
 * - FileDiscoveryService: 파일 발견 및 스캔
 * - FastRegistrationService: 빠른 등록
 * - HashGenerationService: 해시 생성 (Phase 2)
 * - ThumbnailGenerationService: 썸네일 생성 (Phase 2)
 * - ScanProgressTracker: 진행률 추적
 * - DuplicateDetectionService: 중복 감지
 */
export class FolderScanService {
  /**
   * 폴더 스캔 실행 (병렬 처리 최적화)
   */
  static async scanFolder(folderId: number, fullRescan: boolean = false): Promise<ScanResult> {
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

      // 5. 파일 목록 수집
      const files = await FileDiscoveryService.collectFiles(resolvedPath, {
        recursive: folder.recursive === 1,
        excludeExtensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
        excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
      });

      console.log(`📂 스캔 시작: ${resolvedPath} (${files.length}개 파일 발견)`);
      if (files.length === 0 && isVerboseScanDebugEnabled) {
        console.log(`ℹ️ [Scan Debug] 빈 스캔 결과: recursive=${folder.recursive === 1}, exclude_extensions=${folder.exclude_extensions}`);
      }

      // 6. 전체 재스캔인 경우 기존 파일들을 'missing'으로 표시
      if (fullRescan) {
        const updateInfo = db.prepare(`
          UPDATE image_files SET file_status = 'missing'
          WHERE folder_id = ? AND file_status = 'active'
        `).run(folderId);
        result.missingImages = updateInfo.changes;
        console.log(`  🔄 전체 재스캔: ${result.missingImages}개 파일 상태 변경`);
      }

      // 7. 배치별로 파일 처리 (Phase 1: 빠른 등록)
      await FastRegistrationService.processFastRegistration(files, folderId, result);

      // 7.5. Phase 2 백그라운드 처리 트리거
      BackgroundProcessorService.triggerHashGeneration();

      // 8. 스캔 완료 상태 업데이트
      await WatchedFolderService.updateScanStatus(
        folderId,
        result.errors.length > 0 ? 'error' : 'success',
        result.newImages + result.existingImages,
        result.errors.length > 0 ? `${result.errors.length}개 파일 처리 실패` : undefined
      );

      result.duration = Date.now() - startTime;

      // 9. 스캔 로그 저장
      this.saveScanLog(folderId, result);

      console.log(`✅ 스캔 완료: ${result.duration}ms`);
      console.log(`  📊 신규: ${result.newImages}, 기존: ${result.existingImages}, 업데이트: ${result.updatedPaths}, 오류: ${result.errors.length}`);

      return result;
    } catch (error) {
      await WatchedFolderService.updateScanStatus(
        folderId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * 모든 활성 폴더 스캔
   */
  static async scanAllFolders(): Promise<ScanResult[]> {
    const folders = await WatchedFolderService.listFolders({ active_only: true });
    const results: ScanResult[] = [];

    for (const folder of folders) {
      try {
        console.log(`\n🔍 폴더 스캔 시작: ${folder.folder_name} (${folder.folder_path})`);
        const result = await this.scanFolder(folder.id);
        results.push(result);
      } catch (error) {
        console.error(`❌ 폴더 스캔 실패: ${folder.folder_path}`, error);
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

    return results;
  }

  /**
   * 자동 스캔 실행 (스케줄러용)
   * 실시간 워처가 활성화된 폴더는 전체 스캔 건너뛰기 (백업 검증만 수행)
   */
  static async runAutoScan(): Promise<ScanResult[]> {
    console.log('🤖 자동 스캔 시작...');

    const folders = await WatchedFolderService.getFoldersNeedingScan();

    if (folders.length === 0) {
      console.log('  ℹ️  스캔이 필요한 폴더가 없습니다.');
      return [];
    }

    console.log(`  📂 스캔 대상: ${folders.length}개 폴더`);

    const results: ScanResult[] = [];

    for (const folder of folders) {
      try {
        // 워처 상태 확인
        const watcherStatus = FileWatcherService.getWatcherStatus(folder.id);
        const isWatcherActive = watcherStatus && watcherStatus.state === 'watching';

        // 워처가 활성화되어 있고 최근 이벤트가 있으면 전체 스캔 건너뛰기
        if (isWatcherActive && watcherStatus.lastEvent) {
          const timeSinceLastEvent = Date.now() - watcherStatus.lastEvent.getTime();
          const oneHourMs = 60 * 60 * 1000;

          // 마지막 이벤트가 1시간 이내면 전체 스캔 스킵
          if (timeSinceLastEvent < oneHourMs) {
            console.log(`  ⏭️  워처 활성: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
            continue;
          } else {
            console.log(`  🔄 백업 검증 스캔: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
          }
        }

        console.log(`\n🔍 자동 스캔: ${folder.folder_name}`);
        const result = await this.scanFolder(folder.id, false);
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

    console.log('\n✅ 자동 스캔 완료');
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
export { HashGenerationService } from './hashGenerationService';
export { ThumbnailGenerationService } from './thumbnailGenerationService';
export { ScanProgressTracker } from './scanProgressTracker';
export { DuplicateDetectionService } from './duplicateDetectionService';
export type { ScanResult, ProcessedFileData } from './types';
