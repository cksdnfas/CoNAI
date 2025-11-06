import { ImageSimilarityService } from '../imageSimilarity';

/**
 * 해시 생성 서비스
 * Phase 2에서 배경 처리로 실행
 */
export class HashGenerationService {
  /**
   * 파일에 대한 해시 생성 및 히스토그램 수집
   */
  static async generateHashAndHistogram(filePath: string) {
    return await ImageSimilarityService.generateHashAndHistogram(filePath);
  }

  /**
   * Composite 해시 생성
   */
  static async generateCompositeHash(filePath: string) {
    return await ImageSimilarityService.generateCompositeHash(filePath);
  }

  /**
   * 색상 히스토그램 생성
   */
  static async generateColorHistogram(filePath: string) {
    return await ImageSimilarityService.generateColorHistogram(filePath);
  }

  /**
   * 히스토그램 직렬화
   */
  static serializeHistogram(colorHistogram: any): string {
    return ImageSimilarityService.serializeHistogram(colorHistogram);
  }
}
