import fs from 'fs';
import path from 'path';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import { HistoryCommandService } from './historyCommandService';
import { PromptCollectionService } from './promptCollectionService';
import { settingsService } from './settingsService';
import { deleteFile as recycleBinDeleteFile, recordLibraryRestoreData, moveFileWithoutReplacing, forgetRecycleBinOrigins } from '../utils/recycleBin';
import { runtimePaths } from '../config/runtimePaths';
import { db } from '../database/init';
import { ImageStatsModel } from '../models/Image/ImageStatsModel';
import { resolveThumbnailAbsolutePath } from '../utils/thumbnailGenerator';
import type { ImageMetadataRecord, ImageFileRecord } from '../types/image';
import { QueryCacheService } from './QueryCacheService';
import { MediaImageFeaturesModel } from '../models/Image/MediaImageFeaturesModel';

interface RestorableImageModel {
  model_hash: string;
  model_role: string;
  weight: number | null;
  civitai_checked: number;
  civitai_failed: number;
  checked_at: string | null;
  created_at: string;
}

interface RestorableVideoOptimization {
  source_path: string;
  source_size: number;
  source_mtime: number;
  crf: number;
  audio_bitrate: number;
  status: string;
  output_path: string | null;
  attempts: number;
  lease_until: number;
  last_error: string | null;
}

