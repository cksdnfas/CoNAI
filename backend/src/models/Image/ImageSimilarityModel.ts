import { db } from '../../database/init';
import { ImageRecord } from '../../types/image';
import {
  SimilarImage,
  DuplicateGroup,
  SimilaritySearchOptions,
  DuplicateSearchOptions,
  SIMILARITY_THRESHOLDS
} from '../../types/similarity';
import { ImageSimilarityService } from '../../services/imageSimilarity';

/**
 * 이미지 유사도 검색 모델
 */
export class ImageSimilarityModel {
  /**
   * 이미지 해시 업데이트
   */
  static async updateHash(
    imageId: number,
    perceptualHash: string,
    colorHistogram: string
  ): Promise<boolean> {
    const info = db.prepare(`
      UPDATE images
      SET perceptual_hash = ?, color_histogram = ?
      WHERE id = ?
    `).run(perceptualHash, colorHistogram, imageId);

    return info.changes > 0;
  }

  /**
   * 특정 이미지의 중복 검색
   */
  static async findDuplicates(
    imageId: number,
    options: DuplicateSearchOptions = {}
  ): Promise<SimilarImage[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      includeMetadata = true
    } = options;

    // 대상 이미지 조회
    const targetImage = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as ImageRecord | undefined;
    if (!targetImage || !targetImage.perceptual_hash) {
      return [];
    }

    // 모든 이미지 조회 (자신 제외)
    let query = 'SELECT * FROM images WHERE id != ? AND perceptual_hash IS NOT NULL';
    const params: any[] = [imageId];

    // 메타데이터 기반 필터링 (성능 최적화)
    if (includeMetadata && targetImage.width && targetImage.height) {
      // 크기가 ±10% 범위 내인 것만
      const widthMin = targetImage.width * 0.9;
      const widthMax = targetImage.width * 1.1;
      const heightMin = targetImage.height * 0.9;
      const heightMax = targetImage.height * 1.1;

      query += ' AND width BETWEEN ? AND ? AND height BETWEEN ? AND ?';
      params.push(widthMin, widthMax, heightMin, heightMax);
    }

    const candidates = db.prepare(query).all(...params) as ImageRecord[];

    // Hamming distance 계산 및 필터링
    const results: SimilarImage[] = [];
    for (const candidate of candidates) {
      if (!candidate.perceptual_hash) continue;

      const hammingDistance = ImageSimilarityService.calculateHammingDistance(
        targetImage.perceptual_hash,
        candidate.perceptual_hash
      );

      if (hammingDistance <= threshold) {
        const similarity = ImageSimilarityService.hammingDistanceToSimilarity(hammingDistance);
        const matchType = ImageSimilarityService.determineMatchType(hammingDistance);

        results.push({
          image: candidate,
          similarity,
          hammingDistance,
          matchType
        });
      }
    }

