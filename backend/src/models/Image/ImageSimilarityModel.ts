import { db } from '../../database/init';
import { ImageMetadataRecord } from '../../types/image';
import {
  ColorHistogram,
  SimilarImage,
  DuplicateGroup,
  SimilaritySearchOptions,
  DuplicateSearchOptions,
  SimilarityMatchType,
  SIMILARITY_THRESHOLDS
} from '../../types/similarity';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaImageFeaturesModel, type ColorHistogramInput } from './MediaImageFeaturesModel';
import {
  buildColorCandidateQuery,
  buildDuplicateCandidateQuery,
  buildDuplicateGroupFilesQuery,
  buildDuplicateGroupMetadataQuery,
  buildDuplicateGroupFileIdsQuery,
  buildDuplicateGroupFilesByIdQuery,
  buildDuplicateGroupIndexQuery,
  buildDuplicateGroupMetadataCountQuery,
  buildColorCandidateRowsQuery,
  buildColorDescriptorScanQuery,
  buildIndexedCandidateQuery,
  buildSimilarCandidateQuery,
  IndexedHashGate,
  SimilarityCandidateRecord,
} from './ImageSimilarityQueryBuilder';
import { hamming64, parseHash64 } from './similarityIndexSql';
import { sortedUniqueChunks } from '../../utils/sqlInChunks';
import { greedyDuplicateGroups, planBandLayout } from './duplicateGrouping';
import {
  buildColorSimilarMatch,
  buildDuplicateMatch,
  buildSimilarMatch,
  loadTargetHistogram,
  SimilarityThresholds,
  SimilarityWeights,
  sortColorSimilarResults,
  sortDuplicateResults,
  sortSimilarResults,
} from './ImageSimilarityMatchBuilder';

/**
 * Libraries up to this many duplicate-group candidates are grouped inside the request; larger ones run as a
 * `duplicate-group-scan` runtime job (the indexed grouping takes about a second per few hundred thousand).
 */
export const DUPLICATE_GROUP_SYNC_CANDIDATE_LIMIT = 50000;

/** SQLite host-parameter budget per IN list. */
const IN_LIST_CHUNK = 500;
/** Duplicate-group candidates read per query (keyset pages by composite_hash). */
const DUPLICATE_GROUP_LOAD_PAGE = 10000;

export type DuplicateGroupScanHooks = {
  /** Awaited every few thousand candidates: event-loop yield, cancellation check, progress. */
  onProgress?: (processed: number, total: number) => Promise<void> | void;
};

type DuplicateGroupScanOptions = DuplicateSearchOptions & {
  candidateLimit?: number;
  allowLargeSyncScan?: boolean;
  hooks?: DuplicateGroupScanHooks;
};

/** One duplicate group by reference: what a long scan stores and pages through. */
export type DuplicateGroupRef = {
  groupId: string;
  similarity: number;
  matchType: SimilarityMatchType;
  /** Active file ids in display order (composite_hash, then file id). */
  fileIds: number[];
};

