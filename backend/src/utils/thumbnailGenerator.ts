import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { runtimePaths } from '../config/runtimePaths';
import { ImageProcessor } from '../services/imageProcessor';

/**
 * 썸네일 생성 유틸리티
 *
 * 썸네일은 temp/thumbnails/{날짜}/{해시}.webp 형식으로 생성됩니다.
 * 이 유틸리티는 backgroundProcessorService와 thumbnailRegenerationService에서 공통으로 사용됩니다.
 */
export class ThumbnailGenerator {
  /**
   * 썸네일 생성 및 경로 반환
   *
   * @param inputPath 원본 이미지 파일 경로
   * @param compositeHash 이미지의 composite hash (파일명으로 사용)
   * @returns DB 저장용 상대 경로 (temp 폴더 기준: "thumbnails/2025-11-15/hash.webp")
   */
  static async generateThumbnail(
    inputPath: string,
    compositeHash: string
  ): Promise<string> {
    // Create date-based directory structure
    const dateStr = new Date().toISOString().split('T')[0];
    // 절대 경로로 디렉토리 생성 (루트 temp 폴더 사용)
    const tempDir = path.join(runtimePaths.tempDir, 'thumbnails', dateStr);

    // Ensure directory exists
    await fs.promises.mkdir(tempDir, { recursive: true });

    // DB 저장용 상대 경로 (temp 폴더 기준)
    const thumbnailPath = path.join('thumbnails', dateStr, `${compositeHash}.webp`);
    // 파일 시스템용 절대 경로
    const absoluteThumbnailPath = path.join(runtimePaths.tempDir, thumbnailPath);

    // Skip if thumbnail already exists
    if (fs.existsSync(absoluteThumbnailPath)) {
      return thumbnailPath;
    }

    // Generate thumbnail using ImageProcessor (applies user settings)
    await ImageProcessor.generateThumbnail(inputPath, absoluteThumbnailPath);

    return thumbnailPath;
  }

  /**
   * 썸네일 삭제
   *
   * @param thumbnailPath DB에 저장된 썸네일 상대 경로
   * @returns 삭제 성공 여부
   */
  static async deleteThumbnail(thumbnailPath: string): Promise<boolean> {
    try {
      const absolutePath = path.join(runtimePaths.tempDir, thumbnailPath);
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete thumbnail: ${thumbnailPath}`, error);
      return false;
    }
  }

  /**
   * 썸네일 존재 여부 확인
   *
   * @param thumbnailPath DB에 저장된 썸네일 상대 경로
   * @returns 존재 여부
   */
  static thumbnailExists(thumbnailPath: string): boolean {
    const absolutePath = path.join(runtimePaths.tempDir, thumbnailPath);
    return fs.existsSync(absolutePath);
  }
}
