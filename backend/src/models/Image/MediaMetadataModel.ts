import { db } from '../../database/init';
import { settingsService } from '../../services/settingsService';
import { AutoTagIndexService } from '../../services/autoTagIndexService';
import { PromptSimilarityService } from '../../services/promptSimilarityService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { ImageMetadataRecord } from '../../types/image';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../../utils/dynamicUpdate';
import { ImageStatsModel } from './ImageStatsModel';
import { MediaImageFeaturesModel } from './MediaImageFeaturesModel';
import { MediaMetadataFileQueries } from './MediaMetadataFileQueries';
import { AggregateCache, resolveSearchTotal } from '../../services/aggregateCache';
import { placeholdersFor, sortedUniqueChunks } from '../../utils/sqlInChunks';

function normalizeSuggestionLimit(limit: number, fallback = 16, max = 50): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

type SuggestionRow = { value: string; count: number };

/** SQLite's LOWER() and LIKE fold ASCII letters only; non-ASCII characters must match exactly. */
function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Filter a cached full suggestion list the way `LOWER(value) LIKE '%query%'` (escaped) did, keeping its order.
 * `normalizedQuery` is already trimmed and lower-cased, so ASCII-folded containment is exactly the LIKE match.
 */
function filterSuggestionRows(rows: readonly SuggestionRow[], normalizedQuery: string, limit: number): SuggestionRow[] {
  const matches = normalizedQuery.length === 0
    ? rows.slice(0, limit)
    : rows.filter((row) => lowerAscii(row.value).includes(normalizedQuery)).slice(0, limit);
  return matches.map((row) => ({ value: row.value, count: row.count }));
}

/** Whole-library suggestion aggregates move with the library; one cached list serves every keystroke. */
function resolveLibraryAggregate<T>(key: string, compute: () => T): T {
  return AggregateCache.resolve(key, compute, { scopes: ['library'] });
}

function getReadyMediaMetadataCondition(alias = 'media_metadata'): string {
  return MediaPostprocessVisibilityService.buildReadyCondition(alias);
}

/**
 * 미디어 메타데이터 모델
 * 원본 파일 접근이 필요 없는 모든 작업의 핵심
 *
 * 사용 케이스:
 * - 미디어 브라우징 (썸네일은 캐시에 있음)
 * - 검색/필터 (prompt, model, tags 기반)
 * - 통계/분석 (모델 사용량, 프롬프트 분석)
 * - 그룹 관리 (composite_hash 기반)
 */
export class MediaMetadataModel {
  /**
   * composite_hash로 메타데이터 조회
   */
  static findByHash(compositeHash: string): ImageMetadataRecord | null {
    const row = db.prepare(
      'SELECT * FROM media_metadata WHERE composite_hash = ?'
    ).get(compositeHash);
    return row as ImageMetadataRecord | null;
  }

  /**
   * 여러 composite_hash로 메타데이터 조회
   */
  static findByHashes(compositeHashes: string[]): ImageMetadataRecord[] {
    if (compositeHashes.length === 0) return [];

    // Chunked so a caller-sized list never exceeds SQLite's bound-parameter limit; sorted chunks keep the
    // composite_hash index order a single IN lookup returned.
    const rows: ImageMetadataRecord[] = [];
    for (const chunk of sortedUniqueChunks(compositeHashes)) {
      rows.push(...(db.prepare(
        `SELECT * FROM media_metadata WHERE composite_hash IN (${placeholdersFor(chunk)})`
      ).all(...chunk) as ImageMetadataRecord[]));
    }
    return rows;
  }

  /**
   * Ready (visible) rows after one rowid, in rowid order. Keyset paging for whole-library passes: unlike
   * findAll there is no COUNT and no OFFSET, so every page costs the same however deep the pass is.
   */
  static findReadyPageAfterRowid(rowidCursor: number, limit: number): Array<ImageMetadataRecord & { row_id: number }> {
    const readyCondition = getReadyMediaMetadataCondition();
    return db.prepare(`
      SELECT rowid AS row_id, * FROM media_metadata
      WHERE rowid > ? AND ${readyCondition}
      ORDER BY rowid
      LIMIT ?
    `).all(rowidCursor, limit) as Array<ImageMetadataRecord & { row_id: number }>;
  }

