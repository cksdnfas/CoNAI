import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import { FileVerificationService } from './fileVerificationService';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import type { RuntimeJobContext } from './runtimeJobs/runtimeJobRunner';

/**
 * 썸네일 재생성 결과
 */
export interface ThumbnailRegenerationResult {
  totalProcessed: number;
  thumbnailsDeleted: number;
  thumbnailsGenerated: number;
  duration: number;
  errors: Array<{
    hash: string;
    error: string;
  }>;
}

/**
 * 썸네일 재생성 단계
 * 진행 상황 자체는 `runtime_jobs` 레코드가 소유한다 — 이 서비스는 static 상태를 갖지 않는다.
 */
export type ThumbnailRegenerationPhase = 'verification' | 'deletion' | 'generation' | 'completed' | 'idle';

interface ImageFileRecord {
  composite_hash: string;
  original_file_path: string;
  file_type: 'image' | 'video' | 'animated';
}

interface MediaMetadataRecord {
  composite_hash: string;
  thumbnail_path: string | null;
}

/**
 * 썸네일 재생성 서비스
 * - 파일 검증 실행
 * - 원본이 실제로 존재하는 정적 이미지의 썸네일만 삭제/재생성
 * - 원본 없는 이미지가 기존 썸네일만 유지하는 경우는 건드리지 않음
 */
export class ThumbnailRegenerationService {
  private static readonly BATCH_SIZE = 20;

