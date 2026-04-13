import { db } from '../../database/init';
import { ImageRecord, ImageMetadataRecord } from '../../types/image';
import {
  SimilarImage,
  DuplicateGroup,
  SimilaritySearchOptions,
  DuplicateSearchOptions,
  SimilarityMatchType,
  SimilarityComponentScores,
  SIMILARITY_THRESHOLDS
} from '../../types/similarity';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { ImageSafetyService } from '../../services/imageSafetyService';

type SimilarityWeights = {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
};

type SimilarityThresholds = {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
};

type SimilarityCandidateRecord = ImageMetadataRecord & {
  file_id?: number;
  original_file_path?: string;
  file_size?: number;
  mime_type?: string;
  file_status?: string;
};

/**
 * 이미지 유사도 검색 모델
 *
 * 새 구조: composite_hash 기반 메서드 (권장)
 * 레거시: imageId 기반 메서드 (하위 호환성 유지)
 */
export class ImageSimilarityModel {
  /** Load composite_hash once for legacy imageId entry points. */
  private static findCompositeHashByImageId(imageId: number) {
    return db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;
  }

  /** Load media metadata by composite_hash for similarity workflows. */
  private static loadImageMetadata(compositeHash: string) {
    return db.prepare(
      'SELECT * FROM media_metadata WHERE composite_hash = ?'
    ).get(compositeHash) as ImageMetadataRecord | undefined;
  }

  /** Require a valid media_metadata row before continuing. */
  private static requireImageMetadata(compositeHash: string): ImageMetadataRecord {
    const targetImage = this.loadImageMetadata(compositeHash);
    if (!targetImage) {
      throw new Error('Image not found with the provided composite hash');
    }

    if (ImageSafetyService.isHidden(targetImage.rating_score)) {
      throw new Error('This image is hidden by the current safety policy');
    }

    return targetImage;
  }

  /** Require perceptual_hash for hash-based duplicate and similarity searches. */
  private static requirePerceptualHashImage(compositeHash: string): ImageMetadataRecord {
    const targetImage = this.requireImageMetadata(compositeHash);
    if (!targetImage.perceptual_hash) {
      throw new Error('Perceptual hash not available for this image. Please rebuild similarity hashes.');
    }

    return targetImage;
  }

  /** Require color_histogram for color-based similarity searches. */
  private static requireColorHistogramImage(compositeHash: string): ImageMetadataRecord {
    const targetImage = this.requireImageMetadata(compositeHash);
    if (!targetImage.color_histogram) {
      throw new Error('Color histogram not available for this image. Please rebuild similarity hashes.');
    }

    return targetImage;
  }

  /** Build the shared +/-10% width and height filter when metadata is present. */
  private static getMetadataBounds(targetImage: ImageMetadataRecord) {
    if (!targetImage.width || !targetImage.height) {
      return null;
    }

    return {
      widthMin: targetImage.width * 0.9,
      widthMax: targetImage.width * 1.1,
      heightMin: targetImage.height * 0.9,
      heightMax: targetImage.height * 1.1,
    };
  }

