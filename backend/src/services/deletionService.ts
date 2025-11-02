import fs from 'fs';
import path from 'path';
import { ImageMetadataModel } from '../models/Image/ImageMetadataModel';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { VideoMetadataModel } from '../models/VideoMetadataModel';
import { GenerationHistoryModel } from '../models/GenerationHistory';
import { PromptCollectionService } from './promptCollectionService';
import { settingsService } from './settingsService';
import { deleteFile as recycleBinDeleteFile } from '../utils/recycleBin';
import { runtimePaths } from '../config/runtimePaths';
import { db } from '../database/init';

/**
 * 통합 삭제 서비스
 *
 * 모든 삭제 작업을 처리하는 중앙 집중형 서비스
 * - composite_hash 중복 검사
 * - RecycleBin 처리
 * - 일관된 에러 핸들링
 */
export class DeletionService {
  private static UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

  /**
   * composite_hash 중복 여부 확인
   *
   * @param compositeHash - 확인할 composite_hash
   * @returns true면 중복 존재 (2개 이상), false면 단일 파일
   */
  static async checkCompositeHashDuplication(compositeHash: string): Promise<boolean> {
    const count = db.prepare(`
      SELECT COUNT(*) as count FROM image_files
      WHERE composite_hash = ? AND file_status = 'active'
    `).get(compositeHash) as { count: number };

    return count.count > 1;
  }

  /**
   * 파일 삭제 (RecycleBin 또는 완전 삭제)
   *
   * @param filePath - 삭제할 파일 경로 (상대 경로 또는 절대 경로)
   * @param useRecycleBin - RecycleBin 사용 여부
   * @returns RecycleBin 사용 시 RecycleBin 경로, 완전 삭제 시 undefined
   */
  private static async deletePhysicalFile(
    filePath: string,
    useRecycleBin: boolean
  ): Promise<string | undefined> {
    // 절대 경로로 변환
    let absolutePath: string;
    if (path.isAbsolute(filePath)) {
      absolutePath = filePath;
    } else {
      absolutePath = path.join(this.UPLOAD_BASE_PATH, filePath);
    }

    // 파일 존재 확인
    if (!fs.existsSync(absolutePath)) {
      console.warn(`⚠️ File not found (skipping): ${absolutePath}`);
      return undefined;
    }

    try {
      return await recycleBinDeleteFile(absolutePath, useRecycleBin);
    } catch (error) {
      console.error(`❌ Failed to delete file: ${absolutePath}`, error);
      throw error;
    }
  }

  /**
   * 프롬프트 수집 정리
   *
   * @param prompt - 정프롬프트
   * @param negativePrompt - 네거티브 프롬프트
   */
  private static async cleanupPromptCollection(
    prompt: string | null,
    negativePrompt: string | null
  ): Promise<void> {
    try {
      console.log('🔍 Removing prompts from collection...');
      await PromptCollectionService.removeFromImage(prompt, negativePrompt);
      console.log('✅ Prompts removed from collection successfully');
    } catch (error) {
      console.warn('⚠️ Failed to remove prompts from collection (non-critical):', error);
    }
  }

  /**
   * 이미지 삭제 (전략적 삭제 로직)
   *
   * - composite_hash 중복 시: image_files 테이블에서만 삭제
   * - composite_hash 단일 시: 파일 + image_metadata + image_files + video_metadata 모두 삭제
   *
   * @param compositeHash - 삭제할 composite_hash
   * @returns 삭제 성공 여부
   */
  static async deleteImage(compositeHash: string): Promise<boolean> {
    // 1. composite_hash 검증
    if (!compositeHash || compositeHash.length !== 48) {
      throw new Error('Invalid composite hash');
    }

    // 2. 메타데이터 조회
    const metadata = ImageMetadataModel.findByHash(compositeHash);
    if (!metadata) {
      throw new Error('Image not found');
    }

    // 3. 파일 목록 조회
    const files = ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      console.warn(`⚠️ No active files found for composite_hash: ${compositeHash}`);
    }

    // 4. 중복 검사
    const isDuplicated = await this.checkCompositeHashDuplication(compositeHash);
    const settings = settingsService.loadSettings();
    const useRecycleBin = settings.general.deleteProtection.enabled;

    console.log(`🗑️ Deleting image ${compositeHash}:`, {
      isDuplicated,
      useRecycleBin,
      fileCount: files.length
    });