  /**
   * 썸네일 재생성 실행
   *
   * 동시 실행 차단은 `runtime_jobs` 의 부분 유니크 인덱스가 담당하므로 여기에 플래그를 두지 않는다
   * (예전 static `isRunning` 체크는 라우트와의 사이에 TOCTOU 창이 있었다).
   */
  static async regenerateAllThumbnails(ctx: RuntimeJobContext): Promise<ThumbnailRegenerationResult> {
    const startTime = Date.now();
    const errors: Array<{ hash: string; error: string }> = [];

    let totalProcessed = 0;
    let thumbnailsDeleted = 0;
    let thumbnailsGenerated = 0;

    try {
      console.log('🔄 썸네일 재생성 시작...');

      console.log('📋 Phase 1: 파일 검증 실행...');
      ctx.flush({ phase: 'verification', total: 0, processed: 0, currentLabel: null });

      await FileVerificationService.verifyAllFiles();
      console.log('✅ Phase 1: 파일 검증 완료');
      ctx.throwIfCancelled();

      console.log('🗑️  Phase 2: 기존 썸네일 삭제 및 DB 정리...');
      ctx.flush({ phase: 'deletion' });

      const imageFiles = db
        .prepare(`
          SELECT DISTINCT composite_hash, original_file_path, file_type
          FROM image_files
          WHERE composite_hash IS NOT NULL
            AND file_status = 'active'
            AND file_type = 'image'
          ORDER BY composite_hash ASC
        `)
        .all() as ImageFileRecord[];

      const filesWithExistingOriginals = imageFiles.filter((file) =>
        fs.existsSync(resolveUploadsPath(file.original_file_path))
      );
      const validHashes = new Set(filesWithExistingOriginals.map((row) => row.composite_hash));
      console.log(`  📊 썸네일 재생성 대상 해시: ${validHashes.size}개`);

      const metadataWithThumbnails = db
        .prepare(`
          SELECT composite_hash, thumbnail_path
          FROM media_metadata
          WHERE thumbnail_path IS NOT NULL
        `)
        .all() as MediaMetadataRecord[];

      console.log(`  📊 썸네일이 있는 메타데이터: ${metadataWithThumbnails.length}개`);

      for (const metadata of metadataWithThumbnails) {
        if (validHashes.has(metadata.composite_hash) && metadata.thumbnail_path) {
          try {
            const absolutePath = path.isAbsolute(metadata.thumbnail_path)
              ? metadata.thumbnail_path
              : path.join(runtimePaths.tempDir, metadata.thumbnail_path);

            if (fs.existsSync(absolutePath)) {
              fs.unlinkSync(absolutePath);
              thumbnailsDeleted++;
            }
          } catch (error) {
            console.error(`  ⚠️  썸네일 삭제 실패: ${metadata.thumbnail_path}`, error);
            errors.push({
              hash: metadata.composite_hash,
              error: `Failed to delete thumbnail: ${(error as Error).message}`,
            });
            ctx.recordError(metadata.composite_hash, `Failed to delete thumbnail: ${(error as Error).message}`);
          }
        }
      }

      const deleteStmt = db.prepare(`
        UPDATE media_metadata
        SET thumbnail_path = NULL
        WHERE composite_hash = ?
      `);

      const clearThumbnailPaths = db.transaction((hashes: Iterable<string>) => {
        for (const hash of hashes) {
          deleteStmt.run(hash);
        }
      });
      clearThumbnailPaths(validHashes);

      console.log(`✅ Phase 2: 썸네일 삭제 및 DB 정리 완료 (삭제: ${thumbnailsDeleted}개)`);

      console.log('🖼️  Phase 3: 썸네일 재생성...');
      ctx.flush({
        phase: 'generation',
        total: filesWithExistingOriginals.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      });

      for (let i = 0; i < filesWithExistingOriginals.length; i += this.BATCH_SIZE) {
        // 취소 체크포인트는 배치 경계에만 둔다. 배치 내부는 Promise.allSettled 로 묶여 있어
        // 중간에 끊으면 이미 시작한 생성 작업의 결과가 집계되지 않는다.
        ctx.throwIfCancelled();

        const batch = filesWithExistingOriginals.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((file) => this.regenerateThumbnail(file))
        );

        batchResults.forEach((result, index) => {
          const file = batch[index];
          totalProcessed++;

          if (result.status === 'fulfilled' && result.value) {
            thumbnailsGenerated++;
          } else if (result.status === 'rejected') {
            errors.push({
              hash: file.composite_hash,
              error: result.reason?.message || '알 수 없는 오류',
            });
            ctx.recordError(file.composite_hash, result.reason?.message || '알 수 없는 오류');
            console.error(`  ❌ 썸네일 생성 오류: ${file.original_file_path}`, result.reason);
          }
        });

        ctx.report({
          processed: totalProcessed,
          succeeded: thumbnailsGenerated,
          failed: errors.length,
          currentLabel: batch[batch.length - 1]?.original_file_path ?? null,
        });

        if ((i + this.BATCH_SIZE) % 100 === 0 || i + this.BATCH_SIZE >= filesWithExistingOriginals.length) {
          console.log(
            `  ⏳ 진행: ${totalProcessed}/${filesWithExistingOriginals.length} (생성: ${thumbnailsGenerated}개)`
          );
        }

        if (i + this.BATCH_SIZE < filesWithExistingOriginals.length) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const duration = Date.now() - startTime;

      console.log('✅ 썸네일 재생성 완료');
      console.log(`  📊 총 처리: ${totalProcessed}개`);
      console.log(`  🗑️  삭제된 썸네일: ${thumbnailsDeleted}개`);
      console.log(`  🖼️  생성된 썸네일: ${thumbnailsGenerated}개`);
      console.log(`  ⚠️  오류: ${errors.length}개`);
      console.log(`  ⏱️  소요 시간: ${(duration / 1000).toFixed(2)}초`);

      // 종료 상태는 잡 레코드가 영구히 보관한다. 예전처럼 5초 뒤 idle 로 리셋하지 않는다
      // (리셋되면 "완료" 와 "시작 안 함" 을 구분할 수 없었다).
      ctx.flush({ phase: 'completed', currentLabel: null });

      return {
        totalProcessed,
        thumbnailsDeleted,
        thumbnailsGenerated,
        duration,
        errors,
      };
    } catch (error) {
      console.error('❌ 썸네일 재생성 중 오류 발생:', error);
      throw error;
    }
  }

  /**
   * 단일 썸네일 재생성
   */
  private static async regenerateThumbnail(file: ImageFileRecord): Promise<boolean> {
    try {
      const originalPath = resolveUploadsPath(file.original_file_path);
      if (!fs.existsSync(originalPath)) {
        console.warn(`  ⚠️  원본 파일 없음: ${file.original_file_path}`);
        return false;
      }

      const thumbnailPath = await ThumbnailGenerator.generateThumbnail(
        originalPath,
        file.composite_hash
      );

      db.prepare(`
        UPDATE media_metadata
        SET thumbnail_path = ?
        WHERE composite_hash = ?
      `).run(thumbnailPath, file.composite_hash);

      return true;
    } catch (error) {
      console.error(`  ❌ 썸네일 생성 실패: ${file.original_file_path}`, error);
      throw error;
    }
  }
}
