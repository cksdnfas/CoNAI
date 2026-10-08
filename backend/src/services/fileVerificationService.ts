import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import type { FileType } from '../types/image';
import { checkFileAccess } from '../utils/fileAccess';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { maybeTruncateImagesWal } from '../database/walMaintenance';
import { LIBRARY_BATCH_SIZE, chunkArray, pageBoundary, type LibraryBatchHooks } from './maintenance/libraryBatch';

/**
 * 파일 검증 결과
 */
export interface VerificationResult {
  totalChecked: number;
  missingFound: number;
  deletedRecords: number;
  duration: number;
  errors: Array<{
    fileId: number;
    filePath: string;
    error: string;
  }>;
}

/**
 * 파일 검증 로그
 */
export interface VerificationLog {
  id: number;
  verification_date: string;
  total_checked: number;
  missing_found: number;
  deleted_records: number;
  duration_ms: number;
  verification_type: string;
  error_count: number;
  error_details: string | null;
}

/**
 * 파일 검증 통계
 */
export interface VerificationStats {
  totalFiles: number;
  missingFiles: number;
  lastVerificationDate: string | null;
  lastVerificationResult: VerificationLog | null;
}

interface ImageFileRecord {
  id: number;
  composite_hash: string | null;
  original_file_path: string;
  file_type: FileType;
  mime_type: string | null;
  thumbnail_path: string | null;
}

interface FileVerificationOutcome {
  hasIssue: boolean;
  /** The image_files row should go (original gone, nothing left to show). */
  deleted: boolean;
  /** The row was checked and stays; `last_verified_date` moves. False when the check was skipped. */
  verified: boolean;
}

export interface VerifyAllFilesOptions {
  hooks?: LibraryBatchHooks;
  verificationType?: string;
}

/** Files checked concurrently inside one page (filesystem calls, NAS friendly). */
const VERIFY_CONCURRENCY = 50;
/** Errors kept in the result and the log row; the count stays exact. */
const MAX_REPORTED_ERRORS = 1000;

/**
 * 파일 검증 서비스
 * - image_files 테이블의 active 파일을 순회하면서 원본/썸네일 상태를 검증
 * - video/animated: 원본이 없으면 image_files 레코드 삭제
 * - image: 원본/썸네일 둘 다 없으면 image_files 레코드 삭제
 * - image: 원본은 있고 썸네일이 없으면 썸네일 재생성
 * - image: 원본은 없지만 썸네일이 있으면 보류 (목록 유지)
 * - 검증 결과를 로그로 저장 (30일간 보관)
 */
export class FileVerificationService {
  private static isRunning = false;
  private static currentProgress = {
    totalFiles: 0,
    checkedFiles: 0,
    missingFiles: 0,
    startTime: 0,
  };

