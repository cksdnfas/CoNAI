import sharp from 'sharp';
import { ColorHistogram } from '../types/similarity';

/**
 * 이미지 유사도 검색 서비스
 * Sharp를 활용한 perceptual hash 및 색상 히스토그램 생성
 */
export class ImageSimilarityService {
  /**
   * Perceptual Hash (pHash) 생성
   * DCT (Discrete Cosine Transform) 기반으로 64비트 해시 생성
   * 밝기/색상 변화에 강한 해시 알고리즘
   */
  static async generatePerceptualHash(imagePath: string): Promise<string> {
    try {
      // 1. 32x32 크기로 리사이즈 (DCT를 위한 충분한 데이터)
      // 2. 그레이스케일 변환
      // 3. Raw 픽셀 데이터 추출
      const { data } = await sharp(imagePath)
        .resize(32, 32, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length !== 1024) {
        throw new Error(`Unexpected pixel data length: ${data.length}`);
      }

      // 픽셀 데이터를 32x32 행렬로 변환
      const matrix: number[][] = [];
      for (let i = 0; i < 32; i++) {
        matrix[i] = [];
        for (let j = 0; j < 32; j++) {
          matrix[i][j] = data[i * 32 + j];
        }
      }

      // DCT 변환 적용
      const dctMatrix = this.applyDCT(matrix);

      // 좌상단 8x8 저주파 영역 추출 (DC 성분 제외)
      const lowFreq: number[] = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          lowFreq.push(dctMatrix[i][j]);
        }
      }

      // 중간값(median) 계산
      const sorted = [...lowFreq].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      // 각 값이 중간값보다 큰지 비교하여 비트 생성
      let hash = '';
      for (let i = 0; i < lowFreq.length; i++) {
        hash += lowFreq[i] > median ? '1' : '0';
      }

