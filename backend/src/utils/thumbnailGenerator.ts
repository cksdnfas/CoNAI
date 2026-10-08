import fs from 'fs';
import path from 'path';
import type { Sharp } from 'sharp';
import { runtimePaths } from '../config/runtimePaths';
import { ImageProcessor } from '../services/imageProcessor';

/**
 * 썸네일 생성 유틸리티
 *
 * 썸네일은 temp/thumbnails/{날짜}/{해시}.webp 형식으로 생성됩니다.
 * 이 유틸리티는 backgroundProcessorService와 thumbnailRegenerationService에서 공통으로 사용됩니다.
 */
export class ThumbnailGenerator {
  // 날짜별 디렉토리 생성 결과 메모 (하루에 한 번만 mkdir 수행)
  private static ensuredDateDir: string | null = null;

  /**
   * 썸네일 생성 및 경로 반환
   *
   * @param inputPath 원본 이미지 파일 경로
   * @param compositeHash 이미지의 composite hash (파일명으로 사용)
   * @param sourceImage 재사용할 sharp 인스턴스 (없으면 inputPath로 생성)
   * @returns DB 저장용 상대 경로 (temp 폴더 기준: "thumbnails/2025-11-15/hash.webp")
   */
  static async generateThumbnail(
    inputPath: string,
    compositeHash: string,
    sourceImage?: Sharp
  ): Promise<string> {
    // Create date-based directory structure
    const dateStr = new Date().toISOString().split('T')[0];
    // 절대 경로로 디렉토리 생성 (루트 temp 폴더 사용)
    const tempDir = path.join(runtimePaths.tempDir, 'thumbnails', dateStr);

    // Ensure directory exists (memoized per day key)
    if (this.ensuredDateDir !== tempDir) {
      await fs.promises.mkdir(tempDir, { recursive: true });
      this.ensuredDateDir = tempDir;
    }

    // DB 저장용 상대 경로 (temp 폴더 기준)
    const thumbnailPath = path.join('thumbnails', dateStr, `${compositeHash}.webp`);
    // 파일 시스템용 절대 경로
    const absoluteThumbnailPath = path.join(runtimePaths.tempDir, thumbnailPath);

    // Skip if thumbnail already exists
    if (fs.existsSync(absoluteThumbnailPath)) {
      return thumbnailPath;
    }

    // Generate thumbnail using ImageProcessor (applies user settings)
    await ImageProcessor.generateThumbnail(inputPath, absoluteThumbnailPath, undefined, sourceImage);

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
      const absolutePath = resolveThumbnailAbsolutePath(thumbnailPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
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
    const absolutePath = resolveThumbnailAbsolutePath(thumbnailPath);
    return absolutePath !== null && fs.existsSync(absolutePath);
  }
}

/**
 * Resolve a stored `thumbnail_path` to an absolute path inside the temp dir.
 *
 * Stored paths are temp-relative (`thumbnails/<date>/<hash>.webp`) and carry the separators of the OS that wrote
 * them, so a Windows-written `thumbnails\2026-03-17\x.webp` must still resolve on Linux. Returns null for a path
 * that would land outside the temp dir: callers delete what this returns.
 */
export function resolveThumbnailAbsolutePath(thumbnailPath: string, tempDir: string = runtimePaths.tempDir): string | null {
  const trimmed = thumbnailPath.trim();
  if (!trimmed) {
    return null;
  }

  const root = path.resolve(tempDir);
  const resolved = path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, ...trimmed.split(/[\\/]+/).filter(Boolean));

  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}