  /**
   * 전체 파일 검증 실행
   *
   * image_files 를 id 키셋으로 한 페이지(500행)씩 읽고, 페이지 안에서는 파일시스템 확인을 50개씩 병렬로 돌린 뒤
   * 그 페이지의 결과(삭제/검증 시각 갱신)를 트랜잭션 하나로 반영한다. 예전에는 전체 목록을 메모리에 올리고
   * 파일마다 autocommit UPDATE 를 했으며 50개마다 100ms 를 쉬었다.
   */
  static async verifyAllFiles(options: VerifyAllFilesOptions = {}): Promise<VerificationResult> {
    if (this.isRunning) {
      throw new Error('파일 검증이 이미 실행 중입니다');
    }

    this.isRunning = true;
    const hooks = options.hooks ?? {};
    const startTime = Date.now();
    const errors: Array<{ fileId: number; filePath: string; error: string }> = [];

    let totalChecked = 0;
    let missingFound = 0;
    let deletedRecords = 0;
    let errorCount = 0;

    try {
      console.log('🔍 파일 검증 시작...');

      const totalFiles = (db.prepare(`SELECT COUNT(*) AS total FROM image_files WHERE file_status = 'active'`).get() as { total: number }).total;
      const nextPage = db.prepare(`
        SELECT
          if.id,
          if.composite_hash,
          if.original_file_path,
          if.file_type,
          if.mime_type,
          mm.thumbnail_path
        FROM image_files if
        LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
        WHERE if.file_status = 'active' AND if.id > ?
        ORDER BY if.id ASC
        LIMIT ${LIBRARY_BATCH_SIZE}
      `);
      const deleteRecord = db.prepare(`DELETE FROM image_files WHERE id = ?`);
      const markVerified = db.prepare(`UPDATE image_files SET last_verified_date = CURRENT_TIMESTAMP WHERE id = ?`);
      const applyPage = db.transaction((deleteIds: number[], verifiedIds: number[]) => {
        for (const id of deleteIds) deleteRecord.run(id);
        for (const id of verifiedIds) markVerified.run(id);
      });

      console.log(`  📊 총 ${totalFiles}개 파일 검증 예정`);

      this.currentProgress = {
        totalFiles,
        checkedFiles: 0,
        missingFiles: 0,
        startTime,
      };
      hooks.progress?.(0, totalFiles);

      let cursor = 0;
      for (;;) {
        hooks.throwIfCancelled?.();
        const page = nextPage.all(cursor) as ImageFileRecord[];
        if (page.length === 0) {
          break;
        }
        cursor = page[page.length - 1].id;

        const deleteIds: number[] = [];
        const verifiedIds: number[] = [];
        for (const batch of chunkArray(page, VERIFY_CONCURRENCY)) {
          const batchResults = await Promise.allSettled(batch.map((file) => this.verifyFile(file)));

          batchResults.forEach((result, index) => {
            const file = batch[index];
            totalChecked++;

            if (result.status === 'fulfilled') {
              const { hasIssue, deleted, verified } = result.value;
              if (deleted) {
                deleteIds.push(file.id);
              } else if (verified) {
                verifiedIds.push(file.id);
              }
              if (hasIssue) {
                missingFound++;
                if (deleted) {
                  deletedRecords++;
                }
              }
            } else {
              errorCount++;
              if (errors.length < MAX_REPORTED_ERRORS) {
                errors.push({
                  fileId: file.id,
                  filePath: file.original_file_path,
                  error: result.reason?.message || '알 수 없는 오류',
                });
              }
              hooks.recordError?.(file.original_file_path, result.reason);
              console.error(`  ❌ 파일 검증 오류: ${file.original_file_path}`, result.reason);
            }
          });
        }

        applyPage(deleteIds, verifiedIds);
        this.currentProgress.checkedFiles = totalChecked;
        this.currentProgress.missingFiles = missingFound;
        hooks.progress?.(totalChecked, totalFiles);
        console.log(`  ⏳ 진행: ${totalChecked}/${totalFiles} (이슈: ${missingFound}개)`);
        maybeTruncateImagesWal('file-verification');
        await pageBoundary(hooks);
      }

      const duration = Date.now() - startTime;

      console.log('✅ 파일 검증 완료');
      console.log(`  📊 총 확인: ${totalChecked}개`);
      console.log(`  ⚠️  이슈 발견: ${missingFound}개`);
      console.log(`  🗑️  삭제된 레코드: ${deletedRecords}개`);
      console.log(`  ⏱️  소요 시간: ${(duration / 1000).toFixed(2)}초`);
      if (errorCount > errors.length) {
        console.warn(`  ⚠️  오류 ${errorCount}개 중 ${errors.length}개만 결과에 남김`);
      }

      const result: VerificationResult = {
        totalChecked,
        missingFound,
        deletedRecords,
        duration,
        errors,
      };

      this.saveVerificationLog(result, options.verificationType ?? 'manual', errorCount);
      this.cleanupOldLogs();

      return result;
    } catch (error) {
      if ((error as Error)?.name === 'RuntimeJobCancelledError') {
        console.log(`⏹️  파일 검증 취소됨 (${totalChecked}개 확인 후, 끝난 페이지는 반영됨)`);
      } else {
        console.error('❌ 파일 검증 중 오류 발생:', error);
      }
      throw error;
    } finally {
      this.isRunning = false;
      this.currentProgress = {
        totalFiles: 0,
        checkedFiles: 0,
        missingFiles: 0,
        startTime: 0,
      };
    }
  }

  /**
   * 단일 파일 검증. DB 는 건드리지 않고 판정만 돌려준다 — 페이지 단위로 모아 한 트랜잭션에 반영한다.
   */
  private static async verifyFile(file: ImageFileRecord): Promise<FileVerificationOutcome> {
    try {
      const originalPath = resolveUploadsPath(file.original_file_path);

      // 원본 부재 판정은 진짜 ENOENT일 때만. UNC/SMB 일시 장애(EACCES/EPERM/
      // ENETUNREACH 등)는 exists=true + readable=false로 보고되므로, 그 경우
      // DB 행을 지우지 않고 이번 스윕을 건너뛴 뒤 다음 검증에서 재시도한다.
      const originalAccess = await checkFileAccess(originalPath);
      if (originalAccess.exists && !originalAccess.readable) {
        console.warn(
          `  ⏭️  원본 접근 실패(${originalAccess.errorCode || 'unknown'}), 이번 검증 건너뜀: ${file.original_file_path}`
        );
        return { hasIssue: false, deleted: false, verified: false };
      }

      const originalExists = originalAccess.exists;

      if (this.isVideoLike(file)) {
        if (!originalExists) {
          const fileName = path.basename(file.original_file_path);
          console.log(`  ⚠️  원본 없음(video/animated), DB 삭제: ${fileName}`);
          return { hasIssue: true, deleted: true, verified: false };
        }

        return { hasIssue: false, deleted: false, verified: true };
      }

      const thumbnailExists = await this.thumbnailExists(file.thumbnail_path);

      if (!originalExists && !thumbnailExists) {
        const fileName = path.basename(file.original_file_path);
        console.log(`  ⚠️  원본/썸네일 모두 없음(image), DB 삭제: ${fileName}`);
        return { hasIssue: true, deleted: true, verified: false };
      }

      if (!originalExists && thumbnailExists) {
        console.log(`  ⚠️  원본 없음(image), 썸네일 유지로 보류: ${file.original_file_path}`);
        return { hasIssue: true, deleted: false, verified: true };
      }

      if (!thumbnailExists) {
        await this.regenerateThumbnail(file, originalPath);
        return { hasIssue: true, deleted: false, verified: true };
      }

      return { hasIssue: false, deleted: false, verified: true };
    } catch (error) {
      throw new Error(`파일 검증 실패: ${(error as Error).message}`);
    }
  }