      // 64비트 이진 문자열을 16진수로 변환
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
   * 2D DCT (Discrete Cosine Transform) Type-II 변환
   * 이미지를 주파수 도메인으로 변환하여 본질적인 구조 추출
   * @param matrix 입력 행렬 (NxN)
   * @returns DCT 변환된 행렬
   */
  private static applyDCT(matrix: number[][]): number[][] {
    const N = matrix.length;
    const dct: number[][] = [];

    // 결과 행렬 초기화
    for (let i = 0; i < N; i++) {
      dct[i] = new Array(N).fill(0);
    }

    // 2D DCT-II 공식 적용
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        let sum = 0;

        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
            const cv = v === 0 ? 1 / Math.sqrt(2) : 1;

            sum +=
              cu * cv *
              matrix[i][j] *
              Math.cos(((2 * i + 1) * u * Math.PI) / (2 * N)) *
              Math.cos(((2 * j + 1) * v * Math.PI) / (2 * N));
          }
        }

        dct[u][v] = (2 / N) * sum;
      }
    }

    return dct;
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

  /**
   * Difference Hash (dHash) 생성
   * 9x8 그리드에서 수평 그래디언트 계산
   * 회전 및 밝기 변화에 강함
   */
  static async generateDHash(imagePath: string): Promise<string> {
    try {
      // 9x8 크기로 리사이즈 (수평 차이를 위해 가로 1픽셀 더 필요)
      const { data } = await sharp(imagePath)
        .resize(9, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length !== 72) {
        throw new Error(`Unexpected pixel data length: ${data.length}`);
      }

      // 각 행에서 좌->우 비교하여 비트 생성
      let hash = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const leftPixel = data[row * 9 + col];
          const rightPixel = data[row * 9 + col + 1];
          hash += leftPixel < rightPixel ? '1' : '0';
        }
      }

      // 64비트 이진 문자열을 16진수로 변환
      return this.binaryToHex(hash);
    } catch (error) {
      console.error('Failed to generate dHash:', error);
      throw new Error(`dHash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Average Hash (aHash) 생성
   * 8x8 그레이스케일의 평균값 기반
   * 가장 빠르고 단순한 해시
   */
  static async generateAHash(imagePath: string): Promise<string> {
    try {
      const { data } = await sharp(imagePath)
        .resize(8, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (data.length !== 64) {
        throw new Error(`Unexpected pixel data length: ${data.length}`);
      }

      // 평균값 계산
      const average = data.reduce((sum, val) => sum + val, 0) / data.length;

      // 비트 생성
      let hash = '';
      for (let i = 0; i < data.length; i++) {
        hash += data[i] > average ? '1' : '0';
      }

      // 64비트 이진 문자열을 16진수로 변환
      return this.binaryToHex(hash);
    } catch (error) {
      console.error('Failed to generate aHash:', error);
      throw new Error(`aHash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 복합 해시 생성 (pHash + dHash + aHash) - 최적화 버전
   * 단일 Sharp 파이프라인으로 모든 해시 생성 (3x I/O 절감)
   */
  static async generateCompositeHash(imagePath: string): Promise<{
    compositeHash: string;
    perceptualHash: string;
    dHash: string;
    aHash: string;
  }> {
    try {
      // 1. 단일 Sharp 파이프라인으로 32x32 그레이스케일 버퍼 생성
      const buffer32x32 = await sharp(imagePath)
        .resize(32, 32, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();

      if (buffer32x32.length !== 1024) {
        throw new Error(`Unexpected pixel data length for pHash: ${buffer32x32.length}`);
      }

      // 2. Perceptual Hash 계산 (버퍼 기반)
      const matrix: number[][] = [];
      for (let i = 0; i < 32; i++) {
        matrix[i] = [];
        for (let j = 0; j < 32; j++) {
          matrix[i][j] = buffer32x32[i * 32 + j];
        }
      }

      const dctMatrix = this.applyDCT(matrix);
      const lowFreq: number[] = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          lowFreq.push(dctMatrix[i][j]);
        }
      }

      const sorted = [...lowFreq].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      let pHashBinary = '';
      for (let i = 0; i < lowFreq.length; i++) {
        pHashBinary += lowFreq[i] > median ? '1' : '0';
      }
      const perceptualHash = this.binaryToHex(pHashBinary);

      // 3. dHash 계산 (32x32 버퍼 재사용, 9x8 다운샘플링)
      let dHashBinary = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          // 32x32에서 9x8로 다운샘플링 (4픽셀 간격)
          const leftPixel = buffer32x32[row * 4 * 32 + col * 4];
          const rightPixel = buffer32x32[row * 4 * 32 + (col + 1) * 4];
          dHashBinary += leftPixel < rightPixel ? '1' : '0';
        }
      }
      const dHash = this.binaryToHex(dHashBinary);

      // 4. aHash 계산 (32x32 버퍼 재사용, 8x8 다운샘플링)
      const samples: number[] = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          // 32x32에서 8x8로 다운샘플링 (4픽셀 간격)
          samples.push(buffer32x32[i * 4 * 32 + j * 4]);
        }
      }

      const average = samples.reduce((sum, val) => sum + val, 0) / samples.length;
      let aHashBinary = '';
      for (let i = 0; i < samples.length; i++) {
        aHashBinary += samples[i] > average ? '1' : '0';
      }
      const aHash = this.binaryToHex(aHashBinary);

      // 5. 복합 해시 생성
      const compositeHash = `${perceptualHash}${dHash}${aHash}`;

      return {
        compositeHash,
        perceptualHash,
        dHash,
        aHash
      };
    } catch (error) {
      console.error('Failed to generate composite hash:', error);
      throw new Error(`Composite hash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 복합 해시 및 컬러 히스토그램 동시 생성 - 최적화 버전
   * 2개의 Sharp 파이프라인으로 모든 데이터 생성 (4x → 2x I/O 절감)
   */
  static async generateHashAndHistogram(imagePath: string): Promise<{
    hashes: {
      compositeHash: string;
      perceptualHash: string;
      dHash: string;
      aHash: string;
    };
    colorHistogram: ColorHistogram;
  }> {
    try {
      // 병렬 처리: 그레이스케일 해시 + RGB 히스토그램
      const [grayBuffer, rgbBuffer] = await Promise.all([
        // 1. 32x32 그레이스케일 버퍼 (해시용)
        sharp(imagePath)
          .resize(32, 32, { fit: 'fill' })
          .greyscale()
          .raw()
          .toBuffer(),
        // 2. 32x32 RGB 버퍼 (히스토그램용)
        sharp(imagePath)
          .resize(32, 32, { fit: 'fill' })
          .removeAlpha()  // 알파 채널 제거하여 RGB 강제 변환
          .toColourspace('srgb')  // RGB 색공간 명시
          .raw()
          .toBuffer()
      ]);

      // === 해시 계산 (그레이스케일 버퍼 기반) ===
      if (grayBuffer.length !== 1024) {
        throw new Error(`Unexpected grayscale buffer length: ${grayBuffer.length}`);
      }

      // Perceptual Hash
      const matrix: number[][] = [];
      for (let i = 0; i < 32; i++) {
        matrix[i] = [];
        for (let j = 0; j < 32; j++) {
          matrix[i][j] = grayBuffer[i * 32 + j];
        }
      }

      const dctMatrix = this.applyDCT(matrix);
      const lowFreq: number[] = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          lowFreq.push(dctMatrix[i][j]);
        }
      }

      const sorted = [...lowFreq].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      let pHashBinary = '';
      for (let i = 0; i < lowFreq.length; i++) {
        pHashBinary += lowFreq[i] > median ? '1' : '0';
      }
      const perceptualHash = this.binaryToHex(pHashBinary);

      // dHash
      let dHashBinary = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const leftPixel = grayBuffer[row * 4 * 32 + col * 4];
          const rightPixel = grayBuffer[row * 4 * 32 + (col + 1) * 4];
          dHashBinary += leftPixel < rightPixel ? '1' : '0';
        }
      }
      const dHash = this.binaryToHex(dHashBinary);

      // aHash
      const samples: number[] = [];
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          samples.push(grayBuffer[i * 4 * 32 + j * 4]);
        }
      }

      const average = samples.reduce((sum, val) => sum + val, 0) / samples.length;
      let aHashBinary = '';
      for (let i = 0; i < samples.length; i++) {
        aHashBinary += samples[i] > average ? '1' : '0';
      }
      const aHash = this.binaryToHex(aHashBinary);

      const compositeHash = `${perceptualHash}${dHash}${aHash}`;

      // === 색상 히스토그램 계산 (RGB 버퍼 기반) ===
      if (rgbBuffer.length !== 3072) {
        throw new Error(`Unexpected RGB buffer length: ${rgbBuffer.length}`);
      }

      const histogram: ColorHistogram = {
        r: new Array(256).fill(0),
        g: new Array(256).fill(0),
        b: new Array(256).fill(0)
      };

      for (let i = 0; i < rgbBuffer.length; i += 3) {
        const r = rgbBuffer[i];
        const g = rgbBuffer[i + 1];
        const b = rgbBuffer[i + 2];

        histogram.r[r]++;
        histogram.g[g]++;
        histogram.b[b]++;
      }

      // 정규화
      const totalPixels = 32 * 32;
      for (let i = 0; i < 256; i++) {
        histogram.r[i] /= totalPixels;
        histogram.g[i] /= totalPixels;
        histogram.b[i] /= totalPixels;
      }

      return {
        hashes: {
          compositeHash,
          perceptualHash,
          dHash,
          aHash
        },
        colorHistogram: histogram
      };
    } catch (error) {
      console.error('Failed to generate hash and histogram:', error);
      throw new Error(`Hash and histogram generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 복합 해시 기반 유사도 판별
   * 3개 해시의 합의로 "같은 이미지" 여부 판정
   */
  static isSameImage(
    hashA: { perceptualHash: string; dHash: string; aHash: string },
    hashB: { perceptualHash: string; dHash: string; aHash: string },
    threshold: number = 5
  ): {
    isSame: boolean;
    confidence: number;
    matchType: 'exact' | 'near-same' | 'similar' | 'different';
    details: {
      pHashDistance: number;
      dHashDistance: number;
      aHashDistance: number;
      avgDistance: number;
      consensus: number;
    };
  } {
    const pDist = this.calculateHammingDistance(hashA.perceptualHash, hashB.perceptualHash);
    const dDist = this.calculateHammingDistance(hashA.dHash, hashB.dHash);
    const aDist = this.calculateHammingDistance(hashA.aHash, hashB.aHash);

    // 가중 평균 (pHash 50%, dHash 30%, aHash 20%)
    const avgDistance = pDist * 0.5 + dDist * 0.3 + aDist * 0.2;

    // 합의 기반 판정 (2개 이상 threshold 이하면 "같은 이미지")
    const consensus = [
      pDist <= threshold,
      dDist <= threshold,
      aDist <= threshold
    ].filter(v => v).length;

    // 최종 판정
    let isSame = false;
    let matchType: 'exact' | 'near-same' | 'similar' | 'different' = 'different';

    if (pDist === 0 && dDist === 0 && aDist === 0) {
      // 완전히 동일
      isSame = true;
      matchType = 'exact';
    } else if (consensus >= 2 && avgDistance <= threshold) {
      // 거의 같은 이미지 (리사이징/재압축)
      isSame = true;
      matchType = 'near-same';
    } else if (avgDistance <= 15) {
      // 유사한 이미지
      isSame = false;
      matchType = 'similar';
    }

    const confidence = isSame ? Math.max(0, 100 - (avgDistance / 64) * 100) : 0;

    return {
      isSame,
      confidence: Math.round(confidence * 100) / 100,
      matchType,
      details: {
        pHashDistance: pDist,
        dHashDistance: dDist,
        aHashDistance: aDist,
        avgDistance: Math.round(avgDistance * 100) / 100,
        consensus
      }
    };
  }
}