    // 유사도 순으로 정렬
    return results.sort((a, b) => a.hammingDistance - b.hammingDistance);
  }

  /**
   * 유사 이미지 검색
   */
  static async findSimilar(
    imageId: number,
    options: SimilaritySearchOptions = {}
  ): Promise<SimilarImage[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.SIMILAR,
      limit = 20,
      includeColorSimilarity = false,
      sortBy = 'similarity',
      sortOrder = 'DESC'
    } = options;

    // 대상 이미지 조회
    const targetImage = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as ImageRecord | undefined;
    if (!targetImage || !targetImage.perceptual_hash) {
      return [];
    }

    // 모든 이미지 조회 (자신 제외)
    const candidates = db.prepare(
      'SELECT * FROM images WHERE id != ? AND perceptual_hash IS NOT NULL'
    ).all(imageId) as ImageRecord[];

    // Hamming distance 계산 및 필터링
    const results: SimilarImage[] = [];
    for (const candidate of candidates) {
      if (!candidate.perceptual_hash) continue;

      const hammingDistance = ImageSimilarityService.calculateHammingDistance(
        targetImage.perceptual_hash,
        candidate.perceptual_hash
      );

      if (hammingDistance <= threshold) {
        const similarity = ImageSimilarityService.hammingDistanceToSimilarity(hammingDistance);
        const matchType = ImageSimilarityService.determineMatchType(hammingDistance);

        const similarImage: SimilarImage = {
          image: candidate,
          similarity,
          hammingDistance,
          matchType
        };

        // 색상 유사도 계산 (옵션)
        if (includeColorSimilarity && targetImage.color_histogram && candidate.color_histogram) {
          try {
            const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram);
            const candidateHist = ImageSimilarityService.deserializeHistogram(candidate.color_histogram);
            similarImage.colorSimilarity = ImageSimilarityService.calculateColorSimilarity(
              targetHist,
              candidateHist
            );
          } catch (error) {
            console.warn('Failed to calculate color similarity:', error);
          }
        }

        results.push(similarImage);
      }
    }

    // 정렬
    results.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'similarity') {
        comparison = a.hammingDistance - b.hammingDistance; // 낮을수록 유사
      } else if (sortBy === 'upload_date') {
        comparison = new Date(a.image.upload_date).getTime() - new Date(b.image.upload_date).getTime();
      } else if (sortBy === 'file_size') {
        comparison = a.image.file_size - b.image.file_size;
      }

      return sortOrder === 'ASC' ? comparison : -comparison;
    });

    // 제한 개수만큼 반환
    return results.slice(0, limit);
  }

  /**
   * 전체 중복 이미지 그룹 검색
   */
  static async findAllDuplicateGroups(
    options: DuplicateSearchOptions = {}
  ): Promise<DuplicateGroup[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      minGroupSize = 2
    } = options;

    // 모든 이미지 조회
    const allImages = db.prepare(
      'SELECT * FROM images WHERE perceptual_hash IS NOT NULL ORDER BY id'
    ).all() as ImageRecord[];

    if (allImages.length === 0) {
      return [];
    }

    // 중복 그룹 찾기
    const processedIds = new Set<number>();
    const groups: DuplicateGroup[] = [];

    for (let i = 0; i < allImages.length; i++) {
      const currentImage = allImages[i];

      // 이미 처리된 이미지는 건너뜀
      if (processedIds.has(currentImage.id)) {
        continue;
      }

      const group: ImageRecord[] = [currentImage];
      processedIds.add(currentImage.id);

      // 나머지 이미지와 비교
      for (let j = i + 1; j < allImages.length; j++) {
        const compareImage = allImages[j];

        if (processedIds.has(compareImage.id)) {
          continue;
        }

        if (!currentImage.perceptual_hash || !compareImage.perceptual_hash) {
          continue;
        }

        const hammingDistance = ImageSimilarityService.calculateHammingDistance(
          currentImage.perceptual_hash,
          compareImage.perceptual_hash
        );

        if (hammingDistance <= threshold) {
          group.push(compareImage);
          processedIds.add(compareImage.id);
        }
      }

      // 최소 그룹 크기 이상인 경우만 추가
      if (group.length >= minGroupSize) {
        const avgSimilarity = group.reduce((sum, img, idx) => {
          if (idx === 0) return sum;
          if (!currentImage.perceptual_hash || !img.perceptual_hash) return sum;

          const distance = ImageSimilarityService.calculateHammingDistance(
            currentImage.perceptual_hash,
            img.perceptual_hash
          );
          return sum + ImageSimilarityService.hammingDistanceToSimilarity(distance);
        }, 0) / (group.length - 1 || 1);

        groups.push({
          groupId: `group_${currentImage.id}`,
          images: group,
          similarity: Math.round(avgSimilarity * 100) / 100,
          matchType: ImageSimilarityService.determineMatchType(threshold)
        });
      }
    }

    // 유사도 순으로 정렬
    return groups.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 색상 기반 유사 이미지 검색
   */
  static async findSimilarByColor(
    imageId: number,
    threshold: number = SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100,
    limit: number = 20
  ): Promise<SimilarImage[]> {
    // 대상 이미지 조회
    const targetImage = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as ImageRecord | undefined;
    if (!targetImage || !targetImage.color_histogram) {
      return [];
    }

    const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram);

    // 모든 이미지 조회 (자신 제외)
    const candidates = db.prepare(
      'SELECT * FROM images WHERE id != ? AND color_histogram IS NOT NULL'
    ).all(imageId) as ImageRecord[];

    const results: SimilarImage[] = [];

    for (const candidate of candidates) {
      if (!candidate.color_histogram) continue;

      try {
        const candidateHist = ImageSimilarityService.deserializeHistogram(candidate.color_histogram);
        const colorSimilarity = ImageSimilarityService.calculateColorSimilarity(targetHist, candidateHist);

        if (colorSimilarity >= threshold) {
          // pHash도 있으면 계산
          let hammingDistance = 64; // 최대값으로 초기화
          if (targetImage.perceptual_hash && candidate.perceptual_hash) {
            hammingDistance = ImageSimilarityService.calculateHammingDistance(
              targetImage.perceptual_hash,
              candidate.perceptual_hash
            );
          }

          results.push({
            image: candidate,
            similarity: colorSimilarity,
            hammingDistance,
            matchType: 'color-similar',
            colorSimilarity
          });
        }
      } catch (error) {
        console.warn('Failed to process color histogram:', error);
      }
    }

    // 색상 유사도 순으로 정렬
    results.sort((a, b) => (b.colorSimilarity || 0) - (a.colorSimilarity || 0));

    return results.slice(0, limit);
  }

  /**
   * 해시가 없는 이미지 개수 조회
   */
  static async countImagesWithoutHash(): Promise<number> {
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM images WHERE perceptual_hash IS NULL'
    ).get() as { count: number };

    return result.count;
  }

  /**
   * 해시가 없는 이미지 목록 조회 (배치 처리용)
   */
  static async getImagesWithoutHash(limit: number = 100): Promise<ImageRecord[]> {
    return db.prepare(
      'SELECT * FROM images WHERE perceptual_hash IS NULL LIMIT ?'
    ).all(limit) as ImageRecord[];
  }
}