/** Internal switch for tests and comparisons: force the original full candidate scan. */
type CandidateStrategy = { candidateStrategy?: 'auto' | 'full-scan' };

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export class DuplicateGroupScanTooLargeError extends Error {
  readonly candidateCount: number;
  readonly candidateLimit: number;

  constructor(candidateCount: number, candidateLimit: number) {
    super(
      `Duplicate group scan has ${candidateCount} candidates, above the synchronous limit of ${candidateLimit}.`
    );
    this.name = 'DuplicateGroupScanTooLargeError';
    this.candidateCount = candidateCount;
    this.candidateLimit = candidateLimit;
  }
}

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
    return db.prepare(`
      SELECT mm.*, mf.color_histogram
      FROM media_metadata mm
      ${MediaImageFeaturesModel.join('mm')}
      WHERE mm.composite_hash = ?
    `).get(compositeHash) as ImageMetadataRecord | undefined;
  }

  /**
   * Upper bound of the duplicate-group candidates (every media row with a parsable pHash), read from a band index in
   * milliseconds. Enough to choose between grouping in the request and the runtime job; the exact count below joins
   * image_files for every row and takes seconds on a large library.
   */
  static estimateDuplicateGroupCandidates(): number {
    const result = db.prepare('SELECT COUNT(*) AS count FROM media_similarity_index WHERE p_b0 IS NOT NULL').get() as { count: number };
    return result.count;
  }

  static countDuplicateGroupCandidates(): number {
    const result = db.prepare(buildDuplicateGroupMetadataCountQuery()).get() as { count: number } | undefined;
    return result?.count ?? 0;
  }

  private static buildHydrationKey(image: Partial<SimilarityCandidateRecord>): string | null {
    const fileId = typeof image.file_id === 'number' && Number.isFinite(image.file_id)
      ? image.file_id
      : null;
    if (fileId !== null) {
      return `file:${fileId}`;
    }
    return image.composite_hash ? `hash:${image.composite_hash}` : null;
  }

  /** Hydrate only final matches so candidate scans do not pull large metadata blobs. */
  private static hydrateSimilarityMatches(matches: SimilarImage[]): SimilarImage[] {
    if (matches.length === 0) {
      return matches;
    }

    const fileIds = [...new Set(matches
      .map(match => match.image as Partial<SimilarityCandidateRecord>)
      .map(image => image.file_id)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))];
    const compositeHashes = [...new Set(matches
      .map(match => (match.image as Partial<SimilarityCandidateRecord>).composite_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0))];
    const hydratedByKey = new Map<string, any>();

    for (const fileIdChunk of chunk(fileIds, IN_LIST_CHUNK)) {
      const placeholders = fileIdChunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT
          im.*,
          f.id as file_id,
          f.original_file_path,
          f.file_size,
          f.mime_type,
          f.file_status,
          f.file_type,
          f.folder_id,
          wf.folder_name
        FROM image_files f
        JOIN media_metadata im ON f.composite_hash = im.composite_hash
        LEFT JOIN watched_folders wf ON f.folder_id = wf.id
        WHERE f.id IN (${placeholders})
      `).all(...fileIdChunk) as any[];

      for (const row of rows) {
        hydratedByKey.set(`file:${row.file_id}`, row);
        hydratedByKey.set(`hash:${row.composite_hash}`, row);
      }
    }

    for (const hashChunk of chunk(compositeHashes, IN_LIST_CHUNK)) {
      const placeholders = hashChunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT
          im.*,
          f.id as file_id,
          f.original_file_path,
          f.file_size,
          f.mime_type,
          f.file_status,
          f.file_type,
          f.folder_id,
          wf.folder_name
        FROM media_metadata im
        LEFT JOIN image_files f ON im.composite_hash = f.composite_hash AND f.file_status = 'active'
        LEFT JOIN watched_folders wf ON f.folder_id = wf.id
        WHERE im.composite_hash IN (${placeholders})
        GROUP BY im.composite_hash
      `).all(...hashChunk) as any[];

      for (const row of rows) {
        if (!hydratedByKey.has(`hash:${row.composite_hash}`)) {
          hydratedByKey.set(`hash:${row.composite_hash}`, row);
        }
      }
    }

    return matches.map(match => {
      const image = match.image as Partial<SimilarityCandidateRecord>;
      const fileKey = this.buildHydrationKey(image);
      const hashKey = image.composite_hash ? `hash:${image.composite_hash}` : null;
      const hydratedImage = (fileKey ? hydratedByKey.get(fileKey) : null)
        ?? (hashKey ? hydratedByKey.get(hashKey) : null)
        ?? match.image;

      return {
        ...match,
        image: hydratedImage,
      };
    });
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

  /**
   * 이미지 해시 업데이트 (composite_hash 기반)
   */
  static async updateHash(
    compositeHash: string,
    perceptualHash: string,
    dHash: string,
    aHash: string,
    colorHistogram: ColorHistogramInput
  ): Promise<boolean> {
    return db.transaction(() => {
      const info = db.prepare(`
        UPDATE media_metadata
        SET perceptual_hash = ?, dhash = ?, ahash = ?, metadata_updated_date = CURRENT_TIMESTAMP
        WHERE composite_hash = ?
      `).run(perceptualHash, dHash, aHash, compositeHash);
      MediaImageFeaturesModel.setHistogram(compositeHash, colorHistogram);
      return info.changes > 0;
    })();
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

  /**
   * 특정 이미지의 중복 검색 (composite_hash 기반)
   */
  /**
   * A hash component gates candidates only when it carries weight and the target has a parsable hash; candidates
   * missing that hash pass it (the match builders skip the component for them).
   */
  private static hashGate(weight: number, targetHash: string | null | undefined, threshold: number): IndexedHashGate | null {
    const hash = weight > 0 ? parseHash64(targetHash) : null;
    return hash ? { hash, threshold } : null;
  }

  static async findDuplicates(
    compositeHash: string,
    options: DuplicateSearchOptions & CandidateStrategy = {}
  ): Promise<SimilarImage[]> {
    const {
      includeMetadata = true
    } = options;

    const weights = this.getDuplicateWeights(options);
    const thresholds = this.getDuplicateThresholds(options);
    const targetImage = this.requirePerceptualHashImage(compositeHash);
    // Every candidate's pHash must pass when pHash carries weight, so the pHash index can select the candidates.
    const perceptual = options.candidateStrategy === 'full-scan'
      ? null
      : this.hashGate(weights.perceptualHash, targetImage.perceptual_hash, thresholds.perceptualHash);
    let candidates: SimilarityCandidateRecord[];
    if (perceptual) {
      const { query, params } = buildIndexedCandidateQuery({
        targetImage,
        perceptual,
        dHash: this.hashGate(weights.dHash, targetImage.dhash, thresholds.dHash),
        aHash: this.hashGate(weights.aHash, targetImage.ahash, thresholds.aHash),
        fileJoin: 'any',
        includeColorHistogram: false,
        metadataBounds: includeMetadata,
      });
      candidates = db.prepare(query).all(params) as SimilarityCandidateRecord[];
    } else {
      const { query, params } = buildDuplicateCandidateQuery(targetImage, includeMetadata);
      candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];
    }

    const results = candidates
      .map(candidate => buildDuplicateMatch(targetImage, candidate, weights, thresholds))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

    return this.hydrateSimilarityMatches(sortDuplicateResults(results));
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
    options: SimilaritySearchOptions & CandidateStrategy = {}
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
    const includeColorSimilarity = Boolean(options.includeColorSimilarity || weights.color > 0 || thresholds.color > 0);
    const targetHistogram = loadTargetHistogram(targetImage, includeColorSimilarity);
    // With pHash weight 0 a candidate can match on the other components alone, so only the full scan is exact.
    const perceptual = options.candidateStrategy === 'full-scan'
      ? null
      : this.hashGate(weights.perceptualHash, targetImage.perceptual_hash, thresholds.perceptualHash);
    let candidates: SimilarityCandidateRecord[];
    if (perceptual) {
      const colorDescriptor = targetHistogram && weights.color > 0 && thresholds.color > 0
        ? ImageSimilarityService.colorDescriptor(targetHistogram)
        : null;
      const { query, params } = buildIndexedCandidateQuery({
        targetImage,
        perceptual,
        dHash: this.hashGate(weights.dHash, targetImage.dhash, thresholds.dHash),
        aHash: this.hashGate(weights.aHash, targetImage.ahash, thresholds.aHash),
        color: colorDescriptor ? { descriptor: colorDescriptor, minimum: thresholds.color } : null,
        fileJoin: 'active',
        includeColorHistogram: includeColorSimilarity,
        metadataBounds: useMetadataFilter,
      });
      candidates = db.prepare(query).all(params) as SimilarityCandidateRecord[];
    } else {
      const { query, params } = buildSimilarCandidateQuery(targetImage, useMetadataFilter, includeColorSimilarity);
      candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];
    }

    const results = candidates
      .map(candidate => buildSimilarMatch(targetImage, candidate, weights, thresholds, targetHistogram))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

    sortSimilarResults(results, sortBy, sortOrder);
    return this.hydrateSimilarityMatches(results.slice(0, limit));
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
    options: DuplicateGroupScanOptions & CandidateStrategy = {}
  ): Promise<DuplicateGroup[]> {
    const {
      threshold = SIMILARITY_THRESHOLDS.NEAR_DUPLICATE,
      minGroupSize = 2,
      candidateLimit = DUPLICATE_GROUP_SYNC_CANDIDATE_LIMIT,
      allowLargeSyncScan = false
    } = options;

    const boundedCandidateLimit = Math.max(1, Math.floor(candidateLimit));
    if (!allowLargeSyncScan) {
      const candidateCount = this.countDuplicateGroupCandidates();
      if (candidateCount > boundedCandidateLimit) {
        throw new DuplicateGroupScanTooLargeError(candidateCount, boundedCandidateLimit);
      }
    }

    if (options.candidateStrategy === 'full-scan') {
      return this.findAllDuplicateGroupsByFullScan(threshold, minGroupSize);
    }

    const refs = await this.scanDuplicateGroupRefs({ threshold, minGroupSize, hooks: options.hooks });
    return this.hydrateDuplicateGroupRefs(refs);
  }

  /**
   * Duplicate groups as compact references (file ids in display order), already sorted like findAllDuplicateGroups.
   * Same greedy grouping and the same group/similarity rules as the original full scan, with neighbours found through
   * band buckets over the pHash halves of media_similarity_index. Large libraries run this in the
   * `duplicate-group-scan` runtime job and page through the stored references.
   */
  static async scanDuplicateGroupRefs(options: {
    threshold?: number;
    minGroupSize?: number;
    hooks?: DuplicateGroupScanHooks;
  } = {}): Promise<DuplicateGroupRef[]> {
    const threshold = options.threshold ?? SIMILARITY_THRESHOLDS.NEAR_DUPLICATE;
    const minGroupSize = options.minGroupSize ?? 2;
    const onProgress = options.hooks?.onProgress;

    // STEP 1: pHash halves of every visible media row with an active file, in composite_hash order, a page at a time
    // so a large library does not hold the event loop for the whole read.
    type CandidateRow = { media_id: number; composite_hash: string; p_hi: number; p_lo: number; active_files: number };
    const mediaIdList: number[] = [];
    const hiList: number[] = [];
    const loList: number[] = [];
    const activeList: number[] = [];
    const page = db.prepare(buildDuplicateGroupIndexQuery());
    for (let after = ''; ;) {
      const batch = page.all({ after, limit: DUPLICATE_GROUP_LOAD_PAGE }) as CandidateRow[];
      for (const row of batch) {
        mediaIdList.push(row.media_id);
        hiList.push(row.p_hi);
        loList.push(row.p_lo);
        activeList.push(row.active_files);
      }
      if (batch.length < DUPLICATE_GROUP_LOAD_PAGE) break;
      after = batch[batch.length - 1].composite_hash;
      if (onProgress) await onProgress(0, mediaIdList.length);
    }
    const count = mediaIdList.length;
    if (count === 0) {
      return [];
    }

    const layout = planBandLayout(count, threshold);
    if (!layout) {
      // Thresholds this loose would compare a large share of all pairs; refuse like the old synchronous cap did.
      throw new DuplicateGroupScanTooLargeError(count, DUPLICATE_GROUP_SYNC_CANDIDATE_LIMIT);
    }

    const mediaIds = Int32Array.from(mediaIdList);
    const hi = Uint32Array.from(hiList);
    const lo = Uint32Array.from(loList);
    const activeFiles = Int32Array.from(activeList);

    // STEP 2: the same greedy grouping as the full scan, with neighbours from band buckets.
    const positionGroups = await greedyDuplicateGroups(
      hi,
      lo,
      threshold,
      layout,
      (position) => activeFiles[position] >= minGroupSize,
      { onProgress },
    );

    const kept = positionGroups.filter((group) => {
      const totalFileCount = group.reduce((sum, position) => sum + activeFiles[position], 0);
      return totalFileCount >= minGroupSize || group.length >= minGroupSize;
    });

    // STEP 3: active file ids of the kept groups, a few hundred media rows per query.
    const filesByMediaId = new Map<number, Array<{ file_id: number; composite_hash: string }>>();
    const mediaIdChunks = chunk(kept.flatMap((group) => group.map((position) => mediaIds[position])), IN_LIST_CHUNK);
    for (let index = 0; index < mediaIdChunks.length; index += 1) {
      const { query, params } = buildDuplicateGroupFileIdsQuery(mediaIdChunks[index]);
      for (const record of db.prepare(query).all(...params) as Array<{ media_id: number; file_id: number; composite_hash: string }>) {
        const list = filesByMediaId.get(record.media_id);
        if (list) list.push(record); else filesByMediaId.set(record.media_id, [record]);
      }
      if (index % 5 === 4 && onProgress) {
        await onProgress(count, count);
      }
    }

    const refs: DuplicateGroupRef[] = [];
    for (const group of kept) {
      // Members are in composite_hash order, so this matches ORDER BY composite_hash, file id.
      const files = group.flatMap((position) => filesByMediaId.get(mediaIds[position]) ?? []);
      if (files.length === 0) {
        continue;
      }

      const uniqueMetadataCount = group.length;
      const totalFileCount = files.length;
      if (totalFileCount < minGroupSize && uniqueMetadataCount < minGroupSize) {
        continue;
      }

      const seed = group[0];
      let avgSimilarity: number;
      let matchType: SimilarityMatchType;
      if (uniqueMetadataCount === 1 && totalFileCount >= 2) {
        avgSimilarity = 100;
        matchType = 'exact' as SimilarityMatchType;
      } else {
        avgSimilarity = group.reduce((sum, position, index) => {
          if (index === 0) return sum;
          const distance = hamming64({ hi: hi[seed], lo: lo[seed] }, { hi: hi[position], lo: lo[position] });
          return sum + ImageSimilarityService.hammingDistanceToSimilarity(distance);
        }, 0) / (group.length - 1 || 1);
        matchType = ImageSimilarityService.determineMatchType(threshold);
      }

      refs.push({
        groupId: `group_${files[0].composite_hash.substring(0, 16)}`,
        similarity: Math.round(avgSimilarity * 100) / 100,
        matchType,
        fileIds: files.map((file) => file.file_id),
      });
    }

    return refs.sort((a, b) => {
      const simDiff = b.similarity - a.similarity;
      if (simDiff !== 0) return simDiff;
      return b.fileIds.length - a.fileIds.length;
    });
  }

  /** Load the file rows (metadata + file columns) of duplicate group references, keeping their order. */
  static hydrateDuplicateGroupRefs(refs: DuplicateGroupRef[]): DuplicateGroup[] {
    const rowsByFileId = new Map<number, any>();
    for (const fileIds of chunk(refs.flatMap((ref) => ref.fileIds), IN_LIST_CHUNK)) {
      const { query, params } = buildDuplicateGroupFilesByIdQuery(fileIds);
      for (const row of db.prepare(query).all(...params) as any[]) {
        rowsByFileId.set(row.file_id, row);
      }
    }

    const groups: DuplicateGroup[] = [];
    for (const ref of refs) {
      // Files deleted or hidden since the scan drop out; a group that loses every file disappears.
      const images = ref.fileIds.map((fileId) => rowsByFileId.get(fileId)).filter((row) => row !== undefined);
      if (images.length > 0) {
        groups.push({ groupId: ref.groupId, images, similarity: ref.similarity, matchType: ref.matchType });
      }
    }
    return groups;
  }

  /** The original O(n²) grouping over every candidate's metadata row; kept as the reference implementation. */
  private static async findAllDuplicateGroupsByFullScan(threshold: number, minGroupSize: number): Promise<DuplicateGroup[]> {
    // STEP 1: image_files에 실제 존재하는 파일의 메타데이터만 조회 (고아 데이터 제외)
    const allMetadata = db.prepare(buildDuplicateGroupMetadataQuery()).all() as ImageMetadataRecord[];

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

      // image_files에서 해당 composite_hash를 가진 모든 파일 조회 (정렬된 청크를 이어 붙이면 ORDER BY composite_hash, id 와 같다)
      const fileRecords = sortedUniqueChunks(compositeHashes).flatMap((hashChunk) => {
        const { query, params } = buildDuplicateGroupFilesQuery(hashChunk);
        return db.prepare(query).all(...params) as any[];
      });

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
    limit: number = 20,
    options: CandidateStrategy = {}
  ): Promise<SimilarImage[]> {
    const targetImage = this.requireColorHistogramImage(compositeHash);
    const targetHist = ImageSimilarityService.deserializeHistogram(targetImage.color_histogram!);
    if (options.candidateStrategy !== 'full-scan') {
      return this.hydrateSimilarityMatches(this.findTopColorMatches(targetImage, targetHist, threshold, limit));
    }

    const { query, params } = buildColorCandidateQuery(compositeHash);
    const candidates = db.prepare(query).all(...params) as SimilarityCandidateRecord[];

    const results = candidates
      .map(candidate => buildColorSimilarMatch(targetImage, targetHist, candidate, threshold))
      .filter((candidate): candidate is SimilarImage => candidate !== null);

    sortColorSimilarResults(results);
    return this.hydrateSimilarityMatches(results.slice(0, limit));
  }

  /**
   * Colour matches from the descriptor columns of media_similarity_index: every row in the luminance window is scored
   * with calculateColorSimilarity on the stored descriptor (the numbers the histogram's own descriptor holds), ranked
   * by score then media_id, and only the top media rows are loaded and re-scored from their histograms. The ranking
   * equals the full scan's order (score descending, ties in media_id / file id order).
   */
  private static findTopColorMatches(
    targetImage: ImageMetadataRecord,
    targetHist: ReturnType<typeof ImageSimilarityService.deserializeHistogram>,
    threshold: number,
    limit: number,
  ): SimilarImage[] {
    const targetDescriptor = ImageSimilarityService.colorDescriptor(targetHist);
    const target = { descriptor: targetDescriptor } as ColorHistogram;
    const scan = buildColorDescriptorScanQuery(targetDescriptor.luminance, threshold);
    const mediaIds: number[] = [];
    const scores: number[] = [];
    for (const row of db.prepare(scan.query).raw().iterate(...scan.params) as Iterable<number[]>) {
      const score = ImageSimilarityService.calculateColorSimilarity(target, {
        descriptor: {
          averageRgb: [row[1], row[2], row[3]],
          dominantRgb: [row[4], row[5], row[6]],
          luminance: row[7],
          saturation: row[8],
        },
      } as ColorHistogram);
      if (score >= threshold) {
        mediaIds.push(row[0]);
        scores.push(score);
      }
    }

    const order = Array.from(mediaIds.keys()).sort((left, right) => (scores[right] - scores[left]) || (mediaIds[left] - mediaIds[right]));
    const wanted = Math.max(0, Math.floor(limit));
    const results: SimilarImage[] = [];
    for (let start = 0; start < order.length && results.length < wanted; start += IN_LIST_CHUNK) {
      const rankIds = order.slice(start, start + IN_LIST_CHUNK).map((index) => mediaIds[index]);
      const { query, params } = buildColorCandidateRowsQuery(targetImage.composite_hash, rankIds);
      const rowsByMedia = new Map<number, SimilarityCandidateRecord[]>();
      for (const row of db.prepare(query).all(...params) as Array<SimilarityCandidateRecord & { media_id: number }>) {
        const list = rowsByMedia.get(row.media_id);
        if (list) list.push(row); else rowsByMedia.set(row.media_id, [row]);
      }
      for (const mediaId of rankIds) {
        for (const candidate of rowsByMedia.get(mediaId) ?? []) {
          const match = buildColorSimilarMatch(targetImage, targetHist, candidate, threshold);
          if (match) results.push(match);
        }
      }
    }

    // Same comparator as the full scan; the input is already in that order, so this only guards the cut.
    sortColorSimilarResults(results);
    return results.slice(0, wanted);
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

}
