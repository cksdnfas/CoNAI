import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

/**
 * API 생성 이미지 파일 저장 유틸리티
 * 업로드 페이지와 동일한 파일 저장 로직 사용
 */
export class FileSaver {
  /**
   * 날짜 기반 폴더 경로 생성 (YYYY-MM-DD)
   */
  private static getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 고유한 파일명 생성 (년도_월_일_시분초_랜덤문자열.png)
   */
  private static generateUniqueFilename(extension: string = 'png'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8);

    return `${year}_${month}_${day}_${hour}${minute}${second}_${random}.${extension}`;
  }

  /**
   * 상대 경로 정규화 (uploads 디렉토리 기준)
   */
  private static normalizeRelativePath(fullPath: string): string {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    return path.relative(uploadsDir, fullPath).replace(/\\/g, '/');
  }

  /**
   * API 생성 이미지를 uploads/API/images/YYYY-MM-DD/ 폴더에 저장
   *
   * @param imageBuffer - 이미지 버퍼
   * @param serviceType - 서비스 타입 ('comfyui' | 'novelai')
   * @returns 저장된 파일 정보
   */
  static async saveGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai'
  ): Promise<{
    originalPath: string;  // uploads 기준 상대 경로
    fileSize: number;
    width: number;
    height: number;
  }> {
    try {
      // 1. 날짜 기반 폴더 생성
      const dateFolder = this.getDateFolder();
      const dateFolderPath = path.join(process.cwd(), 'uploads', 'API', 'images', dateFolder);

      await fs.promises.mkdir(dateFolderPath, { recursive: true });

      // 2. 고유 파일명 생성
      const filename = this.generateUniqueFilename('png');
      const fullPath = path.join(dateFolderPath, filename);

      // 3. Sharp로 이미지 메타데이터 추출
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;

      // 4. 원본 파일만 저장 (썸네일/최적화 버전 생성 안함)
      await sharp(imageBuffer)
        .png() // PNG 포맷 유지
        .toFile(fullPath);

      // 5. 파일 크기 확인
      const stats = await fs.promises.stat(fullPath);

      // 6. uploads 디렉토리 기준 상대 경로 반환
      const relativePath = this.normalizeRelativePath(fullPath);

      console.log(`[FileSaver] ${serviceType} 이미지 저장 완료: ${relativePath} (${width}x${height}, ${Math.round(stats.size / 1024)}KB)`);

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} 이미지 저장 실패:`, error);
      throw new Error(`Failed to save generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