interface LibraryRestoreData {
  metadata: ImageMetadataRecord;
  file: ImageFileRecord;
  groups: Array<{ group_id: number; added_date: string; order_index: number; collection_type: string; auto_collected_date: string | null }>;
  folderGroups: Array<{ group_id: number; added_date: string }>;
  /** Optional for entries created before side-table snapshots were supported. The BLOB is encoded losslessly. */
  colorHistogram?: string | null;
  models?: RestorableImageModel[];
  videoOptimization?: RestorableVideoOptimization | null;
}

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
      return await recycleBinDeleteFile(absolutePath, useRecycleBin, 'library');
    } catch (error) {
      console.error(`❌ Failed to delete file: ${absolutePath}`, error);
      throw error;
    }
  }

  /**
   * Remove a thumbnail for good. Thumbnails are temp-relative (not uploads-relative) and regenerable, so they never
   * go to the RecycleBin.
   */
  private static async deleteThumbnailFile(thumbnailPath: string): Promise<void> {
    const absolutePath = resolveThumbnailAbsolutePath(thumbnailPath);
    if (!absolutePath) {
      console.warn(`⚠️ Thumbnail path outside the temp dir (skipping): ${thumbnailPath}`);
      return;
    }

    try {
      await fs.promises.unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Delete one media row and every image_files row that points at it, in one transaction. The image_files FK is
   * ON DELETE SET NULL, so deleting only the metadata would leave active file rows with a NULL hash behind.
   */
  private static deleteMetadataWithFiles(compositeHash: string): boolean {
    const deleted = db.transaction(() => {
      db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(compositeHash);
      return db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(compositeHash).changes > 0;
    })();

    if (deleted) {
      ImageStatsModel.invalidateAutoTagStatsCache();
    }

    return deleted;
  }

  /**
   * 프롬프트 수집 정리
   *
   * @param prompt - 정프롬프트
   * @param negativePrompt - 네거티브 프롬프트
   */
  private static async cleanupPromptCollection(
    prompt: string | null,
    negativePrompt: string | null,
    characterPromptText: string | null = null,
    autoTags: string | null = null,
  ): Promise<void> {
    try {
      console.log('🔍 Removing prompts from collection...');
      await PromptCollectionService.removeFromImage(prompt, negativePrompt, characterPromptText, autoTags);
      console.log('✅ Prompts removed from collection successfully');
    } catch (error) {
      console.warn('⚠️ Failed to remove prompts from collection (non-critical):', error);
    }
  }

  /** Remove generation-history rows linked to a hash and keep log wording consistent. */
  private static cleanupGenerationHistoryForHash(compositeHash: string, orphaned = false): number {
    const deletedHistoryCount = HistoryCommandService.deleteByCompositeHash(compositeHash);
    if (deletedHistoryCount > 0) {
      const label = orphaned ? 'orphaned generation history record(s) for' : 'generation history record(s) linked to';
      console.log(`🧹 Removed ${deletedHistoryCount} ${label} ${compositeHash}`);
    }

    return deletedHistoryCount;
  }

  /**
   * 이미지/비디오 삭제
   *
   * - 연결된 원본 파일은 모두 RecycleBin(또는 즉시 삭제) 처리
   * - image_files / media_metadata 관련 DB 레코드는 함께 정리
   *
   * @param compositeHash - 삭제할 composite_hash (이미지: 48자, 비디오: 32자)
   * @returns 삭제 성공 여부
   */
  static async deleteImage(compositeHash: string): Promise<boolean> {
    await this.deleteImageWithRestoreEntries(compositeHash);
    return true;
  }

  /** Return only the exact files moved by this request; permanent/missing files have no undo entry. */
  static async deleteImageWithRestoreEntries(compositeHash: string): Promise<string[]> {
    console.log(`🔍 Starting deleteImage for: ${compositeHash}`);

    // 1. composite_hash 검증 (이미지: 48자, 비디오: 32자)
    if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
      throw new Error('Invalid composite hash');
    }

    // 2. 메타데이터 조회
    const metadata = MediaMetadataModel.findByHash(compositeHash);
    if (!metadata) {
      // ✅ Idempotent: Already deleted images return success instead of error
      console.warn(`⚠️ Image already deleted or not found: ${compositeHash}`);
      this.cleanupGenerationHistoryForHash(compositeHash, true);
      return [];
    }

    // 3. 파일 목록 조회
    const files = ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      console.warn(`⚠️ No active files found for composite_hash: ${compositeHash}`);
    }

    const settings = settingsService.loadSettings();
    const useRecycleBin = settings.general.deleteProtection.enabled;
    const groups = useRecycleBin
      ? db.prepare('SELECT group_id, added_date, order_index, collection_type, auto_collected_date FROM image_groups WHERE composite_hash = ?').all(compositeHash) as LibraryRestoreData['groups']
      : [];
    const folderGroups = useRecycleBin
      ? db.prepare('SELECT group_id, added_date FROM auto_folder_group_images WHERE composite_hash = ?').all(compositeHash) as LibraryRestoreData['folderGroups']
      : [];
    const colorHistogram = useRecycleBin ? MediaImageFeaturesModel.getHistogram(compositeHash)?.toString('base64') ?? null : null;
    const models = useRecycleBin
      ? db.prepare('SELECT model_hash, model_role, weight, civitai_checked, civitai_failed, checked_at, created_at FROM image_models WHERE composite_hash = ?').all(compositeHash) as RestorableImageModel[]
      : [];
    const videoOptimization = useRecycleBin
      ? db.prepare(`SELECT source_path, source_size, source_mtime, crf, audio_bitrate, status, output_path, attempts, lease_until, last_error
        FROM generated_video_optimizations WHERE composite_hash = ?`).get(compositeHash) as RestorableVideoOptimization | undefined
      : undefined;
    const recycleBinEntries: string[] = [];
    const movedFiles: Array<{ name: string; binPath: string; original: string }> = [];

    console.log(`🗑️ Deleting image ${compositeHash}:`, {
      useRecycleBin,
      fileCount: files.length,
    });

    // 5. 물리적 파일 삭제
    // 원본 파일들 - RecycleBin 설정에 따라 백업 또는 삭제
    try {
      for (const file of files) {
        const binPath = await this.deletePhysicalFile(file.original_file_path, useRecycleBin);
        if (binPath) {
          const name = path.basename(binPath);
          const original = path.isAbsolute(file.original_file_path) ? file.original_file_path : path.join(this.UPLOAD_BASE_PATH, file.original_file_path);
          movedFiles.push({ name, binPath, original });
          recordLibraryRestoreData(name, JSON.stringify({ metadata, file, groups, folderGroups, colorHistogram, models, videoOptimization } satisfies LibraryRestoreData));
          recycleBinEntries.push(name);
        }
      }

      // Thumbnails are regenerable; only originals are backed up.
      if (metadata.thumbnail_path) {
        try {
          await this.deleteThumbnailFile(metadata.thumbnail_path);
        } catch (error) {
          console.warn(`⚠️ Failed to delete thumbnail (continuing): ${metadata.thumbnail_path}`, error);
        }
      }

      if (!this.deleteMetadataWithFiles(compositeHash)) throw new Error('Failed to delete image from database');
    } catch (error) {
      // A failed protected deletion must not strand the first copies of a multi-file image in the bin.
      for (const moved of movedFiles) {
        await moveFileWithoutReplacing(moved.binPath, moved.original);
        forgetRecycleBinOrigins([moved.name]);
      }
      throw error;
    }

    await this.cleanupPromptCollection(metadata.prompt, metadata.negative_prompt, metadata.character_prompt_text, metadata.auto_tags);
    this.cleanupGenerationHistoryForHash(compositeHash);

    console.log(`✅ Image ${compositeHash} deleted successfully`);
    return recycleBinEntries;
  }

  /** Reattach a restored file and its surviving groups without replacing newer library edits. */
  static restoreLibraryEntry(data: string, restoredTo: string): void {
    const snapshot = JSON.parse(data) as LibraryRestoreData;
    const { metadata, file, groups, folderGroups } = snapshot;
    db.transaction(() => {
      if (!MediaMetadataModel.findByHash(metadata.composite_hash)) {
        MediaMetadataModel.create(metadata);
        db.prepare(`UPDATE media_metadata SET first_seen_date = ?, metadata_updated_date = ?,
          postprocess_status = ?, postprocess_completed_at = ? WHERE composite_hash = ?`)
          .run(metadata.first_seen_date, metadata.metadata_updated_date, metadata.postprocess_status ?? 'ready', metadata.postprocess_completed_at ?? null, metadata.composite_hash);
        PromptCollectionService.restoreImageUsage(metadata.prompt, metadata.negative_prompt, metadata.character_prompt_text, metadata.auto_tags);
        if (snapshot.colorHistogram) MediaImageFeaturesModel.setHistogram(metadata.composite_hash, Buffer.from(snapshot.colorHistogram, 'base64'));
        const addModel = db.prepare(`INSERT INTO image_models
          (composite_hash, model_hash, model_role, weight, civitai_checked, civitai_failed, checked_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const model of snapshot.models ?? []) {
          addModel.run(metadata.composite_hash, model.model_hash, model.model_role, model.weight, model.civitai_checked, model.civitai_failed, model.checked_at, model.created_at);
        }
        // media_similarity_index and media_auto_tags are rebuilt by metadata creation / setHistogram.
      }
      const existing = ImageFileModel.findByPath(restoredTo);
      if (existing && existing.composite_hash !== metadata.composite_hash) {
        throw new Error('The restored path is already registered to another image');
      }
      if (!existing) ImageFileModel.create({ ...file, original_file_path: restoredTo, file_status: 'active' });
      else ImageFileModel.updateStatus(existing.id, 'active');
      const optimization = snapshot.videoOptimization;
      const original = path.isAbsolute(file.original_file_path) ? file.original_file_path : path.join(this.UPLOAD_BASE_PATH, file.original_file_path);
      if (optimization && path.resolve(optimization.source_path) === path.resolve(original)) {
        db.prepare(`INSERT OR IGNORE INTO generated_video_optimizations
          (composite_hash, source_path, source_size, source_mtime, crf, audio_bitrate, status, output_path, attempts, lease_until, last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(metadata.composite_hash, restoredTo, optimization.source_size, optimization.source_mtime, optimization.crf, optimization.audio_bitrate,
            optimization.status, optimization.output_path, optimization.attempts, optimization.lease_until, optimization.last_error);
      }
      const addGroup = db.prepare(`INSERT OR IGNORE INTO image_groups
        (group_id, composite_hash, added_date, order_index, collection_type, auto_collected_date)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?)`);
      for (const group of groups) addGroup.run(group.group_id, metadata.composite_hash, group.added_date, group.order_index, group.collection_type, group.auto_collected_date, group.group_id);
      const addFolderGroup = db.prepare(`INSERT OR IGNORE INTO auto_folder_group_images (group_id, composite_hash, added_date)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM auto_folder_groups WHERE id = ?)`);
      for (const group of folderGroups) addFolderGroup.run(group.group_id, metadata.composite_hash, group.added_date, group.group_id);
    })();
    QueryCacheService.invalidateImageCache(metadata.composite_hash, true);
  }

  /**
   * file_id 기반 개별 파일 삭제 (중복 파일 개별 삭제 지원)
   *
   * - 지정된 file_id의 파일만 정확히 삭제
   * - 물리 파일을 RecycleBin으로 이동 또는 완전 삭제
   * - 해당 composite_hash의 마지막 파일이면 메타데이터도 정리
   *
   * @param fileId - 삭제할 image_files.id
   * @returns 삭제 성공 여부
   */
  static async deleteImageFile(fileId: number): Promise<boolean> {
    console.log(`🔍 Starting deleteImageFile for file_id: ${fileId}`);

    // 1. 파일 정보 조회
    const file = ImageFileModel.findById(fileId);
    if (!file) {
      console.warn(`⚠️ File not found: ${fileId}`);
      return false;
    }

    const { composite_hash, original_file_path } = file;
    console.log(`📁 File info: ${original_file_path}`);

    // 2. RecycleBin 설정 확인
    const settings = settingsService.loadSettings();
    const useRecycleBin = settings.general.deleteProtection.enabled;

    console.log(`🗑️ Deleting file_id ${fileId}: {
  path: ${original_file_path},
  composite_hash: ${composite_hash},
  useRecycleBin: ${useRecycleBin}
}`);

    // 3. 물리 파일 삭제 (RecycleBin 또는 완전 삭제)
    try {
      await this.deletePhysicalFile(original_file_path, useRecycleBin);
      console.log(`✅ Physical file deleted: ${original_file_path}`);
    } catch (error) {
      console.error(`❌ Failed to delete physical file: ${original_file_path}`, error);
      throw error;
    }

    // 4. image_files 테이블에서 삭제
    ImageFileModel.delete(fileId);
    console.log(`✅ Deleted image_file record: ${fileId}`);

    // 5. 같은 composite_hash의 남은 파일 확인
    if (composite_hash) {
      const remainingFiles = ImageFileModel.findActiveByHash(composite_hash);

      if (remainingFiles.length === 0) {
        // 마지막 파일 삭제됨 → 메타데이터 정리
        console.log(`⚠️ Last file deleted - cleaning up metadata for ${composite_hash}`);

        const metadata = MediaMetadataModel.findByHash(composite_hash);
        if (metadata) {
          // 프롬프트 수집에서 제거
          await this.cleanupPromptCollection(
            metadata.prompt,
            metadata.negative_prompt,
            metadata.character_prompt_text,
            metadata.auto_tags,
          );

          // 썸네일 삭제 (재생성 가능하므로 RecycleBin 없이 즉시 삭제)
          if (metadata.thumbnail_path) {
            try {
              await this.deleteThumbnailFile(metadata.thumbnail_path);
            } catch (error) {
              console.warn(`⚠️ Failed to delete thumbnail (non-critical)`);
            }
          }

          // 메타데이터 삭제 (남은 missing/deleted 파일 행도 함께 정리)
          this.deleteMetadataWithFiles(composite_hash);
          this.cleanupGenerationHistoryForHash(composite_hash);
          console.log(`✅ Metadata cleaned up for ${composite_hash}`);
        }
      } else {
        console.log(`📋 ${remainingFiles.length} file(s) remaining with same hash - keeping metadata`);
      }
    }

    console.log(`✅ File ${fileId} deleted successfully`);
    return true;
  }

  /**
   * 생성 히스토리만 삭제
   *
   * @param historyId - 삭제할 히스토리 ID
   * @returns 삭제 성공 여부
   */
  static async deleteGenerationHistoryOnly(historyId: number): Promise<boolean> {
    const history = HistoryQueryRepository.findById(historyId);

    if (!history) {
      throw new Error('Generation history not found');
    }

    console.log(`🗑️ Deleting generation history only: ${historyId}`);

    // 히스토리 DB에서만 삭제
    HistoryCommandService.delete(historyId);

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
    const history = HistoryQueryRepository.findById(historyId);

    if (!history) {
      throw new Error('Generation history not found');
    }

    console.log(`🗑️ Deleting generation history with files: ${historyId}`);

    // 1. 연결된 이미지 composite hash가 있으면 이미지 삭제 로직 실행
    if (history.composite_hash) {
      await this.deleteImage(history.composite_hash);
    }

    // 2. 히스토리 레코드 삭제
    HistoryCommandService.delete(historyId);

    console.log(`✅ Generation history ${historyId} and files deleted successfully`);
    return true;
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
    recycleBinEntries: string[];
  }> {
    let successCount = 0;
    let failedCount = 0;
    const errors: Array<{ hash: string; error: string }> = [];
    const recycleBinEntries: string[] = [];

    for (const hash of new Set(compositeHashes)) {
      try {
        recycleBinEntries.push(...await this.deleteImageWithRestoreEntries(hash));
        successCount++;
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ hash, error: errorMessage });
        console.error(`❌ Failed to delete image ${hash}:`, error);
      }
    }

    console.log(`✅ Batch deletion completed: ${successCount} success, ${failedCount} failed`);
    return { success: successCount, failed: failedCount, errors, recycleBinEntries };
  }

}