  private static isVideoLike(file: ImageFileRecord): boolean {
    return (
      file.file_type === 'video' ||
      file.file_type === 'animated' ||
      Boolean(file.mime_type && file.mime_type.startsWith('video/'))
    );
  }

  private static async thumbnailExists(thumbnailPath: string | null): Promise<boolean> {
    if (!thumbnailPath) {
      return false;
    }

    const absoluteThumbnailPath = path.isAbsolute(thumbnailPath)
      ? thumbnailPath
      : path.join(runtimePaths.tempDir, thumbnailPath);

    try {
      await fs.promises.access(absoluteThumbnailPath);
      return true;
    } catch {
      return false;
    }
  }

  private static async regenerateThumbnail(file: ImageFileRecord, originalPath: string): Promise<void> {
    if (!file.composite_hash) {
      throw new Error('composite_hash가 없어 썸네일을 재생성할 수 없습니다');
    }

    console.log(`  🖼️  썸네일 재생성: ${path.basename(file.original_file_path)}`);
    const thumbnailPath = await ThumbnailGenerator.generateThumbnail(originalPath, file.composite_hash);
    MediaMetadataModel.update(file.composite_hash, { thumbnail_path: thumbnailPath });
  }

  /**
   * 검증 로그 저장
   */
  private static saveVerificationLog(
    result: VerificationResult,
    verificationType: string,
    errorCount: number = result.errors.length
  ): void {
    const errorDetails =
      result.errors.length > 0 ? JSON.stringify(result.errors) : null;

    db.prepare(`
      INSERT INTO file_verification_logs (
        verification_date,
        total_checked,
        missing_found,
        deleted_records,
        duration_ms,
        verification_type,
        error_count,
        error_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      result.totalChecked,
      result.missingFound,
      result.deletedRecords,
      result.duration,
      verificationType,
      errorCount,
      errorDetails
    );
  }

  /**
   * 30일 이상 오래된 로그 삭제
   */
  private static cleanupOldLogs(): void {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deleted = db
      .prepare(`
        DELETE FROM file_verification_logs
        WHERE verification_date < ?
      `)
      .run(thirtyDaysAgo.toISOString());

    if (deleted.changes > 0) {
      console.log(`  🗑️  30일 이전 로그 ${deleted.changes}개 삭제됨`);
    }
  }

  /**
   * 최근 검증 로그 조회
   */
  static getRecentLogs(limit: number = 50): VerificationLog[] {
    return db
      .prepare(`
        SELECT *
        FROM file_verification_logs
        ORDER BY verification_date DESC
        LIMIT ?
      `)
      .all(limit) as VerificationLog[];
  }

  /**
   * 검증 통계 조회
   */
  static getStats(): VerificationStats {
    const { total } = db
      .prepare(`
        SELECT COUNT(*) as total
        FROM image_files
        WHERE file_status = 'active'
      `)
      .get() as { total: number };

    const { missing } = db
      .prepare(`
        SELECT COUNT(*) as missing
        FROM image_files
        WHERE file_status = 'missing'
      `)
      .get() as { missing: number };

    const lastLog = db
      .prepare(`
        SELECT *
        FROM file_verification_logs
        ORDER BY verification_date DESC
        LIMIT 1
      `)
      .get() as VerificationLog | undefined;

    return {
      totalFiles: total,
      missingFiles: missing,
      lastVerificationDate: lastLog?.verification_date || null,
      lastVerificationResult: lastLog || null,
    };
  }

  /**
   * 현재 검증 진행 상황 조회
   */
  static getProgress() {
    return {
      isRunning: this.isRunning,
      ...this.currentProgress,
      progressPercentage:
        this.currentProgress.totalFiles > 0
          ? Math.round(
              (this.currentProgress.checkedFiles /
                this.currentProgress.totalFiles) *
                100
            )
          : 0,
    };
  }
}
