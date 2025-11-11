import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
  original_file_path: string;
}

/**
 * 파일 검증 서비스
 * - 주기적으로 image_files 테이블의 모든 파일 존재 여부 확인
 * - 존재하지 않는 파일의 DB 레코드 즉시 삭제
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

      // 전체 파일 목록 조회 (file_status = 'active')
      const allFiles = db
        .prepare(`
          SELECT id, original_file_path
          FROM image_files
          WHERE file_status = 'active'
          ORDER BY id ASC
        `)
        .all() as ImageFileRecord[];

      console.log(`  📊 총 ${allFiles.length}개 파일 검증 예정`);

      this.currentProgress = {
        totalFiles: allFiles.length,
        checkedFiles: 0,
        missingFiles: 0,
        startTime,
      };

      // 배치 단위로 처리
      const concurrency = Math.max(2, os.cpus().length * 2);

      for (let i = 0; i < allFiles.length; i += this.BATCH_SIZE) {
        const batch = allFiles.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((file) => this.verifyFile(file))
        );

        // 결과 집계
        batchResults.forEach((result, index) => {
          const file = batch[index];
          totalChecked++;
          this.currentProgress.checkedFiles = totalChecked;

          if (result.status === 'fulfilled') {
            const { exists, deleted } = result.value;
            if (!exists) {
              missingFound++;
              this.currentProgress.missingFiles = missingFound;
              if (deleted) {
                deletedRecords++;
              }
            }
          } else {
            // 검증 실패 (오류)
            errors.push({
              fileId: file.id,
              filePath: file.original_file_path,
              error: result.reason?.message || '알 수 없는 오류',
            });
            console.error(`  ❌ 파일 검증 오류: ${file.original_file_path}`, result.reason);
          }
        });

        // 진행 상황 로그
        if ((i + this.BATCH_SIZE) % 500 === 0 || i + this.BATCH_SIZE >= allFiles.length) {
          console.log(
            `  ⏳ 진행: ${totalChecked}/${allFiles.length} (누락: ${missingFound}개)`
          );
        }

        // 배치 간 짧은 대기 (시스템 부하 방지)
        if (i + this.BATCH_SIZE < allFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;

      console.log(`✅ 파일 검증 완료`);
      console.log(`  📊 총 확인: ${totalChecked}개`);
      console.log(`  ⚠️  누락 발견: ${missingFound}개`);
      console.log(`  🗑️  삭제된 레코드: ${deletedRecords}개`);
      console.log(`  ⏱️  소요 시간: ${(duration / 1000).toFixed(2)}초`);

      const result: VerificationResult = {
        totalChecked,
        missingFound,
        deletedRecords,
        duration,
        errors,
      };

      // 로그 저장
      this.saveVerificationLog(result, 'manual');

      // 30일 이상 오래된 로그 삭제
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
  private static async verifyFile(
    file: ImageFileRecord
  ): Promise<{ exists: boolean; deleted: boolean }> {
    try {
      const exists = fs.existsSync(file.original_file_path);

      if (!exists) {
        // 파일이 없으면 DB에서 즉시 삭제
        const fileName = path.basename(file.original_file_path);
        console.log(`  ⚠️  파일 없음, DB 삭제: ${fileName}`);

        db.prepare(`DELETE FROM image_files WHERE id = ?`).run(file.id);

        return { exists: false, deleted: true };
      }

      return { exists: true, deleted: false };
    } catch (error) {
      // 파일 시스템 접근 오류
      throw new Error(`파일 검증 실패: ${(error as Error).message}`);
    }
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
    // 전체 파일 수 (active 상태만)
    const { total } = db
      .prepare(`
        SELECT COUNT(*) as total
        FROM image_files
        WHERE file_status = 'active'
      `)
      .get() as { total: number };

    // 누락 파일 수 (file_status = 'missing')
    const { missing } = db
      .prepare(`
        SELECT COUNT(*) as missing
        FROM image_files
        WHERE file_status = 'missing'
      `)
      .get() as { missing: number };

    // 마지막 검증 로그
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