  /**
   * 모든 메타데이터 조회 (페이지네이션)
   * 브라우징, 검색, 필터링의 기본
   */
  static findAll(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'rating_score' | 'model_name' | 'metadata_updated_date';
    sortOrder?: 'ASC' | 'DESC';
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const sortBy = options.sortBy || 'first_seen_date';
    const sortOrder = options.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    const readyCondition = getReadyMediaMetadataCondition();
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM media_metadata
      WHERE ${readyCondition}
    `).get() as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
      WHERE ${readyCondition}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 메타데이터 생성
   */
  static create(data: Omit<ImageMetadataRecord, 'first_seen_date' | 'metadata_updated_date'>): string {
    const promptSimilaritySettings = settingsService.loadSettings().similarity.promptSimilarity;
    const promptSimilarityFields = (promptSimilaritySettings.enabled && promptSimilaritySettings.autoBuildOnMetadataUpdate)
      ? PromptSimilarityService.buildPreparedFields(data, promptSimilaritySettings.algorithm)
      : {
          prompt_similarity_algorithm: null,
          prompt_similarity_version: null,
          pos_prompt_normalized: null,
          neg_prompt_normalized: null,
          auto_prompt_normalized: null,
          pos_prompt_fingerprint: null,
          neg_prompt_fingerprint: null,
          auto_prompt_fingerprint: null,
          prompt_similarity_updated_date: null,
        };

    db.prepare(`
      INSERT INTO media_metadata (
        composite_hash, perceptual_hash, dhash, ahash,
        width, height, thumbnail_path,
        ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
        prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
        auto_tags, duration, fps, video_codec, audio_codec, bitrate, rating_score, model_references,
        character_prompt_text, raw_nai_parameters,
        prompt_similarity_algorithm, prompt_similarity_version,
        pos_prompt_normalized, neg_prompt_normalized, auto_prompt_normalized,
        pos_prompt_fingerprint, neg_prompt_fingerprint, auto_prompt_fingerprint,
        prompt_similarity_updated_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.composite_hash, data.perceptual_hash, data.dhash, data.ahash,
      data.width, data.height, data.thumbnail_path,
      data.ai_tool, data.model_name, data.lora_models, data.steps, data.cfg_scale,
      data.sampler, data.seed, data.scheduler, data.prompt, data.negative_prompt,
      data.denoise_strength, data.generation_time, data.batch_size, data.batch_index,
      data.auto_tags, data.duration, data.fps, data.video_codec, data.audio_codec,
      data.bitrate, data.rating_score, data.model_references,
      data.character_prompt_text, data.raw_nai_parameters,
      promptSimilarityFields.prompt_similarity_algorithm, promptSimilarityFields.prompt_similarity_version,
      promptSimilarityFields.pos_prompt_normalized, promptSimilarityFields.neg_prompt_normalized, promptSimilarityFields.auto_prompt_normalized,
      promptSimilarityFields.pos_prompt_fingerprint, promptSimilarityFields.neg_prompt_fingerprint, promptSimilarityFields.auto_prompt_fingerprint,
      promptSimilarityFields.prompt_similarity_updated_date
    );

    if (data.color_histogram) {
      MediaImageFeaturesModel.setHistogram(data.composite_hash, data.color_histogram);
    }
    AutoTagIndexService.syncForHash(data.composite_hash, data.auto_tags);
    ImageStatsModel.invalidateAutoTagStatsCache();

    return data.composite_hash;
  }

