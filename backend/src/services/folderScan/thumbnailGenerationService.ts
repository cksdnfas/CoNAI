import sharp from 'sharp';

/**
 * 썸네일 생성 서비스
 */
export class ThumbnailGenerationService {
  private static readonly THUMBNAIL_SIZE = 1080;

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

    // 이미지 파일만 Sharp로 썸네일 생성
    await sharp(inputPath)
      .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 90 })
      .toFile(outputPath);
  }
}