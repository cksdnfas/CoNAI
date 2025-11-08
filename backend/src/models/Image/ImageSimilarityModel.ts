import { db } from '../../database/init';
import { ImageRecord, ImageMetadataRecord } from '../../types/image';
import {
  SimilarImage,
  DuplicateGroup,
  SimilaritySearchOptions,
  DuplicateSearchOptions,
  SimilarityMatchType,
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
      UPDATE media_metadata
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
    const targetImage = db.prepare('SELECT * FROM media_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.perceptual_hash) {
      throw new Error('Perceptual hash not available for this image. Please rebuild similarity hashes.');
    }

    // 모든 이미지 조회 (자신 제외) - image_files와 JOIN하여 파일 경로 포함
    let query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash != ? AND im.perceptual_hash IS NOT NULL
    `;
    const params: any[] = [compositeHash];

    // 메타데이터 기반 필터링 (성능 최적화)
    if (includeMetadata && targetImage.width && targetImage.height) {
      // 크기가 ±10% 범위 내인 것만
      const widthMin = targetImage.width * 0.9;
      const widthMax = targetImage.width * 1.1;
      const heightMin = targetImage.height * 0.9;
      const heightMax = targetImage.height * 1.1;

      query += ' AND im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?';
      params.push(widthMin, widthMax, heightMin, heightMax);
    }

    const candidates = db.prepare(query).all(...params) as any[];

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
    const targetImage = db.prepare('SELECT * FROM media_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.perceptual_hash) {
      throw new Error('Perceptual hash not available for this image. Please rebuild similarity hashes.');
    }

    // 모든 이미지 조회 (자신 제외) - image_files와 JOIN하여 파일 경로 포함
    const candidates = db.prepare(`
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash != ? AND im.perceptual_hash IS NOT NULL
    `).all(compositeHash) as any[];

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
        // file_size는 media_metadata에 없으므로 스킵
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
   *
   * 처리 과정:
   * 1. media_metadata에서 유사 이미지 그룹 찾기 (Hamming distance 기반)
   * 2. 각 그룹의 composite_hash로 image_files 테이블에서 실제 중복 파일 조회
   * 3. 유사 이미지 + 중복 파일을 모두 포함한 그룹 반환
   */
  static async findAllDuplicateGroups(
    options: DuplicateSearchOptions = {}
  ): Promise<DuplicateGroup[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      minGroupSize = 2
    } = options;

    // STEP 1: media_metadata에서 고유한 이미지 메타데이터만 조회 (중복 제거된 상태)
    const allMetadata = db.prepare(`
      SELECT *
      FROM media_metadata
      WHERE perceptual_hash IS NOT NULL
      ORDER BY composite_hash
    `).all() as ImageMetadataRecord[];

    if (allMetadata.length === 0) {
      return [];
    }

    // STEP 2: 유사 이미지 그룹 찾기 (Hamming distance 기반)
    const processedHashes = new Set<string>();
    const metadataGroups: ImageMetadataRecord[][] = [];

    for (let i = 0; i < allMetadata.length; i++) {
      const currentMetadata = allMetadata[i];

      // 이미 처리된 메타데이터는 건너뜀
      if (processedHashes.has(currentMetadata.composite_hash)) {
        continue;
      }

      const group: ImageMetadataRecord[] = [currentMetadata];
      processedHashes.add(currentMetadata.composite_hash);

      // 나머지 메타데이터와 비교하여 유사 이미지 찾기
      for (let j = i + 1; j < allMetadata.length; j++) {
        const compareMetadata = allMetadata[j];

        if (processedHashes.has(compareMetadata.composite_hash)) {
          continue;
        }

        if (!currentMetadata.perceptual_hash || !compareMetadata.perceptual_hash) {
          continue;
        }

        const hammingDistance = ImageSimilarityService.calculateHammingDistance(
          currentMetadata.perceptual_hash,
          compareMetadata.perceptual_hash
        );

        if (hammingDistance <= threshold) {
          group.push(compareMetadata);
          processedHashes.add(compareMetadata.composite_hash);
        }
      }

      // 그룹에 포함된 메타데이터가 있으면 저장
      if (group.length > 0) {
        metadataGroups.push(group);
      }
    }

    // STEP 3: 각 메타데이터 그룹의 composite_hash로 image_files에서 실제 파일들 조회
    const groups: DuplicateGroup[] = [];

    for (const metadataGroup of metadataGroups) {
      // 그룹의 모든 composite_hash 추출
      const compositeHashes = metadataGroup.map(m => m.composite_hash);

      // image_files에서 해당 composite_hash를 가진 모든 파일 조회
      const placeholders = compositeHashes.map(() => '?').join(',');
      const fileRecords = db.prepare(`
        SELECT
          im.*,
          if.id as file_id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status
        FROM image_files if
        JOIN media_metadata im ON if.composite_hash = im.composite_hash
        WHERE if.composite_hash IN (${placeholders})
          AND if.file_status = 'active'
        ORDER BY if.composite_hash, if.id
      `).all(...compositeHashes) as any[];

      // 최소 그룹 크기 체크 (유사 이미지 개수 OR 실제 파일 개수)
      // 예: 유사 이미지는 1개지만 중복 파일이 3개인 경우도 그룹으로 포함
      const totalFileCount = fileRecords.length;
      const uniqueMetadataCount = metadataGroup.length;

      if (totalFileCount >= minGroupSize || uniqueMetadataCount >= minGroupSize) {
        const firstMetadata = metadataGroup[0];
        let avgSimilarity: number;
        let matchType: SimilarityMatchType;

        // 중복 파일만 있는 경우 (같은 composite_hash의 파일들)
        if (uniqueMetadataCount === 1 && totalFileCount >= 2) {
          // 완전히 동일한 파일들이므로 100% 유사
          avgSimilarity = 100; // 0-100 범위의 100
          matchType = 'exact' as SimilarityMatchType;
        } else {
          // 유사 이미지가 있는 경우 평균 유사도 계산
          avgSimilarity = metadataGroup.reduce((sum, metadata, idx) => {
            if (idx === 0) return sum;
            if (!firstMetadata.perceptual_hash || !metadata.perceptual_hash) return sum;

            const distance = ImageSimilarityService.calculateHammingDistance(
              firstMetadata.perceptual_hash,
              metadata.perceptual_hash
            );
            return sum + ImageSimilarityService.hammingDistanceToSimilarity(distance);
          }, 0) / (metadataGroup.length - 1 || 1);

          matchType = ImageSimilarityService.determineMatchType(threshold);
        }

        groups.push({
          groupId: `group_${firstMetadata.composite_hash.substring(0, 16)}`,
          images: fileRecords, // 실제 파일 레코드 (중복 포함)
          similarity: Math.round(avgSimilarity * 100) / 100,
          matchType
        });
      }
    }

    // 유사도 순으로 정렬 (유사도가 같으면 파일 개수가 많은 순)
    return groups.sort((a, b) => {
      const simDiff = b.similarity - a.similarity;
      if (simDiff !== 0) return simDiff;
      return b.images.length - a.images.length;
    });
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
    const targetImage = db.prepare('SELECT * FROM media_metadata WHERE composite_hash = ?').get(compositeHash) as ImageMetadataRecord | undefined;
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }
    if (!targetImage.color_histogram) {
      throw new Error('Color histogram not available for this image. Please rebuild similarity hashes.');
    }

    const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram);

    // 모든 이미지 조회 (자신 제외) - image_files와 JOIN하여 파일 경로 포함
    const candidates = db.prepare(`
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash != ? AND im.color_histogram IS NOT NULL
    `).all(compositeHash) as any[];

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
      'SELECT COUNT(*) as count FROM media_metadata WHERE perceptual_hash IS NULL'
    ).get() as { count: number };

    return result.count;
  }

  /**
   * 해시가 없는 이미지 목록 조회 (배치 처리용, composite_hash 기반)
   */
  static async getImagesWithoutHash(limit: number = 100): Promise<ImageMetadataRecord[]> {
    return db.prepare(
      'SELECT * FROM media_metadata WHERE perceptual_hash IS NULL LIMIT ?'
    ).all(limit) as ImageMetadataRecord[];
  }

  /**
   * 해시가 없는 이미지 개수 조회 (레거시: images 테이블)
   * @deprecated 새 코드에서는 media_metadata 버전 사용
   */
  static async countImagesWithoutHashLegacy(): Promise<number> {
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM images WHERE perceptual_hash IS NULL'
    ).get() as { count: number };

    return result.count;
  }

  /**
   * 해시가 없는 이미지 목록 조회 (레거시: images 테이블)
   * @deprecated 새 코드에서는 media_metadata 버전 사용
   */
  static async getImagesWithoutHashLegacy(limit: number = 100): Promise<ImageRecord[]> {
    return db.prepare(
      'SELECT * FROM images WHERE perceptual_hash IS NULL LIMIT ?'
    ).all(limit) as ImageRecord[];
  }
}