  /**
   * 메타데이터 업데이트
   */
  static update(compositeHash: string, updates: Partial<ImageMetadataRecord>): boolean {
    // 업데이트 가능한 필드들만 필터링
    const updatableFields = [
      'prompt', 'negative_prompt', 'auto_tags', 'rating_score',
      'ai_tool', 'model_name', 'lora_models', 'steps', 'cfg_scale',
      'sampler', 'seed', 'scheduler', 'denoise_strength',
      'generation_time', 'batch_size', 'batch_index',
      'thumbnail_path', 'width', 'height', 'model_references',
      'character_prompt_text', 'raw_nai_parameters',
      'prompt_similarity_algorithm', 'prompt_similarity_version',
      'pos_prompt_normalized', 'neg_prompt_normalized', 'auto_prompt_normalized',
      'pos_prompt_fingerprint', 'neg_prompt_fingerprint', 'auto_prompt_fingerprint',
      'prompt_similarity_updated_date'
    ];

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => updatableFields.includes(key))
    );

    const filteredUpdates = filterDefined(cleanUpdates);

    if (Object.keys(filteredUpdates).length === 0) return false;

    const shouldBuildPromptSimilarity = ['prompt', 'negative_prompt', 'auto_tags'].some((field) => field in filteredUpdates);
    if (shouldBuildPromptSimilarity) {
      const currentRecord = this.findByHash(compositeHash);
      if (currentRecord) {
        const nextRecord = {
          ...currentRecord,
          ...filteredUpdates,
        } as ImageMetadataRecord;
        const promptSimilaritySettings = settingsService.loadSettings().similarity.promptSimilarity;
        const promptSimilarityFields = (promptSimilaritySettings.enabled && promptSimilaritySettings.autoBuildOnMetadataUpdate)
          ? PromptSimilarityService.buildPreparedFields(nextRecord, promptSimilaritySettings.algorithm)
          : {
              prompt_similarity_algorithm: null,
              prompt_similarity_version: null,
              pos_prompt_normalized: null,
              neg_prompt_normalized: null,
              auto_prompt_normalized: null,
              pos_prompt_fingerprint: null,
              neg_prompt_fingerprint: null,
              auto_prompt_fingerprint: null,
              prompt_similarity_updated_date: null,
            };

        Object.assign(filteredUpdates, promptSimilarityFields);
      }
    }

    // metadata_updated_date는 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...filteredUpdates,
      metadata_updated_date: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery('media_metadata', finalUpdates, { composite_hash: compositeHash });
    const info = db.prepare(sql).run(...values);

    if (info.changes > 0 && 'auto_tags' in filteredUpdates) {
      AutoTagIndexService.syncForHash(compositeHash, filteredUpdates.auto_tags as string | null | undefined);
      ImageStatsModel.invalidateAutoTagStatsCache();
    }

    return info.changes > 0;
  }

  /**
   * 메타데이터 삭제. image_files FK는 ON DELETE SET NULL이라 파일 행은 남는다 — 함께 지우려면
   * DeletionService 경로를 쓴다.
   */
  static delete(compositeHash: string): boolean {
    const info = db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(compositeHash);
    if (info.changes > 0) {
      ImageStatsModel.invalidateAutoTagStatsCache();
    }
    return info.changes > 0;
  }

  /**
   * 여러 메타데이터 삭제
   */
  static deleteMany(compositeHashes: string[]): number {
    if (compositeHashes.length === 0) return 0;

    const changes = db.transaction(() => sortedUniqueChunks(compositeHashes).reduce((total, chunk) => total + db.prepare(
      `DELETE FROM media_metadata WHERE composite_hash IN (${placeholdersFor(chunk)})`
    ).run(...chunk).changes, 0))();

    if (changes > 0) {
      ImageStatsModel.invalidateAutoTagStatsCache();
    }

    return changes;
  }

  /**
   * 검색 (프롬프트, 모델명 기반)
   */
  static search(query: string, options?: {
    limit?: number;
    offset?: number;
  }): ImageMetadataRecord[] {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const readyCondition = getReadyMediaMetadataCondition();

    return db.prepare(`
      SELECT * FROM media_metadata
      WHERE (${readyCondition})
        AND (prompt LIKE ? OR negative_prompt LIKE ? OR model_name LIKE ?)
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit, offset) as ImageMetadataRecord[];
  }

  /**
   * AI 도구별 필터
   */
  static findByAITool(aiTool: string, options?: {
    page?: number;
    limit?: number;
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const readyCondition = getReadyMediaMetadataCondition();
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM media_metadata
      WHERE ai_tool = ? AND ${readyCondition}
    `).get(aiTool) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
      WHERE ai_tool = ? AND ${readyCondition}
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(aiTool, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 모델명별 필터
   */
  static findByModel(modelName: string, options?: {
    page?: number;
    limit?: number;
  }): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const readyCondition = getReadyMediaMetadataCondition();
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM media_metadata
      WHERE model_name = ? AND ${readyCondition}
    `).get(modelName) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
      WHERE model_name = ? AND ${readyCondition}
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(modelName, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 날짜 범위 필터 (메서드 오버로드: page/limit 숫자 직접 전달)
   */
  static findByDateRange(
    startDate: string,
    endDate: string,
    page?: number,
    limit?: number
  ): { items: ImageMetadataRecord[], total: number } {
    const _page = page || 1;
    const _limit = limit || 20;
    const offset = (_page - 1) * _limit;

    const readyCondition = getReadyMediaMetadataCondition();
    // Every page of one range has the same total; count it once per 30s instead of once per page.
    const countSql = `
      SELECT COUNT(*) as total
      FROM media_metadata
      WHERE first_seen_date BETWEEN ? AND ? AND ${readyCondition}
    `;
    const total = resolveSearchTotal('findByDateRange', [countSql], [startDate, endDate], () => (
      (db.prepare(countSql).get(startDate, endDate) as { total: number }).total
    ));

    const items = db.prepare(`
      SELECT * FROM media_metadata
      WHERE first_seen_date BETWEEN ? AND ? AND ${readyCondition}
      ORDER BY first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(startDate, endDate, _limit, offset) as ImageMetadataRecord[];

    return { items, total };
  }

  /**
   * 평점별 필터
   */
  static findByRating(
    minRating: number,
    maxRating: number = 5,
    options?: {
      page?: number;
      limit?: number;
    }
  ): { items: ImageMetadataRecord[], total: number } {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const readyCondition = getReadyMediaMetadataCondition();
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM media_metadata
      WHERE rating_score BETWEEN ? AND ? AND ${readyCondition}
    `).get(minRating, maxRating) as { total: number };

    const items = db.prepare(`
      SELECT * FROM media_metadata
      WHERE rating_score BETWEEN ? AND ? AND ${readyCondition}
      ORDER BY rating_score DESC, first_seen_date DESC
      LIMIT ? OFFSET ?
    `).all(minRating, maxRating, limit, offset) as ImageMetadataRecord[];

    return { items, total: countRow.total };
  }

  /**
   * 통계: AI 도구별 개수
   */
  static getAIToolStats(): Array<{ ai_tool: string; count: number }> {
    const readyCondition = getReadyMediaMetadataCondition();

    const rows = resolveLibraryAggregate(`stats:ai-tool:${readyCondition}`, () => db.prepare(`
      SELECT ai_tool, COUNT(*) as count
      FROM media_metadata
      WHERE ai_tool IS NOT NULL AND ${readyCondition}
      GROUP BY ai_tool
      ORDER BY count DESC
    `).all() as Array<{ ai_tool: string; count: number }>);
    return rows.map((row) => ({ ...row }));
  }

  /**
   * 통계: 모델별 개수
   */
  static getModelStats(): Array<{ model_name: string; count: number }> {
    const readyCondition = getReadyMediaMetadataCondition();

    const rows = resolveLibraryAggregate(`stats:model:${readyCondition}`, () => db.prepare(`
      SELECT model_name, COUNT(*) as count
      FROM media_metadata
      WHERE model_name IS NOT NULL AND ${readyCondition}
      GROUP BY model_name
      ORDER BY count DESC
      LIMIT 50
    `).all() as Array<{ model_name: string; count: number }>);
    return rows.map((row) => ({ ...row }));
  }

  /**
   * 검색 UI용 모델 자동완성 후보 조회
   *
   * The whole model list (one GROUP BY over the library) is cached per library version and filtered per keystroke;
   * the query filter used to rerun that full aggregate on every keystroke.
   */
  static searchModelSuggestions(query = '', limit = 16): Array<{ value: string; count: number }> {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLimit = normalizeSuggestionLimit(limit);
    const readyCondition = getReadyMediaMetadataCondition();

    const rows = resolveLibraryAggregate(`suggest:model:${readyCondition}`, () => db.prepare(`
      SELECT model_name as value, COUNT(*) as count
      FROM media_metadata
      WHERE model_name IS NOT NULL
        AND TRIM(model_name) != ''
        AND ${readyCondition}
      GROUP BY model_name
      ORDER BY count DESC, model_name ASC
    `).all() as SuggestionRow[]);
    return filterSuggestionRows(rows, normalizedQuery, normalizedLimit);
  }

  /**
   * 검색 UI용 LoRA 자동완성 후보 조회
   *
   * Cached like the model list. The former per-row filter tested the untrimmed item text; the query is trimmed, so
   * containment in the untrimmed and the trimmed (grouped) text is the same test.
   */
  static searchLoraSuggestions(query = '', limit = 16): Array<{ value: string; count: number }> {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLimit = normalizeSuggestionLimit(limit);
    const readyCondition = getReadyMediaMetadataCondition('metadata');

    const rows = resolveLibraryAggregate(`suggest:lora:${readyCondition}`, () => db.prepare(`
      SELECT TRIM(CAST(lora_item.value AS TEXT)) as value, COUNT(*) as count
      FROM media_metadata AS metadata
      JOIN json_each(CASE WHEN json_valid(metadata.lora_models) = 1 THEN metadata.lora_models ELSE '[]' END) AS lora_item
      WHERE metadata.lora_models IS NOT NULL
        AND TRIM(CAST(lora_item.value AS TEXT)) != ''
        AND ${readyCondition}
      GROUP BY TRIM(CAST(lora_item.value AS TEXT))
      ORDER BY count DESC, value ASC
    `).all() as SuggestionRow[]);
    return filterSuggestionRows(rows, normalizedQuery, normalizedLimit);
  }

  /**
   * 총 개수
   */
  static count(): number {
    const readyCondition = getReadyMediaMetadataCondition();
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM media_metadata
      WHERE ${readyCondition}
    `).get() as { count: number };
    return row.count;
  }

  /**
   * composite_hash 존재 여부 확인
   */
  static exists(compositeHash: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM media_metadata WHERE composite_hash = ? LIMIT 1'
    ).get(compositeHash);
    return !!row;
  }

  /**
   * 파일 경로 포함 전체 조회 (image_files JOIN)
   * composite_hash가 NULL인 이미지는 제외 (해시 생성 완료된 이미지만 표시)
   */
  static findAllWithFiles(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'width' | 'height' | 'scan_date' | 'file_size';
    sortOrder?: 'ASC' | 'DESC';
    total?: number;
  }): { items: any[], total: number } {
    return MediaMetadataFileQueries.findAllWithFiles(options);
  }

  /**
   * 커서 기반 페이지네이션으로 파일 경로 포함 조회 (무한 스크롤용)
   * 오프셋 기반과 달리 새 이미지가 추가되어도 목록이 뒤섞이지 않음
   *
   * cursorDate/cursorHash가 없으면 첫 페이지 반환
   */
  static findAllWithFilesCursor(options: {
    limit?: number;
    sortOrder?: 'ASC' | 'DESC';
    cursorDate?: string;
    cursorHash?: string;
    includeTotal?: boolean;
  }): { items: any[], total: number, hasMore: boolean } {
    return MediaMetadataFileQueries.findAllWithFilesCursor(options);
  }

  /**
   * 활성 파일이 있는 노출 가능 미디어 총 개수
   * 홈 피드 total 을 첫 페이지 응답과 분리해 캐시하기 위한 진입점
   */
  static countVisibleWithActiveFile(): number {
    return MediaMetadataFileQueries.countVisibleWithActiveFile();
  }

  /**
   * 지정된 composite_hash 목록에 해당하는 파일 포함 상세 정보 조회
   */
  static findByHashesWithFiles(compositeHashes: string[]): any[] {
    return MediaMetadataFileQueries.findByHashesWithFiles(compositeHashes);
  }

  /**
   * 랜덤 이미지 조회 (파일 경로 포함)
   * composite_hash가 있는 이미지만 조회
   *
   * Note: Using OFFSET with random index instead of ORDER BY RANDOM()
   * to ensure true randomness on each call
   */
  static getRandomImage(): any | null {
    return MediaMetadataFileQueries.getRandomImage();
  }

  /**
   * 랜덤 비디오 조회 (파일 경로 포함)
   */
  static getRandomVideo(): any | null {
    return MediaMetadataFileQueries.getRandomVideo();
  }
}
