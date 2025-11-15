import sharp from 'sharp';
import { settingsService } from '../settingsService';

/**
 * 썸네일 생성 서비스
 */
export class ThumbnailGenerationService {
  /**
   * 썸네일 생성
   */
  static async generateThumbnail(
    inputPath: string,
    outputPath: string,
    mimeType: string
  ): Promise<void> {
    // 비디오 파일은 썸네일 생성하지 않음 (원본 사용)
    if (mimeType.startsWith('video/')) {
      return;
    }

    // Load settings
    const settings = settingsService.loadSettings();
    const { size: sizeOption, quality } = settings.thumbnail;

    // Determine thumbnail size
    let targetSize: number | undefined;
    if (sizeOption === 'original') {
      // For 'original', don't resize - use original dimensions
      targetSize = undefined;
    } else {
      targetSize = parseInt(sizeOption, 10);
    }

    const pipeline = sharp(inputPath);

    // Only resize if targetSize is specified
    if (targetSize !== undefined) {
      pipeline.resize(targetSize, targetSize, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert to WebP with configured quality
    await pipeline
      .webp({
        quality: quality,
        effort: 4
      })
      .toFile(outputPath);
  }
}