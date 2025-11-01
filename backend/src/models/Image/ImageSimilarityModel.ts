import { db } from '../../database/init';
import { ImageRecord, ImageMetadataRecord } from '../../types/image';
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
 *
 * 새 구조: composite_hash 기반 메서드 (권장)
 * 레거시: imageId 기반 메서드 (하위 호환성 유지)
 */
export class ImageSimilarityModel {
  /**
   * 이미지 해시 업데이트 (composite_hash 기반)
   */
  static async updateHash(
    compositeHash: string,
    perceptualHash: string,
    colorHistogram: string
  ): Promise<boolean> {
    const info = db.prepare(`
      UPDATE image_metadata
      SET perceptual_hash = ?, color_histogram = ?, metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(perceptualHash, colorHistogram, compositeHash);

    return info.changes > 0;
  }

  /**
   * 이미지 해시 업데이트 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async updateHashByImageId(
    imageId: number,
    perceptualHash: string,
    colorHistogram: string
  ): Promise<boolean> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      console.warn(`Could not find composite_hash for image ID ${imageId}`);
      return false;
    }

    return await this.updateHash(file.composite_hash, perceptualHash, colorHistogram);
  }

  /**
   * 특정 이미지의 중복 검색 (composite_hash 기반)
   */
  static async findDuplicates(
    compositeHash: string,
    options: DuplicateSearchOptions = {}
  ): Promise<SimilarImage[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      includeMetadata = true
    } = options;

    // 대상 이미지 조회
    const targetImage = db.prepare('SELECT * FROM image_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.perceptual_hash) {
      throw new Error('Perceptual hash not available for this image. Please rebuild similarity hashes.');
    }

    // 모든 이미지 조회 (자신 제외)
    let query = 'SELECT * FROM image_metadata WHERE composite_hash != ? AND perceptual_hash IS NOT NULL';
    const params: any[] = [compositeHash];

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

    const candidates = db.prepare(query).all(...params) as ImageMetadataRecord[];

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
          image: candidate as any, // ImageMetadataRecord를 ImageRecord처럼 사용 (호환성)
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
   * 특정 이미지의 중복 검색 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async findDuplicatesByImageId(
    imageId: number,
    options: DuplicateSearchOptions = {}
  ): Promise<SimilarImage[]> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      console.warn(`Could not find composite_hash for image ID ${imageId}`);
      return [];
    }

    return await this.findDuplicates(file.composite_hash, options);
  }

  /**
   * 유사 이미지 검색 (composite_hash 기반)
   */
  static async findSimilar(
    compositeHash: string,
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
    const targetImage = db.prepare('SELECT * FROM image_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.perceptual_hash) {
      throw new Error('Perceptual hash not available for this image. Please rebuild similarity hashes.');
    }

    // 모든 이미지 조회 (자신 제외)
    const candidates = db.prepare(
      'SELECT * FROM image_metadata WHERE composite_hash != ? AND perceptual_hash IS NOT NULL'
    ).all(compositeHash) as ImageMetadataRecord[];

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
          image: candidate as any, // ImageMetadataRecord를 ImageRecord처럼 사용
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
        const aDate = (a.image as any).first_seen_date || (a.image as any).upload_date;
        const bDate = (b.image as any).first_seen_date || (b.image as any).upload_date;
        comparison = new Date(aDate).getTime() - new Date(bDate).getTime();
      } else if (sortBy === 'file_size') {
        // file_size는 image_metadata에 없으므로 스킵
        comparison = 0;
      }

      return sortOrder === 'ASC' ? comparison : -comparison;
    });

    // 제한 개수만큼 반환
    return results.slice(0, limit);
  }

  /**
   * 유사 이미지 검색 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async findSimilarByImageId(
    imageId: number,
    options: SimilaritySearchOptions = {}
  ): Promise<SimilarImage[]> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      console.warn(`Could not find composite_hash for image ID ${imageId}`);
      return [];
    }

    return await this.findSimilar(file.composite_hash, options);
  }

  /**
   * 전체 중복 이미지 그룹 검색 (composite_hash 기반)
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
      'SELECT * FROM image_metadata WHERE perceptual_hash IS NOT NULL ORDER BY composite_hash'
    ).all() as ImageMetadataRecord[];

    if (allImages.length === 0) {
      return [];
    }

    // 중복 그룹 찾기
    const processedHashes = new Set<string>();
    const groups: DuplicateGroup[] = [];

    for (let i = 0; i < allImages.length; i++) {
      const currentImage = allImages[i];

      // 이미 처리된 이미지는 건너뜀
      if (processedHashes.has(currentImage.composite_hash)) {
        continue;
      }

      const group: ImageMetadataRecord[] = [currentImage];
      processedHashes.add(currentImage.composite_hash);

      // 나머지 이미지와 비교
      for (let j = i + 1; j < allImages.length; j++) {
        const compareImage = allImages[j];

        if (processedHashes.has(compareImage.composite_hash)) {
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
          processedHashes.add(compareImage.composite_hash);
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
          groupId: `group_${currentImage.composite_hash.substring(0, 16)}`,
          images: group as any, // ImageMetadataRecord[]를 ImageRecord[]처럼 사용
          similarity: Math.round(avgSimilarity * 100) / 100,
          matchType: ImageSimilarityService.determineMatchType(threshold)
        });
      }
    }

    // 유사도 순으로 정렬
    return groups.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 색상 기반 유사 이미지 검색 (composite_hash 기반)
   */
  static async findSimilarByColor(
    compositeHash: string,
    threshold: number = SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100,
    limit: number = 20
  ): Promise<SimilarImage[]> {
    // 대상 이미지 조회
    const targetImage = db.prepare('SELECT * FROM image_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.color_histogram) {
      throw new Error('Color histogram not available for this image. Please rebuild similarity hashes.');
    }

    const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram);

    // 모든 이미지 조회 (자신 제외)
    const candidates = db.prepare(
      'SELECT * FROM image_metadata WHERE composite_hash != ? AND color_histogram IS NOT NULL'
    ).all(compositeHash) as ImageMetadataRecord[];

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
            image: candidate as any,
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
   * 색상 기반 유사 이미지 검색 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async findSimilarByColorByImageId(
    imageId: number,
    threshold: number = SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100,
    limit: number = 20
  ): Promise<SimilarImage[]> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      console.warn(`Could not find composite_hash for image ID ${imageId}`);
      return [];
    }

    return await this.findSimilarByColor(file.composite_hash, threshold, limit);
  }

  /**
   * 해시가 없는 이미지 개수 조회 (composite_hash 기반)
   */
  static async countImagesWithoutHash(): Promise<number> {
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM image_metadata WHERE perceptual_hash IS NULL'
    ).get() as { count: number };

    return result.count;
  }

  /**
   * 해시가 없는 이미지 목록 조회 (배치 처리용, composite_hash 기반)
   */
  static async getImagesWithoutHash(limit: number = 100): Promise<ImageMetadataRecord[]> {
    return db.prepare(
      'SELECT * FROM image_metadata WHERE perceptual_hash IS NULL LIMIT ?'
    ).all(limit) as ImageMetadataRecord[];
  }

  /**
   * 해시가 없는 이미지 개수 조회 (레거시: images 테이블)
   * @deprecated 새 코드에서는 image_metadata 버전 사용
   */
  static async countImagesWithoutHashLegacy(): Promise<number> {
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM images WHERE perceptual_hash IS NULL'
    ).get() as { count: number };

    return result.count;
  }

  /**
   * 해시가 없는 이미지 목록 조회 (레거시: images 테이블)
   * @deprecated 새 코드에서는 image_metadata 버전 사용
   */
  static async getImagesWithoutHashLegacy(limit: number = 100): Promise<ImageRecord[]> {
    return db.prepare(
      'SELECT * FROM images WHERE perceptual_hash IS NULL LIMIT ?'
    ).all(limit) as ImageRecord[];
  }
}
