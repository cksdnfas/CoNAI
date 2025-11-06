import { db } from '../../database/init';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { FileType } from '../../types/image';
import { FileDiscoveryService } from './fileDiscoveryService';
import { ScanProgressTracker } from './scanProgressTracker';
import { ScanResult } from './types';

// 타입 재내보내기
export type { ScanResult };

/**
 * Phase 1: 빠른 등록 서비스
 */
export class FastRegistrationService {
  private static readonly PROGRESS_LOG_INTERVAL = 50;

  /**
   * 파일 타입 결정
   */
  static determineFileType(mimeType: string, filePath: string): FileType {
    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gif' || ext === '.apng') {
      return 'animated';
    }

    return 'image';
  }

  /**
   * Phase 1: 빠른 등록 처리
   */
  static async processFastRegistration(
    files: string[],
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    const batchStartTime = Date.now();
    const concurrency = Math.min(os.cpus().length * 4, 20);
    const limit = pLimit(concurrency);
    console.log(`  Phase 1: 빠른 등록 모드 (동시성: ${concurrency})`);

    const tasks = files.map((filePath) =>
      limit(async () => {
        try {
          const stats = fs.statSync(filePath);
          const mimeType = FileDiscoveryService.getMimeType(filePath);

          // 1. 기존 파일 확인
          const existingFile = db.prepare(
            'SELECT id, composite_hash FROM image_files WHERE original_file_path = ?'
          ).get(filePath) as { id: number; composite_hash: string | null } | undefined;

          if (existingFile) {
            db.prepare(`
              UPDATE image_files
              SET file_status = 'active',
                  last_verified_date = ?,
                  file_modified_date = ?,
                  file_size = ?
              WHERE id = ?
            `).run(
              new Date().toISOString(),
              stats.mtime.toISOString(),
              stats.size,
              existingFile.id
            );

            result.existingImages++;
            result.totalScanned++;
            return;
          }

          // 2. 신규 파일 -> 기본 정보만 수집
          let width: number | null = null;
          let height: number | null = null;

          try {
            const metadata = await sharp(filePath).metadata();
            width = metadata.width || null;
            height = metadata.height || null;
          } catch (error) {
            console.warn(`  경고: 메타데이터 추출 실패: ${path.basename(filePath)}`);
          }

          // 3. composite_hash 없이 image_files에 등록
          const fileType = this.determineFileType(mimeType, filePath);
          db.prepare(`
            INSERT INTO image_files (
              composite_hash, file_type, original_file_path, folder_id,
              file_status, file_size, mime_type, file_modified_date
            ) VALUES (NULL, ?, ?, ?, 'active', ?, ?, ?)
          `).run(
            fileType,
            filePath,
            folderId,
            stats.size,
            mimeType,
            stats.mtime.toISOString()
          );

          result.newImages++;
          result.totalScanned++;

          // 진행 상황 로그
          if (result.totalScanned % this.PROGRESS_LOG_INTERVAL === 0 || result.totalScanned === files.length) {
            const progress = ScanProgressTracker.calculateProgress(result.totalScanned, files.length, batchStartTime);
            console.log(
              `  Phase 1 진행: ${result.totalScanned}/${files.length} ` +
              `(${progress.speed.toFixed(1)} 이미지/초, 예상 완료: ${progress.etaFormatted})`
            );
          }
        } catch (error) {
          result.totalScanned++;
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.error(`  등록 실패: ${path.basename(filePath)}`, error);
        }
      })
    );

    await Promise.all(tasks);

    const duration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    console.log(`  Phase 1 완료: ${result.newImages}개 신규, ${result.existingImages}개 기존 (${duration}초)`);
  }
}