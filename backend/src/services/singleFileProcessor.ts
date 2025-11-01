/**
 * SingleFileProcessor - 단일 파일 처리 서비스
 *
 * FolderScanService에서 추출된 단일 파일 처리 로직
 * FileWatcherService와 FolderScanService 모두에서 재사용
 */

import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ImageSimilarityService } from './imageSimilarity';
import { BackgroundQueueService } from './backgroundQueue';
import { shouldProcessFileExtension } from '../constants/supportedExtensions';

export interface FileProcessingResult {
  success: boolean;
  action: 'created' | 'updated' | 'skipped' | 'error';
  fileId?: number;
  compositeHash?: string;
  error?: string;
  thumbnailGenerated?: boolean;
}

/**
 * 단일 파일 처리 서비스
 */
export class SingleFileProcessor {
  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly THUMBNAIL_QUALITY = 90;

  /**
   * 단일 파일 처리 (워처 및 배치 스캔에서 사용)
   */
  static async processFile(
    filePath: string,
    folderId: number,
    options: {
      skipIfExists?: boolean;  // 기존 파일이면 스킵
      updateIfModified?: boolean;  // 수정된 파일이면 업데이트
      generateThumbnail?: boolean;  // 썸네일 생성 여부
    } = {}
  ): Promise<FileProcessingResult> {
    const {
      skipIfExists = false,
      updateIfModified = true,
      generateThumbnail = true
    } = options;

    try {
      // 1. 파일 존재 및 접근 가능 여부 확인
      if (!fs.existsSync(filePath)) {
        return { success: false, action: 'error', error: 'File not found' };
      }

      // 2. 파일 정보 가져오기
      const stats = fs.statSync(filePath);
      const mimeType = this.getMimeType(filePath);

      // 3. 기존 파일 확인 (경로로)
      const existingFile = db.prepare(
        'SELECT * FROM image_files WHERE original_file_path = ?'
      ).get(filePath) as any;

      if (existingFile) {
        // 기존 파일이 있는 경우
        if (skipIfExists) {
          return { success: true, action: 'skipped', fileId: existingFile.id };
        }

        // 수정 여부 확인
        const isModified = new Date(existingFile.file_modified_date).getTime() !== stats.mtime.getTime();

        if (isModified && updateIfModified) {
          // 파일이 수정된 경우 재처리
          return await this.updateModifiedFile(filePath, existingFile.id, folderId, stats, mimeType, generateThumbnail);
        } else {
          // 수정되지 않은 경우 상태만 업데이트
          db.prepare(`
            UPDATE image_files
            SET file_status = 'active',
                last_verified_date = ?
            WHERE id = ?
          `).run(new Date().toISOString(), existingFile.id);

          return { success: true, action: 'updated', fileId: existingFile.id };
        }
      }

      // 4. 신규 파일 처리
      return await this.processNewFile(filePath, folderId, stats, mimeType, generateThumbnail);

    } catch (error) {
      console.error(`파일 처리 실패: ${filePath}`, error);
      return {
        success: false,
        action: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 신규 파일 처리
   */
  private static async processNewFile(
    filePath: string,
    folderId: number,
    stats: fs.Stats,
    mimeType: string,
    generateThumbnail: boolean
  ): Promise<FileProcessingResult> {
    try {
      // 1. 해시 및 히스토그램 생성
      const { hashes, colorHistogram } = await ImageSimilarityService.generateHashAndHistogram(filePath);

      // 2. 같은 해시를 가진 메타데이터가 이미 존재하는지 확인
      const existingMetadata = db.prepare(
        'SELECT composite_hash FROM image_metadata WHERE composite_hash = ?'
      ).get(hashes.compositeHash) as any;

      if (existingMetadata) {
        // 같은 이미지가 이미 존재 → image_files에만 추가
        const insertFileResult = db.prepare(`
          INSERT INTO image_files (
            composite_hash, original_file_path, folder_id,
            file_status, file_size, mime_type, file_modified_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          hashes.compositeHash,
          filePath,
          folderId,
          'active',
          stats.size,
          mimeType,
          stats.mtime.toISOString()
        );

        return {
          success: true,
          action: 'created',
          fileId: Number(insertFileResult.lastInsertRowid),
          compositeHash: hashes.compositeHash,
          thumbnailGenerated: false
        };
      }

      // 3. 완전히 새로운 이미지 → 메타데이터 등록
      const result = await this.insertNewImage(
        filePath,
        folderId,
        stats,
        mimeType,
        hashes,
        colorHistogram,
        generateThumbnail
      );

      return result;

    } catch (error) {
      throw new Error(`신규 파일 처리 실패: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * 수정된 파일 업데이트
   */
  private static async updateModifiedFile(
    filePath: string,
    fileId: number,
    folderId: number,
    stats: fs.Stats,
    mimeType: string,
    generateThumbnail: boolean
  ): Promise<FileProcessingResult> {
    try {
      // 1. 새로운 해시 생성
      const { hashes, colorHistogram } = await ImageSimilarityService.generateHashAndHistogram(filePath);

      // 2. 기존 파일 정보 가져오기
      const existingFile = db.prepare(
        'SELECT composite_hash FROM image_files WHERE id = ?'
      ).get(fileId) as any;

      if (existingFile.composite_hash === hashes.compositeHash) {
        // 해시가 동일 → 메타데이터만 업데이트
        db.prepare(`
          UPDATE image_files
          SET file_status = 'active',
              file_modified_date = ?,
              file_size = ?,
              last_verified_date = ?
          WHERE id = ?
        `).run(stats.mtime.toISOString(), stats.size, new Date().toISOString(), fileId);

        return { success: true, action: 'updated', fileId };
      }

      // 3. 해시가 변경됨 → 새로운 메타데이터 생성 필요
      // 기존 메타데이터 확인
      const newMetadata = db.prepare(
        'SELECT composite_hash FROM image_metadata WHERE composite_hash = ?'
      ).get(hashes.compositeHash) as any;

      if (!newMetadata) {
        // 새로운 메타데이터 생성
        await this.insertMetadata(hashes, colorHistogram);
      }

      // 4. image_files 업데이트
      db.prepare(`
        UPDATE image_files
        SET composite_hash = ?,
            file_status = 'active',
            file_modified_date = ?,
            file_size = ?,
            mime_type = ?,
            last_verified_date = ?
        WHERE id = ?
      `).run(
        hashes.compositeHash,
        stats.mtime.toISOString(),
        stats.size,
        mimeType,
        new Date().toISOString(),
        fileId
      );

      // 5. 썸네일 재생성
      let thumbnailGenerated = false;
      if (generateThumbnail) {
        thumbnailGenerated = await this.regenerateThumbnail(filePath, hashes.compositeHash);
      }

      return {
        success: true,
        action: 'updated',
        fileId,
        compositeHash: hashes.compositeHash,
        thumbnailGenerated
      };

    } catch (error) {
      throw new Error(`수정된 파일 업데이트 실패: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * 신규 이미지 삽입
   */
  private static async insertNewImage(
    filePath: string,
    folderId: number,
    stats: fs.Stats,
    mimeType: string,
    hashes: { compositeHash: string; perceptualHash: string; dHash: string; aHash: string },
    colorHistogram: any,
    generateThumbnail: boolean
  ): Promise<FileProcessingResult> {
    try {
      // 1. 메타데이터 삽입
      await this.insertMetadata(hashes, colorHistogram);

      // 2. image_files 삽입
      const insertFileResult = db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      const fileId = Number(insertFileResult.lastInsertRowid);

      // 3. 썸네일 생성
      let thumbnailGenerated = false;
      if (generateThumbnail) {
        thumbnailGenerated = await this.generateThumbnailForFile(filePath, hashes.compositeHash);
      }

      // 4. 백그라운드 작업 큐에 추가 (AI 메타데이터 추출, 프롬프트 수집)
      BackgroundQueueService.addMetadataExtractionTask(filePath, hashes.compositeHash);
      BackgroundQueueService.addPromptCollectionTask(filePath, hashes.compositeHash);

      return {
        success: true,
        action: 'created',
        fileId,
        compositeHash: hashes.compositeHash,
        thumbnailGenerated
      };

    } catch (error) {
      throw new Error(`신규 이미지 삽입 실패: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * 메타데이터 삽입
   */
  private static async insertMetadata(
    hashes: { compositeHash: string; perceptualHash: string; dHash: string; aHash: string },
    colorHistogram: any
  ): Promise<void> {
    db.prepare(`
      INSERT INTO image_metadata (
        composite_hash, perceptual_hash, dhash, ahash, color_histogram
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      hashes.compositeHash,
      hashes.perceptualHash,
      hashes.dHash,
      hashes.aHash,
      JSON.stringify(colorHistogram)
    );
  }

  /**
   * 썸네일 생성
   */
  private static async generateThumbnailForFile(
    filePath: string,
    compositeHash: string
  ): Promise<boolean> {
    try {
      const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
      if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
      }

      const thumbnailPath = path.join(thumbnailDir, `${compositeHash}.webp`);

      // 썸네일이 이미 존재하면 스킵
      if (fs.existsSync(thumbnailPath)) {
        return true;
      }

      await sharp(filePath)
        .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: this.THUMBNAIL_QUALITY })
        .toFile(thumbnailPath);

      return true;
    } catch (error) {
      console.error(`썸네일 생성 실패: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 썸네일 재생성
   */
  private static async regenerateThumbnail(
    filePath: string,
    compositeHash: string
  ): Promise<boolean> {
    try {
      const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
      const thumbnailPath = path.join(thumbnailDir, `${compositeHash}.webp`);

      // 기존 썸네일 삭제
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }

      // 새 썸네일 생성
      return await this.generateThumbnailForFile(filePath, compositeHash);
    } catch (error) {
      console.error(`썸네일 재생성 실패: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 파일 삭제 처리 (file_status를 'missing'으로 변경)
   */
  static markFileAsMissing(filePath: string): boolean {
    try {
      const result = db.prepare(`
        UPDATE image_files
        SET file_status = 'missing',
            last_verified_date = ?
        WHERE original_file_path = ?
      `).run(new Date().toISOString(), filePath);

      return result.changes > 0;
    } catch (error) {
      console.error(`파일 missing 처리 실패: ${filePath}`, error);
      return false;
    }
  }

  /**
   * MIME 타입 추정
   */
  private static getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * 파일 확장자가 유효한 이미지인지 확인
   * @deprecated Use shouldProcessFileExtension from supportedExtensions.ts instead
   */
  static isValidImageExtension(filePath: string, excludeExtensions?: string[]): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return shouldProcessFileExtension(ext, excludeExtensions || []);
  }
}
