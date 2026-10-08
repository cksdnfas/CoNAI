import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import { FileVerificationService } from './fileVerificationService';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import type { RuntimeJobContext } from './runtimeJobs/runtimeJobRunner';
import { LIBRARY_BATCH_SIZE, placeholders } from './maintenance/libraryBatch';

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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
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

      await FileVerificationService.verifyAllFiles({
        hooks: { yield: () => ctx.yield(), throwIfCancelled: () => ctx.throwIfCancelled() },
      });
      console.log('✅ Phase 1: 파일 검증 완료');
      ctx.throwIfCancelled();

      // Phase 2 walks the active image files one composite_hash page at a time: async existence checks, async
      // unlinks, and one transaction per page to clear the stored paths. The files to regenerate are staged in a
      // connection-private temp table, so Phase 3 never holds the whole list in memory either.
      console.log('🗑️  Phase 2: 기존 썸네일 삭제 및 DB 정리...');
      ctx.flush({ phase: 'deletion' });

      db.exec(`
        CREATE TEMP TABLE IF NOT EXISTS temp_thumbnail_regeneration (
          composite_hash TEXT PRIMARY KEY,
          original_file_path TEXT NOT NULL
        ) WITHOUT ROWID
      `);
      db.prepare('DELETE FROM temp_thumbnail_regeneration').run();

      const nextHashPage = db.prepare(`
        SELECT DISTINCT composite_hash
        FROM image_files
        WHERE composite_hash IS NOT NULL
          AND file_status = 'active'
          AND file_type = 'image'
          AND composite_hash > ?
        ORDER BY composite_hash ASC
        LIMIT ${LIBRARY_BATCH_SIZE}
      `);
      const filesOfHashes = (count: number) => db.prepare(`
        SELECT f.composite_hash, f.original_file_path, f.file_type, mm.thumbnail_path
        FROM image_files f
        LEFT JOIN media_metadata mm ON mm.composite_hash = f.composite_hash
        WHERE f.composite_hash IN (${placeholders(count)})
          AND f.file_status = 'active'
          AND f.file_type = 'image'
        ORDER BY f.composite_hash, f.id
      `);
      const stageFile = db.prepare('INSERT OR IGNORE INTO temp_thumbnail_regeneration (composite_hash, original_file_path) VALUES (?, ?)');
      const clearPath = db.prepare('UPDATE media_metadata SET thumbnail_path = NULL WHERE composite_hash = ?');
      const clearPage = db.transaction((hashes: string[]) => {
        for (const hash of hashes) clearPath.run(hash);
      });

      let hashCursor = '';
      for (;;) {
        ctx.throwIfCancelled();
        const hashes = (nextHashPage.all(hashCursor) as Array<{ composite_hash: string }>).map((row) => row.composite_hash);
        if (hashes.length === 0) {
          break;
        }
        hashCursor = hashes[hashes.length - 1];

        const files = filesOfHashes(hashes.length).all(...hashes) as Array<ImageFileRecord & { thumbnail_path: string | null }>;
        const existing = await Promise.all(files.map((file) => pathExists(resolveUploadsPath(file.original_file_path))));
        const regenerate = new Map<string, ImageFileRecord & { thumbnail_path: string | null }>();
        files.forEach((file, index) => {
          if (existing[index] && !regenerate.has(file.composite_hash)) {
            regenerate.set(file.composite_hash, file);
          }
        });

        for (const file of regenerate.values()) {
          if (!file.thumbnail_path) {
            continue;
          }
          try {
            const absolutePath = path.isAbsolute(file.thumbnail_path)
              ? file.thumbnail_path
              : path.join(runtimePaths.tempDir, file.thumbnail_path);
            await fs.promises.unlink(absolutePath);
            thumbnailsDeleted++;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.error(`  ⚠️  썸네일 삭제 실패: ${file.thumbnail_path}`, error);
              errors.push({
                hash: file.composite_hash,
                error: `Failed to delete thumbnail: ${(error as Error).message}`,
              });
              ctx.recordError(file.composite_hash, `Failed to delete thumbnail: ${(error as Error).message}`);
            }
          }
        }

        const regenerateHashes = [...regenerate.keys()];
        clearPage(regenerateHashes);
        for (const file of regenerate.values()) stageFile.run(file.composite_hash, file.original_file_path);
        await ctx.yield();
      }

      const totalToRegenerate = (db.prepare('SELECT COUNT(*) AS c FROM temp_thumbnail_regeneration').get() as { c: number }).c;
      console.log(`  📊 썸네일 재생성 대상 해시: ${totalToRegenerate}개`);
      console.log(`✅ Phase 2: 썸네일 삭제 및 DB 정리 완료 (삭제: ${thumbnailsDeleted}개)`);

      console.log('🖼️  Phase 3: 썸네일 재생성...');
      ctx.flush({
        phase: 'generation',
        total: totalToRegenerate,
        processed: 0,
        succeeded: 0,
        failed: 0,
      });

      const nextStaged = db.prepare(`
        SELECT composite_hash, original_file_path, 'image' AS file_type
        FROM temp_thumbnail_regeneration
        WHERE composite_hash > ?
        ORDER BY composite_hash
        LIMIT ${this.BATCH_SIZE}
      `);
      let stagedCursor = '';
      for (;;) {
        // 취소 체크포인트는 배치 경계에만 둔다. 배치 내부는 Promise.allSettled 로 묶여 있어
        // 중간에 끊으면 이미 시작한 생성 작업의 결과가 집계되지 않는다.
        ctx.throwIfCancelled();

        const batch = nextStaged.all(stagedCursor) as ImageFileRecord[];
        if (batch.length === 0) {
          break;
        }
        stagedCursor = batch[batch.length - 1].composite_hash;

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

        if (totalProcessed % 100 === 0 || totalProcessed >= totalToRegenerate) {
          console.log(
            `  ⏳ 진행: ${totalProcessed}/${totalToRegenerate} (생성: ${thumbnailsGenerated}개)`
          );
        }

        // 생성은 sharp 스레드풀을 쓰므로 배치 사이에 숨을 돌려 다른 요청의 이미지 처리를 굶기지 않는다.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      db.prepare('DELETE FROM temp_thumbnail_regeneration').run();

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