  /**
   * 이미지 해시 업데이트 (composite_hash 기반)
   */
  static async updateHash(
    compositeHash: string,
    perceptualHash: string,
    dHash: string,
    aHash: string,
    colorHistogram: string
  ): Promise<boolean> {
    const info = db.prepare(`
      UPDATE media_metadata
      SET perceptual_hash = ?, dhash = ?, ahash = ?, color_histogram = ?, metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(perceptualHash, dHash, aHash, colorHistogram, compositeHash);

    return info.changes > 0;
  }

  /**
   * 이미지 해시 업데이트 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async updateHashByImageId(
    imageId: number,
    perceptualHash: string,
    dHash: string,
    aHash: string,
    colorHistogram: string
  ): Promise<boolean> {
    const file = this.findCompositeHashByImageId(imageId);

    if (!file) {
      console.warn(`Could not find composite_hash for image ID ${imageId}`);
      return false;
    }

    return await this.updateHash(file.composite_hash, perceptualHash, dHash, aHash, colorHistogram);
  }

  /** Normalize search weights without widening the public options contract. */
  private static getSimilarityWeights(options: SimilaritySearchOptions): SimilarityWeights {
    return {
      perceptualHash: Math.max(0, options.weights?.perceptualHash ?? 50),
      dHash: Math.max(0, options.weights?.dHash ?? 30),
      aHash: Math.max(0, options.weights?.aHash ?? 20),
      color: Math.max(0, options.weights?.color ?? (options.includeColorSimilarity ? 15 : 0)),
    };
  }

  /** Normalize search thresholds while preserving legacy defaults. */
  private static getSimilarityThresholds(options: SimilaritySearchOptions): SimilarityThresholds {
    const legacyThreshold = options.threshold ?? SIMILARITY_THRESHOLDS.SIMILAR;
    return {
      perceptualHash: Math.max(0, Math.min(64, options.thresholds?.perceptualHash ?? legacyThreshold)),
      dHash: Math.max(0, Math.min(64, options.thresholds?.dHash ?? Math.min(64, legacyThreshold + 3))),
      aHash: Math.max(0, Math.min(64, options.thresholds?.aHash ?? Math.min(64, legacyThreshold + 5))),
      color: Math.max(0, Math.min(100, options.thresholds?.color ?? 0)),
    };
  }

  /** Normalize duplicate-search weights for multi-hash duplicate confirmation. */
  private static getDuplicateWeights(options: DuplicateSearchOptions): SimilarityWeights {
    return {
      perceptualHash: Math.max(0, options.weights?.perceptualHash ?? 40),
      dHash: Math.max(0, options.weights?.dHash ?? 35),
      aHash: Math.max(0, options.weights?.aHash ?? 25),
      color: 0,
    };
  }

  /** Normalize duplicate-search thresholds while keeping dHash/aHash slightly looser than pHash. */
  private static getDuplicateThresholds(options: DuplicateSearchOptions): SimilarityThresholds {
    const legacyThreshold = options.threshold ?? SIMILARITY_THRESHOLDS.NEAR_DUPLICATE;
    return {
      perceptualHash: Math.max(0, Math.min(64, options.thresholds?.perceptualHash ?? legacyThreshold)),
      dHash: Math.max(0, Math.min(64, options.thresholds?.dHash ?? Math.min(64, legacyThreshold + 1))),
      aHash: Math.max(0, Math.min(64, options.thresholds?.aHash ?? Math.min(64, legacyThreshold + 2))),
      color: 0,
    };
  }

  /** Build the duplicate-search candidate query with the existing metadata filter. */
  private static buildDuplicateCandidateQuery(targetImage: ImageMetadataRecord, includeMetadata: boolean) {
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
      WHERE im.composite_hash != ?
        AND im.perceptual_hash IS NOT NULL
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
    `;
    const params: any[] = [targetImage.composite_hash];
    const metadataBounds = includeMetadata ? this.getMetadataBounds(targetImage) : null;

    if (metadataBounds) {
      query += ' AND im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?';
      params.push(
        metadataBounds.widthMin,
        metadataBounds.widthMax,
        metadataBounds.heightMin,
        metadataBounds.heightMax,
      );
    }

    return { query, params };
  }

  /** Build the hybrid similarity candidate query with the existing metadata filter. */
  private static buildSimilarCandidateQuery(targetImage: ImageMetadataRecord, useMetadataFilter: boolean) {
    let query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      WHERE im.composite_hash != ?
        AND im.perceptual_hash IS NOT NULL
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
    `;
    const params: any[] = [targetImage.composite_hash];
    const metadataBounds = useMetadataFilter ? this.getMetadataBounds(targetImage) : null;

    if (metadataBounds) {
      query += ' AND im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?';
      params.push(
        metadataBounds.widthMin,
        metadataBounds.widthMax,
        metadataBounds.heightMin,
        metadataBounds.heightMax,
      );
    }

    return { query, params };
  }

  /** Build the color-search candidate query without changing existing joins. */
  private static buildColorCandidateQuery(compositeHash: string) {
    return {
      query: `
        SELECT
          im.*,
          if.id as file_id,
          if.original_file_path,
          if.file_size,
          if.mime_type,
          if.file_status
        FROM media_metadata im
        LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
        WHERE im.composite_hash != ?
          AND im.color_histogram IS NOT NULL
          AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
      `,
      params: [compositeHash],
    };
  }

  /** Build the initial per-component score state for one candidate. */
  private static buildSimilarityComponentScores(
    targetImage: ImageMetadataRecord,
    candidate: SimilarityCandidateRecord,
    weights: SimilarityWeights,
    thresholds: SimilarityThresholds,
    targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram> | null,
  ): SimilarityComponentScores {
    return {
      perceptualHash: {
        available: Boolean(targetImage.perceptual_hash && candidate.perceptual_hash),
        used: false,
        weight: weights.perceptualHash,
        threshold: thresholds.perceptualHash,
        passed: true,
      },
      dHash: {
        available: Boolean(targetImage.dhash && candidate.dhash),
        used: false,
        weight: weights.dHash,
        threshold: thresholds.dHash,
        passed: true,
      },
      aHash: {
        available: Boolean(targetImage.ahash && candidate.ahash),
        used: false,
        weight: weights.aHash,
        threshold: thresholds.aHash,
        passed: true,
      },
      color: {
        available: Boolean(targetHistogram && candidate.color_histogram),
        used: false,
        weight: weights.color,
        threshold: thresholds.color,
        passed: true,
      },
    };
  }

  /** Score one hash component and report whether the candidate should be filtered out. */
  private static scoreHashComponent(
    componentScore: SimilarityComponentScores['perceptualHash'],
    targetHash: string | null | undefined,
    candidateHash: string | null | undefined,
    weight: number,
    threshold: number,
  ) {
    if (!targetHash || !candidateHash) {
      return {
        componentScore: {
          ...componentScore,
          passed: false,
        },
        shouldSkip: false,
        distance: undefined as number | undefined,
        weightedScore: 0,
        activeWeight: 0,
      };
    }

    const distance = ImageSimilarityService.calculateHammingDistance(targetHash, candidateHash);
    const similarity = ImageSimilarityService.hammingDistanceToSimilarity(distance);
    const nextComponentScore = {
      ...componentScore,
      used: weight > 0,
      passed: distance <= threshold,
      distance,
      similarity,
    };

    if (weight <= 0) {
      return {
        componentScore: nextComponentScore,
        shouldSkip: false,
        distance,
        weightedScore: 0,
        activeWeight: 0,
      };
    }

    if (distance > threshold) {
      return {
        componentScore: nextComponentScore,
        shouldSkip: true,
        distance,
        weightedScore: 0,
        activeWeight: 0,
      };
    }

    return {
      componentScore: nextComponentScore,
      shouldSkip: false,
      distance,
      weightedScore: similarity * weight,
      activeWeight: weight,
    };
  }

  /** Load the target histogram only when the current search actually needs it. */
  private static loadTargetHistogram(
    targetImage: ImageMetadataRecord,
    includeColorSimilarity: boolean,
  ) {
    if (!includeColorSimilarity || !targetImage.color_histogram) {
      return null;
    }

    try {
      return ImageSimilarityService.deserializeHistogram(targetImage.color_histogram);
    } catch (error) {
      console.warn('Failed to deserialize target color histogram:', error);
      return null;
    }
  }

  /** Build one duplicate-search result using pHash, dHash, and aHash together. */
  private static buildDuplicateMatch(
    targetImage: ImageMetadataRecord,
    candidate: SimilarityCandidateRecord,
    weights: SimilarityWeights,
    thresholds: SimilarityThresholds,
  ): SimilarImage | null {
    if (!candidate.perceptual_hash) {
      return null;
    }

    const componentScores = this.buildSimilarityComponentScores(targetImage, candidate, weights, thresholds, null);
    let weightedScoreSum = 0;
    let activeWeightSum = 0;
    const distanceSamples: number[] = [];

    const perceptualScore = this.scoreHashComponent(
      componentScores.perceptualHash,
      targetImage.perceptual_hash,
      candidate.perceptual_hash,
      weights.perceptualHash,
      thresholds.perceptualHash,
    );
    componentScores.perceptualHash = perceptualScore.componentScore;
    if (perceptualScore.shouldSkip) {
      return null;
    }
    if (perceptualScore.distance !== undefined && weights.perceptualHash > 0) {
      distanceSamples.push(perceptualScore.distance);
      weightedScoreSum += perceptualScore.weightedScore;
      activeWeightSum += perceptualScore.activeWeight;
    }

    const dHashScore = this.scoreHashComponent(
      componentScores.dHash,
      targetImage.dhash,
      candidate.dhash,
      weights.dHash,
      thresholds.dHash,
    );
    componentScores.dHash = dHashScore.componentScore;
    if (dHashScore.shouldSkip) {
      return null;
    }
    if (dHashScore.distance !== undefined && weights.dHash > 0) {
      distanceSamples.push(dHashScore.distance);
      weightedScoreSum += dHashScore.weightedScore;
      activeWeightSum += dHashScore.activeWeight;
    }

    const aHashScore = this.scoreHashComponent(
      componentScores.aHash,
      targetImage.ahash,
      candidate.ahash,
      weights.aHash,
      thresholds.aHash,
    );
    componentScores.aHash = aHashScore.componentScore;
    if (aHashScore.shouldSkip) {
      return null;
    }
    if (aHashScore.distance !== undefined && weights.aHash > 0) {
      distanceSamples.push(aHashScore.distance);
      weightedScoreSum += aHashScore.weightedScore;
      activeWeightSum += aHashScore.activeWeight;
    }

    if (activeWeightSum <= 0 || distanceSamples.length === 0) {
      return null;
    }

    const averageDistance = distanceSamples.reduce((sum, value) => sum + value, 0) / distanceSamples.length;
    const similarity = Math.round((weightedScoreSum / activeWeightSum) * 100) / 100;
    const hammingDistance = Math.round(averageDistance * 100) / 100;
    const matchType: SimilarityMatchType = ImageSimilarityService.determineMatchType(Math.round(averageDistance));

    return {
      image: candidate as any,
      similarity,
      hammingDistance,
      matchType,
      componentScores,
    };
  }

  /** Score one hybrid similarity candidate and keep the public result shape unchanged. */
  private static buildSimilarMatch(
    targetImage: ImageMetadataRecord,
    candidate: SimilarityCandidateRecord,
    weights: SimilarityWeights,
    thresholds: SimilarityThresholds,
    targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram> | null,
  ): SimilarImage | null {
    if (!candidate.perceptual_hash) {
      return null;
    }

    let weightedScoreSum = 0;
    let activeWeightSum = 0;
    const distanceSamples: number[] = [];
    let colorSimilarity: number | undefined;
    const componentScores = this.buildSimilarityComponentScores(targetImage, candidate, weights, thresholds, targetHistogram);

    const perceptualScore = this.scoreHashComponent(
      componentScores.perceptualHash,
      targetImage.perceptual_hash,
      candidate.perceptual_hash,
      weights.perceptualHash,
      thresholds.perceptualHash,
    );
    componentScores.perceptualHash = perceptualScore.componentScore;
    if (perceptualScore.shouldSkip) {
      return null;
    }
    if (perceptualScore.distance !== undefined && weights.perceptualHash > 0) {
      distanceSamples.push(perceptualScore.distance);
      weightedScoreSum += perceptualScore.weightedScore;
      activeWeightSum += perceptualScore.activeWeight;
    }

    const dHashScore = this.scoreHashComponent(
      componentScores.dHash,
      targetImage.dhash,
      candidate.dhash,
      weights.dHash,
      thresholds.dHash,
    );
    componentScores.dHash = dHashScore.componentScore;
    if (dHashScore.shouldSkip) {
      return null;
    }
    if (dHashScore.distance !== undefined && weights.dHash > 0) {
      distanceSamples.push(dHashScore.distance);
      weightedScoreSum += dHashScore.weightedScore;
      activeWeightSum += dHashScore.activeWeight;
    }

    const aHashScore = this.scoreHashComponent(
      componentScores.aHash,
      targetImage.ahash,
      candidate.ahash,
      weights.aHash,
      thresholds.aHash,
    );
    componentScores.aHash = aHashScore.componentScore;
    if (aHashScore.shouldSkip) {
      return null;
    }
    if (aHashScore.distance !== undefined && weights.aHash > 0) {
      distanceSamples.push(aHashScore.distance);
      weightedScoreSum += aHashScore.weightedScore;
      activeWeightSum += aHashScore.activeWeight;
    }

    if (targetHistogram && candidate.color_histogram) {
      try {
        const candidateHistogram = ImageSimilarityService.deserializeHistogram(candidate.color_histogram);
        colorSimilarity = ImageSimilarityService.calculateColorSimilarity(targetHistogram, candidateHistogram);
        componentScores.color = {
          ...componentScores.color,
          used: weights.color > 0,
          passed: colorSimilarity >= thresholds.color,
          similarity: colorSimilarity,
        };

        if (weights.color > 0) {
          if (colorSimilarity < thresholds.color) {
            return null;
          }
          weightedScoreSum += colorSimilarity * weights.color;
          activeWeightSum += weights.color;
        }
      } catch (error) {
        componentScores.color.passed = false;
        console.warn('Failed to calculate color similarity:', error);
      }
    }

    if (activeWeightSum <= 0) {
      const fallbackDistance = ImageSimilarityService.calculateHammingDistance(
        targetImage.perceptual_hash!,
        candidate.perceptual_hash,
      );
      if (fallbackDistance > thresholds.perceptualHash) {
        return null;
      }
      distanceSamples.push(fallbackDistance);
      weightedScoreSum = ImageSimilarityService.hammingDistanceToSimilarity(fallbackDistance);
      activeWeightSum = 1;
    }

    const averageDistance = distanceSamples.length > 0
      ? distanceSamples.reduce((sum, value) => sum + value, 0) / distanceSamples.length
      : 64;
    const similarity = Math.round((weightedScoreSum / activeWeightSum) * 100) / 100;
    const hammingDistance = Math.round(averageDistance * 100) / 100;
    const matchType: SimilarityMatchType = distanceSamples.length > 0
      ? ImageSimilarityService.determineMatchType(Math.round(averageDistance))
      : 'color-similar';

    return {
      image: candidate as any,
      similarity,
      hammingDistance,
      matchType,
      ...(colorSimilarity !== undefined ? { colorSimilarity } : {}),
      componentScores,
    };
  }

  /** Sort hybrid similarity results using the existing API contract. */
  private static sortSimilarResults(
    results: SimilarImage[],
    sortBy: NonNullable<SimilaritySearchOptions['sortBy']>,
    sortOrder: NonNullable<SimilaritySearchOptions['sortOrder']>,
  ) {
    results.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'similarity') {
        comparison = a.similarity - b.similarity;
      } else if (sortBy === 'upload_date') {
        const aDate = (a.image as any).first_seen_date || (a.image as any).upload_date;
        const bDate = (b.image as any).first_seen_date || (b.image as any).upload_date;
        comparison = new Date(aDate).getTime() - new Date(bDate).getTime();
      } else if (sortBy === 'file_size') {
        const aSize = Number((a.image as any).file_size || 0);
        const bSize = Number((b.image as any).file_size || 0);
        comparison = aSize - bSize;
      }

      return sortOrder === 'ASC' ? comparison : -comparison;
    });
  }

  /** Build one color-search result while preserving the fallback hamming behavior. */
  private static buildColorSimilarMatch(
    targetImage: ImageMetadataRecord,
    targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram>,
    candidate: SimilarityCandidateRecord,
    threshold: number,
  ): SimilarImage | null {
    if (!candidate.color_histogram) {
      return null;
    }

    try {
      const candidateHistogram = ImageSimilarityService.deserializeHistogram(candidate.color_histogram);
      const colorSimilarity = ImageSimilarityService.calculateColorSimilarity(targetHistogram, candidateHistogram);

      if (colorSimilarity < threshold) {
        return null;
      }

      let hammingDistance = 64;
      if (targetImage.perceptual_hash && candidate.perceptual_hash) {
        hammingDistance = ImageSimilarityService.calculateHammingDistance(
          targetImage.perceptual_hash,
          candidate.perceptual_hash,
        );
      }

      return {
        image: candidate as any,
        similarity: colorSimilarity,
        hammingDistance,
        matchType: 'color-similar',
        colorSimilarity,
      };
    } catch (error) {
      console.warn('Failed to process color histogram:', error);
      return null;
    }
  }

  /**
   * 특정 이미지의 중복 검색 (composite_hash 기반)
   */
  static async findDuplicates(
    compositeHash: string,
    options: DuplicateSearchOptions = {}
  ): Promise<SimilarImage[]> {
    const {
      includeMetadata = true
    } = options;

    const weights = this.getDuplicateWeights(options);
    const thresholds = this.getDuplicateThresholds(options);
    const targetImage = this.requirePerceptualHashImage(compositeHash);
    const { query, params } = this.buildDuplicateCandidateQuery(targetImage, includeMetadata);
    const candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];

    const results = candidates
      .map(candidate => this.buildDuplicateMatch(targetImage, candidate, weights, thresholds))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

    return results.sort((a, b) => {
      const similarityDiff = b.similarity - a.similarity;
      if (similarityDiff !== 0) {
        return similarityDiff;
      }
      return a.hammingDistance - b.hammingDistance;
    });
  }

  /**
   * 특정 이미지의 중복 검색 (레거시: imageId 기반)
   * @deprecated 새 코드에서는 composite_hash 버전 사용 권장
   */
  static async findDuplicatesByImageId(
    imageId: number,
    options: DuplicateSearchOptions = {}
  ): Promise<SimilarImage[]> {
    const file = this.findCompositeHashByImageId(imageId);

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
      limit = 20,
      sortBy = 'similarity',
      sortOrder = 'DESC'
    } = options;

    const weights = this.getSimilarityWeights(options);
    const thresholds = this.getSimilarityThresholds(options);
    const useMetadataFilter = options.useMetadataFilter ?? false;
    const targetImage = this.requirePerceptualHashImage(compositeHash);
    const { query, params } = this.buildSimilarCandidateQuery(targetImage, useMetadataFilter);
    const candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];

    const includeColorSimilarity = Boolean(options.includeColorSimilarity || weights.color > 0 || thresholds.color > 0);
    const targetHistogram = this.loadTargetHistogram(targetImage, includeColorSimilarity);
    const results = candidates
      .map(candidate => this.buildSimilarMatch(targetImage, candidate, weights, thresholds, targetHistogram))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

    this.sortSimilarResults(results, sortBy, sortOrder);
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
    const file = this.findCompositeHashByImageId(imageId);

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
   * 1. image_files에서 실제 존재하는 파일의 composite_hash만 조회
   * 2. 해당 composite_hash의 media_metadata 조회 (고아 데이터 제외)
   * 3. 유사 이미지 그룹 찾기 (Hamming distance 기반)
   * 4. 각 그룹의 composite_hash로 image_files에서 실제 중복 파일 조회
   */
  static async findAllDuplicateGroups(
    options: DuplicateSearchOptions = {}
  ): Promise<DuplicateGroup[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      minGroupSize = 2
    } = options;

    // STEP 1: image_files에 실제 존재하는 파일의 메타데이터만 조회 (고아 데이터 제외)
    const allMetadata = db.prepare(`
      SELECT DISTINCT m.*
      FROM media_metadata m
      INNER JOIN image_files f ON m.composite_hash = f.composite_hash
      WHERE f.file_status = 'active'
        AND m.perceptual_hash IS NOT NULL
        AND ${ImageSafetyService.buildVisibleScoreCondition('m.rating_score')}
      ORDER BY m.composite_hash
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

      // 실제 파일이 없는 경우 그룹에서 제외 (고아 메타데이터 필터링)
      if (fileRecords.length === 0) {
        continue;
      }

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
    const targetImage = this.requireColorHistogramImage(compositeHash);
    const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram!);
    const { query, params } = this.buildColorCandidateQuery(compositeHash);
    const candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];

    const results = candidates
      .map(candidate => this.buildColorSimilarMatch(targetImage, targetHist, candidate, threshold))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

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
    const file = this.findCompositeHashByImageId(imageId);

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