    if (isDuplicated) {
      // ===== 중복 파일 존재: image_files 테이블에서만 삭제 =====
      console.log('📋 Duplicate composite_hash detected - deleting only from image_files table');

      // image_files 테이블에서 삭제
      for (const file of files) {
        db.prepare('DELETE FROM image_files WHERE id = ?').run(file.id);
        console.log(`✅ Deleted image_file record: ${file.id} (${file.original_file_path})`);
      }

      // 프롬프트 정리 (중복이므로 프롬프트는 유지)
      // 삭제하지 않음

      return true;
    } else {
      // ===== 단일 파일: 완전 삭제 =====
      console.log('🗑️ Single composite_hash - performing full deletion');

      // 5. 프롬프트 정리 (먼저 실행 - 실패해도 계속 진행)
      await this.cleanupPromptCollection(
        metadata.prompt || null,
        metadata.negative_prompt || null
      );

      // 6. 물리적 파일 삭제
      // 원본 파일들 - RecycleBin 설정에 따라 백업 또는 삭제
      for (const file of files) {
        try {
          await this.deletePhysicalFile(file.original_file_path, useRecycleBin);
        } catch (error) {
          console.warn(`⚠️ Failed to delete original file (continuing): ${file.original_file_path}`, error);
        }
      }

      // 썸네일 파일 - 항상 즉시 삭제 (복구 시 자동 생성 가능)
      if (metadata.thumbnail_path) {
        try {
          await this.deletePhysicalFile(metadata.thumbnail_path, false);
        } catch (error) {
          console.warn(`⚠️ Failed to delete thumbnail (continuing): ${metadata.thumbnail_path}`, error);
        }
      }

      // 7. 데이터베이스 삭제 (CASCADE로 image_files, video_metadata 자동 삭제)
      const deleted = ImageMetadataModel.delete(compositeHash);

      if (!deleted) {
        throw new Error('Failed to delete image from database');
      }

      console.log(`✅ Image ${compositeHash} deleted successfully`);
      return true;
    }
  }

  /**
   * 생성 히스토리만 삭제
   *
   * @param historyId - 삭제할 히스토리 ID
   * @returns 삭제 성공 여부
   */
  static async deleteGenerationHistoryOnly(historyId: number): Promise<boolean> {
    const history = GenerationHistoryModel.findById(historyId);

    if (!history) {
      throw new Error('Generation history not found');
    }

    console.log(`🗑️ Deleting generation history only: ${historyId}`);

    // 히스토리 DB에서만 삭제
    GenerationHistoryModel.delete(historyId);

    console.log(`✅ Generation history ${historyId} deleted successfully`);
    return true;
  }

  /**
   * 생성 히스토리 + 연결된 파일 삭제
   *
   * @param historyId - 삭제할 히스토리 ID
   * @returns 삭제 성공 여부
   */
  static async deleteGenerationHistoryWithFiles(historyId: number): Promise<boolean> {
    const history = GenerationHistoryModel.findById(historyId);

    if (!history) {
      throw new Error('Generation history not found');
    }

    console.log(`🗑️ Deleting generation history with files: ${historyId}`);

    // 1. 연결된 이미지 ID가 있으면 이미지 삭제 로직 실행
    if (history.linked_image_id) {
      // linked_image_id는 composite_hash를 의미
      try {
        await this.deleteImage(history.linked_image_id.toString());
      } catch (error) {
        console.warn(`⚠️ Failed to delete linked image: ${history.linked_image_id}`, error);
      }
    }

    // 2. 히스토리 레코드 삭제
    GenerationHistoryModel.delete(historyId);

    console.log(`✅ Generation history ${historyId} and files deleted successfully`);
    return true;
  }

  /**
   * 비디오 파일 삭제 (기존 로직 유지 - deprecated 예정)
   *
   * @deprecated 향후 deleteImage()로 통합 예정
   */
  static async deleteVideoFiles(
    originalPath: string,
    thumbnailPath: string,
    useRecycleBin?: boolean
  ): Promise<void> {
    const settings = settingsService.loadSettings();
    const shouldUseRecycleBin = useRecycleBin ?? settings.general.deleteProtection.enabled;

    const filesToDelete = [originalPath, thumbnailPath].filter(Boolean);

    for (const filePath of filesToDelete) {
      try {
        await this.deletePhysicalFile(filePath, shouldUseRecycleBin);
      } catch (error) {
        console.warn(`⚠️ Failed to delete video file: ${filePath}`, error);
      }
    }
  }

  /**
   * 임시 파일 삭제 (RecycleBin 없이 즉시 삭제)
   *
   * @param tempFilePath - 임시 파일 경로
   */
  static async deleteTempFile(tempFilePath: string): Promise<void> {
    // 임시 파일은 RecycleBin 사용 안 함
    await this.deletePhysicalFile(tempFilePath, false);
  }

  /**
   * 다중 이미지 삭제 (배치 처리)
   *
   * @param compositeHashes - 삭제할 composite_hash 배열
   * @returns 삭제 결과 (성공/실패 개수)
   */
  static async deleteMultipleImages(compositeHashes: string[]): Promise<{
    success: number;
    failed: number;
    errors: Array<{ hash: string; error: string }>;
  }> {
    let successCount = 0;
    let failedCount = 0;
    const errors: Array<{ hash: string; error: string }> = [];

    for (const hash of compositeHashes) {
      try {
        await this.deleteImage(hash);
        successCount++;
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ hash, error: errorMessage });
        console.error(`❌ Failed to delete image ${hash}:`, error);
      }
    }

    console.log(`✅ Batch deletion completed: ${successCount} success, ${failedCount} failed`);
    return { success: successCount, failed: failedCount, errors };
  }
}
