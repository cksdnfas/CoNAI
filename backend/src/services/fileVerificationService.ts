import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import type { FileType } from '../types/image';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';

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
  deleted: boolean;
}

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
  private static readonly BATCH_SIZE = 50;
  private static isRunning = false;
  private static currentProgress = {
    totalFiles: 0,
    checkedFiles: 0,
    missingFiles: 0,
    startTime: 0,
  };

  /**
   * 전체 파일 검증 실행
   */
  static async verifyAllFiles(): Promise<VerificationResult> {
    if (this.isRunning) {
      throw new Error('파일 검증이 이미 실행 중입니다');
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: Array<{ fileId: number; filePath: string; error: string }> = [];

    let totalChecked = 0;
    let missingFound = 0;
    let deletedRecords = 0;

    try {
      console.log('🔍 파일 검증 시작...');

      const allFiles = db
        .prepare(`
          SELECT
            if.id,
            if.composite_hash,
            if.original_file_path,
            if.file_type,
            if.mime_type,
            mm.thumbnail_path
          FROM image_files if
          LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
          WHERE if.file_status = 'active'
          ORDER BY if.id ASC
        `)
        .all() as ImageFileRecord[];

      console.log(`  📊 총 ${allFiles.length}개 파일 검증 예정`);

      this.currentProgress = {
        totalFiles: allFiles.length,
        checkedFiles: 0,
        missingFiles: 0,
        startTime,
      };

      for (let i = 0; i < allFiles.length; i += this.BATCH_SIZE) {
        const batch = allFiles.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((file) => this.verifyFile(file))
        );

        batchResults.forEach((result, index) => {
          const file = batch[index];
          totalChecked++;
          this.currentProgress.checkedFiles = totalChecked;

          if (result.status === 'fulfilled') {
            const { hasIssue, deleted } = result.value;
            if (hasIssue) {
              missingFound++;
              this.currentProgress.missingFiles = missingFound;
              if (deleted) {
                deletedRecords++;
              }
            }
          } else {
            errors.push({
              fileId: file.id,
              filePath: file.original_file_path,
              error: result.reason?.message || '알 수 없는 오류',
            });
            console.error(`  ❌ 파일 검증 오류: ${file.original_file_path}`, result.reason);
          }
        });

        if ((i + this.BATCH_SIZE) % 500 === 0 || i + this.BATCH_SIZE >= allFiles.length) {
          console.log(
            `  ⏳ 진행: ${totalChecked}/${allFiles.length} (이슈: ${missingFound}개)`
          );
        }

        if (i + this.BATCH_SIZE < allFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;

      console.log('✅ 파일 검증 완료');
      console.log(`  📊 총 확인: ${totalChecked}개`);
      console.log(`  ⚠️  이슈 발견: ${missingFound}개`);
      console.log(`  🗑️  삭제된 레코드: ${deletedRecords}개`);
      console.log(`  ⏱️  소요 시간: ${(duration / 1000).toFixed(2)}초`);

      const result: VerificationResult = {
        totalChecked,
        missingFound,
        deletedRecords,
        duration,
        errors,
      };

      this.saveVerificationLog(result, 'manual');
      this.cleanupOldLogs();

      return result;
    } catch (error) {
      console.error('❌ 파일 검증 중 오류 발생:', error);
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
   * 단일 파일 검증
   */
  private static async verifyFile(file: ImageFileRecord): Promise<FileVerificationOutcome> {
    try {
      const originalPath = resolveUploadsPath(file.original_file_path);
      const originalExists = fs.existsSync(originalPath);
      const thumbnailExists = this.thumbnailExists(file.thumbnail_path);

      if (this.isVideoLike(file)) {
        if (!originalExists) {
          const fileName = path.basename(file.original_file_path);
          console.log(`  ⚠️  원본 없음(video/animated), DB 삭제: ${fileName}`);
          this.deleteImageFileRecord(file.id);
          return { hasIssue: true, deleted: true };
        }

        this.markVerified(file.id);
        return { hasIssue: false, deleted: false };
      }

      if (!originalExists && !thumbnailExists) {
        const fileName = path.basename(file.original_file_path);
        console.log(`  ⚠️  원본/썸네일 모두 없음(image), DB 삭제: ${fileName}`);
        this.deleteImageFileRecord(file.id);
        return { hasIssue: true, deleted: true };
      }

      if (!originalExists && thumbnailExists) {
        console.log(`  ⚠️  원본 없음(image), 썸네일 유지로 보류: ${file.original_file_path}`);
        this.markVerified(file.id);
        return { hasIssue: true, deleted: false };
      }

      if (!thumbnailExists) {
        await this.regenerateThumbnail(file, originalPath);
        this.markVerified(file.id);
        return { hasIssue: true, deleted: false };
      }

      this.markVerified(file.id);
      return { hasIssue: false, deleted: false };
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

  private static thumbnailExists(thumbnailPath: string | null): boolean {
    if (!thumbnailPath) {
      return false;
    }

    const absoluteThumbnailPath = path.isAbsolute(thumbnailPath)
      ? thumbnailPath
      : path.join(runtimePaths.tempDir, thumbnailPath);

    return fs.existsSync(absoluteThumbnailPath);
  }

  private static async regenerateThumbnail(file: ImageFileRecord, originalPath: string): Promise<void> {
    if (!file.composite_hash) {
      throw new Error('composite_hash가 없어 썸네일을 재생성할 수 없습니다');
    }

    console.log(`  🖼️  썸네일 재생성: ${path.basename(file.original_file_path)}`);
    const thumbnailPath = await ThumbnailGenerator.generateThumbnail(originalPath, file.composite_hash);
    MediaMetadataModel.update(file.composite_hash, { thumbnail_path: thumbnailPath });
  }

  private static deleteImageFileRecord(fileId: number): void {
    db.prepare(`DELETE FROM image_files WHERE id = ?`).run(fileId);
  }

  private static markVerified(fileId: number): void {
    db.prepare(`
      UPDATE image_files
      SET last_verified_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fileId);
  }

  /**
   * 검증 로그 저장
   */
  private static saveVerificationLog(
    result: VerificationResult,
    verificationType: string
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
      result.errors.length,
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
