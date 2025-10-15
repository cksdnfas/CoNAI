import sharp from 'sharp';
import { ColorHistogram } from '../types/similarity';

/**
 * 이미지 유사도 검색 서비스
 * Sharp를 활용한 perceptual hash 및 색상 히스토그램 생성
 */
export class ImageSimilarityService {
  /**
   * Perceptual Hash (pHash) 생성
   * 8x8 그레이스케일 이미지를 기반으로 64비트 해시 생성
   */
  static async generatePerceptualHash(imagePath: string): Promise<string> {
    try {
      // 1. 8x8 크기로 리사이즈 (비율 무시)
      // 2. 그레이스케일 변환
      // 3. Raw 픽셀 데이터 추출
      const { data, info } = await sharp(imagePath)
        .resize(8, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length !== 64) {
        throw new Error(`Unexpected pixel data length: ${data.length}`);
      }

      // 평균 픽셀 값 계산
      const average = data.reduce((sum, val) => sum + val, 0) / data.length;

      // 각 픽셀이 평균보다 큰지 판단하여 비트 생성
      let hash = '';
      for (let i = 0; i < data.length; i++) {
        hash += data[i] > average ? '1' : '0';
      }

      // 64비트 이진 문자열을 16진수로 변환 (저장 공간 절약)
      return this.binaryToHex(hash);
    } catch (error) {
      console.error('Failed to generate perceptual hash:', error);
      throw new Error(`Perceptual hash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 색상 히스토그램 생성
   * RGB 각 채널의 분포를 분석
   */
  static async generateColorHistogram(imagePath: string): Promise<ColorHistogram> {
    try {
      // 이미지를 32x32로 리사이즈 (성능과 정확도의 균형)
      const { data } = await sharp(imagePath)
        .resize(32, 32, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // RGB 히스토그램 초기화 (각 채널 256개 구간)
      const histogram: ColorHistogram = {
        r: new Array(256).fill(0),
        g: new Array(256).fill(0),
        b: new Array(256).fill(0)
      };

      // 픽셀 데이터를 순회하며 히스토그램 생성
      for (let i = 0; i < data.length; i += 3) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        histogram.r[r]++;
        histogram.g[g]++;
        histogram.b[b]++;
      }

      // 정규화 (0-1 범위로)
      const totalPixels = (32 * 32);
      for (let i = 0; i < 256; i++) {
        histogram.r[i] /= totalPixels;
        histogram.g[i] /= totalPixels;
        histogram.b[i] /= totalPixels;
      }

      return histogram;
    } catch (error) {
      console.error('Failed to generate color histogram:', error);
      throw new Error(`Color histogram generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Hamming Distance 계산
   * 두 해시 간의 비트 차이 개수
   */
  static calculateHammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      throw new Error('Hash lengths must be equal');
    }

    // 16진수를 이진수로 변환
    const binary1 = this.hexToBinary(hash1);
    const binary2 = this.hexToBinary(hash2);

    let distance = 0;
    for (let i = 0; i < binary1.length; i++) {
      if (binary1[i] !== binary2[i]) {
        distance++;
      }
    }

    return distance;
  }

  /**
   * 색상 히스토그램 유사도 계산 (유클리드 거리)
   * 반환값: 0-100 (100이 가장 유사)
   */
  static calculateColorSimilarity(hist1: ColorHistogram, hist2: ColorHistogram): number {
    try {
      let sumSquaredDiff = 0;

      // RGB 각 채널에 대해 유클리드 거리 계산
      for (let i = 0; i < 256; i++) {
        sumSquaredDiff += Math.pow(hist1.r[i] - hist2.r[i], 2);
        sumSquaredDiff += Math.pow(hist1.g[i] - hist2.g[i], 2);
        sumSquaredDiff += Math.pow(hist1.b[i] - hist2.b[i], 2);
      }

      // 유클리드 거리
      const distance = Math.sqrt(sumSquaredDiff);

      // 거리를 유사도로 변환 (0-100)
      // 최대 거리는 sqrt(256 * 3) ≈ 27.7
      const maxDistance = Math.sqrt(256 * 3);
      const similarity = Math.max(0, 100 * (1 - distance / maxDistance));

      return Math.round(similarity * 100) / 100; // 소수점 2자리
    } catch (error) {
      console.error('Failed to calculate color similarity:', error);
      return 0;
    }
  }

  /**
   * Hamming Distance를 유사도 점수로 변환
   * 반환값: 0-100 (100이 가장 유사)
   */
  static hammingDistanceToSimilarity(hammingDistance: number): number {
    // 최대 거리는 64 (모든 비트가 다를 때)
    const maxDistance = 64;
    const similarity = Math.max(0, 100 * (1 - hammingDistance / maxDistance));
    return Math.round(similarity * 100) / 100; // 소수점 2자리
  }

  /**
   * 유사도 매칭 타입 판정
   */
  static determineMatchType(hammingDistance: number): 'exact' | 'near-duplicate' | 'similar' {
    if (hammingDistance === 0) return 'exact';
    if (hammingDistance <= 5) return 'near-duplicate';
    return 'similar';
  }

  /**
   * 이진 문자열을 16진수로 변환
   */
  private static binaryToHex(binary: string): string {
    let hex = '';
    for (let i = 0; i < binary.length; i += 4) {
      const chunk = binary.substr(i, 4);
      hex += parseInt(chunk, 2).toString(16);
    }
    return hex;
  }

  /**
   * 16진수를 이진 문자열로 변환
   */
  private static hexToBinary(hex: string): string {
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
      const bin = parseInt(hex[i], 16).toString(2);
      binary += bin.padStart(4, '0');
    }
    return binary;
  }

  /**
   * 색상 히스토그램 JSON 직렬화
   */
  static serializeHistogram(histogram: ColorHistogram): string {
    return JSON.stringify(histogram);
  }

  /**
   * 색상 히스토그램 JSON 역직렬화
   */
  static deserializeHistogram(json: string): ColorHistogram {
    try {
      return JSON.parse(json) as ColorHistogram;
    } catch (error) {
      throw new Error('Invalid histogram JSON');
    }
  }
}
