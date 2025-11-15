import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileVerificationService } from './fileVerificationService';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { runtimePaths } from '../config/runtimePaths';

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
 * 썸네일 재생성 진행 상황
 */
export interface ThumbnailRegenerationProgress {
  totalFiles: number;
  processedFiles: number;
  deletedThumbnails: number;
  generatedThumbnails: number;
  currentPhase: 'verification' | 'deletion' | 'generation' | 'completed' | 'idle';
  startTime: number;
}

interface ImageFileRecord {
  composite_hash: string;
  original_file_path: string;
}

interface MediaMetadataRecord {
  composite_hash: string;
  thumbnail_path: string | null;
}

/**
 * 썸네일 재생성 서비스
 * - 파일 검증 실행 → 기존 썸네일 삭제 → media_metadata에서 썸네일 항목 삭제 → 썸네일 재생성
 */
export class ThumbnailRegenerationService {
  private static readonly BATCH_SIZE = 20;
  private static isRunning = false;
  private static currentProgress: ThumbnailRegenerationProgress = {
    totalFiles: 0,
    processedFiles: 0,
    deletedThumbnails: 0,
    generatedThumbnails: 0,
    currentPhase: 'idle',
    startTime: 0,
  };

  /**
   * 썸네일 재생성 실행
   */
  static async regenerateAllThumbnails(): Promise<ThumbnailRegenerationResult> {
    if (this.isRunning) {
      throw new Error('썸네일 재생성이 이미 실행 중입니다');
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: Array<{ hash: string; error: string }> = [];

    let totalProcessed = 0;
    let thumbnailsDeleted = 0;
    let thumbnailsGenerated = 0;

    try {
      console.log('🔄 썸네일 재생성 시작...');

      // Phase 1: 파일 검증 실행
      console.log('📋 Phase 1: 파일 검증 실행...');
      this.currentProgress = {
        totalFiles: 0,
        processedFiles: 0,
        deletedThumbnails: 0,
        generatedThumbnails: 0,
        currentPhase: 'verification',
        startTime,
      };

      await FileVerificationService.verifyAllFiles();
      console.log('✅ Phase 1: 파일 검증 완료');

      // Phase 2: 기존 썸네일 삭제 및 DB 정리
      console.log('🗑️  Phase 2: 기존 썸네일 삭제 및 DB 정리...');
      this.currentProgress.currentPhase = 'deletion';

      // image_files에 있는 composite_hash 목록 조회
      const imageFileHashes = db
        .prepare(`
          SELECT DISTINCT composite_hash
          FROM image_files
          WHERE composite_hash IS NOT NULL
          AND file_status = 'active'
        `)
        .all() as { composite_hash: string }[];

      const validHashes = new Set(imageFileHashes.map(row => row.composite_hash));
      console.log(`  📊 유효한 해시: ${validHashes.size}개`);

      // media_metadata에서 썸네일이 있는 항목 조회
      const metadataWithThumbnails = db
        .prepare(`
          SELECT composite_hash, thumbnail_path
          FROM media_metadata
          WHERE thumbnail_path IS NOT NULL
        `)
        .all() as MediaMetadataRecord[];

      console.log(`  📊 썸네일이 있는 메타데이터: ${metadataWithThumbnails.length}개`);

      // 유효한 해시에 해당하는 썸네일만 삭제
      for (const metadata of metadataWithThumbnails) {
        if (validHashes.has(metadata.composite_hash) && metadata.thumbnail_path) {
          try {
            // 썸네일 파일 삭제 (temp 폴더 기준 상대 경로)
            const absolutePath = path.join(runtimePaths.tempDir, metadata.thumbnail_path);
            if (fs.existsSync(absolutePath)) {
              fs.unlinkSync(absolutePath);
              thumbnailsDeleted++;
              this.currentProgress.deletedThumbnails = thumbnailsDeleted;
            }
          } catch (error) {
            console.error(`  ⚠️  썸네일 삭제 실패: ${metadata.thumbnail_path}`, error);
            errors.push({
              hash: metadata.composite_hash,
              error: `Failed to delete thumbnail: ${(error as Error).message}`,
            });
          }
        }
      }

      // media_metadata에서 썸네일 경로 제거 (유효한 해시만)
      const deleteStmt = db.prepare(`
        UPDATE media_metadata
        SET thumbnail_path = NULL
        WHERE composite_hash = ?
      `);

      for (const hash of validHashes) {
        deleteStmt.run(hash);
      }

      console.log(`✅ Phase 2: 썸네일 삭제 및 DB 정리 완료 (삭제: ${thumbnailsDeleted}개)`);

      // Phase 3: 썸네일 재생성
      console.log('🖼️  Phase 3: 썸네일 재생성...');
      this.currentProgress.currentPhase = 'generation';

      // image_files의 원본 파일 기반으로 썸네일 재생성
      const imageFiles = db
        .prepare(`
          SELECT DISTINCT composite_hash, original_file_path
          FROM image_files
          WHERE composite_hash IS NOT NULL
          AND file_status = 'active'
          ORDER BY composite_hash ASC
        `)
        .all() as ImageFileRecord[];

      console.log(`  📊 총 ${imageFiles.length}개 파일의 썸네일 재생성 예정`);

      this.currentProgress.totalFiles = imageFiles.length;

      // 배치 단위로 처리
      for (let i = 0; i < imageFiles.length; i += this.BATCH_SIZE) {
        const batch = imageFiles.slice(i, i + this.BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((file) => this.regenerateThumbnail(file))
        );

        // 결과 집계
        batchResults.forEach((result, index) => {
          const file = batch[index];
          totalProcessed++;
          this.currentProgress.processedFiles = totalProcessed;

          if (result.status === 'fulfilled' && result.value) {
            thumbnailsGenerated++;
            this.currentProgress.generatedThumbnails = thumbnailsGenerated;
          } else if (result.status === 'rejected') {
            errors.push({
              hash: file.composite_hash,
              error: result.reason?.message || '알 수 없는 오류',
            });
            console.error(`  ❌ 썸네일 생성 오류: ${file.original_file_path}`, result.reason);
          }
        });

        // 진행 상황 로그
        if ((i + this.BATCH_SIZE) % 100 === 0 || i + this.BATCH_SIZE >= imageFiles.length) {
          console.log(
            `  ⏳ 진행: ${totalProcessed}/${imageFiles.length} (생성: ${thumbnailsGenerated}개)`
          );
        }

        // 배치 간 짧은 대기 (시스템 부하 방지)
        if (i + this.BATCH_SIZE < imageFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const duration = Date.now() - startTime;

      console.log(`✅ 썸네일 재생성 완료`);
      console.log(`  📊 총 처리: ${totalProcessed}개`);
      console.log(`  🗑️  삭제된 썸네일: ${thumbnailsDeleted}개`);
      console.log(`  🖼️  생성된 썸네일: ${thumbnailsGenerated}개`);
      console.log(`  ⚠️  오류: ${errors.length}개`);
      console.log(`  ⏱️  소요 시간: ${(duration / 1000).toFixed(2)}초`);

      this.currentProgress.currentPhase = 'completed';

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
    } finally {
      this.isRunning = false;
      // Reset progress after 5 seconds
      setTimeout(() => {
        this.currentProgress = {
          totalFiles: 0,
          processedFiles: 0,
          deletedThumbnails: 0,
          generatedThumbnails: 0,
          currentPhase: 'idle',
          startTime: 0,
        };
      }, 5000);
    }
  }

  /**
   * 단일 썸네일 재생성
   */
  private static async regenerateThumbnail(file: ImageFileRecord): Promise<boolean> {
    try {
      // 원본 파일 존재 확인
      if (!fs.existsSync(file.original_file_path)) {
        console.warn(`  ⚠️  원본 파일 없음: ${file.original_file_path}`);
        return false;
      }

      // ThumbnailGenerator를 사용하여 썸네일 생성 (temp/thumbnails/{날짜}/{해시}.webp 형식)
      const thumbnailPath = await ThumbnailGenerator.generateThumbnail(
        file.original_file_path,
        file.composite_hash
      );

      // media_metadata 업데이트 (DB 저장용 상대 경로)
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

  /**
   * 현재 진행 상황 조회
   */
  static getProgress(): ThumbnailRegenerationProgress {
    return { ...this.currentProgress };
  }

  /**
   * 실행 중 여부 확인
   */
  static isRegenerationRunning(): boolean {
    return this.isRunning;
  }
}
