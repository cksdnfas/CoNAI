import { db } from '../../database/init';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import type { FileType } from '../../types/image';

function getVisibleMediaMetadataCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('mm.rating_score');
}

function getReadyMediaMetadataCondition() {
  return MediaPostprocessVisibilityService.buildReadyCondition('mm');
}

/** Narrow media row used by the media-serving guards (visibility + thumbnail routing). */
export interface MediaVisibilityGuardRecord {
  composite_hash: string;
  thumbnail_path: string | null;
  rating_score: number | null;
  postprocess_status?: string | null;
}

// Older databases created the column through an ALTER that never ran, so mirror the
// probe MediaPostprocessVisibilityService already does instead of hard-coding it.
let visibilityGuardColumnsCache: string | undefined;
function getVisibilityGuardColumns(): string {
  if (visibilityGuardColumnsCache === undefined) {
    const hasPostprocessStatus = MediaPostprocessVisibilityService.buildReadyCondition('mm') !== '1 = 1';
    visibilityGuardColumnsCache = hasPostprocessStatus
      ? 'composite_hash, thumbnail_path, rating_score, postprocess_status'
      : 'composite_hash, thumbnail_path, rating_score';
  }

  return visibilityGuardColumnsCache;
}

const ACTIVE_FILE_WITH_METADATA_SELECT = `
  SELECT
    mm.composite_hash,
    mm.perceptual_hash,
    mm.dhash,
    mm.ahash,
    mm.color_histogram,
    mm.width,
    mm.height,
    mm.thumbnail_path,
    mm.ai_tool,
    mm.model_name,
    mm.lora_models,
    mm.steps,
    mm.cfg_scale,
    mm.sampler,
    mm.seed,
    mm.scheduler,
    mm.prompt,
    mm.negative_prompt,
    mm.denoise_strength,
    mm.generation_time,
    mm.batch_size,
    mm.batch_index,
    mm.auto_tags,
    mm.duration,
    mm.fps,
    mm.video_codec,
    mm.audio_codec,
    mm.bitrate,
    mm.rating_score,
    mm.character_prompt_text,
    mm.raw_nai_parameters,
    mm.first_seen_date,
    mm.metadata_updated_date,
    if.id,
    if.original_file_path,
    if.file_size,
    if.mime_type,
    if.file_status,
    if.scan_date,
    if.file_type
  FROM image_files if
  LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
`;

// Columns the list feed actually ships. This mirrors the enrichCompactImageWithFileView
// allowlist exactly, so the ~11KB wide columns (prompts, histograms, perceptual hashes,
// auto_tags, raw NAI parameters, video codec metadata) never leave SQLite for a list page.
// The detail/batch/group-download paths keep using ACTIVE_FILE_WITH_METADATA_SELECT above.
const COMPACT_METADATA_COLUMNS = `
    mm.composite_hash,
    mm.width,
    mm.height,
    mm.thumbnail_path,
    mm.rating_score,
    mm.first_seen_date,
    mm.metadata_updated_date`;

const COMPACT_FILE_COLUMNS = `
    if.id,
    if.original_file_path,
    if.file_size,
    if.mime_type,
    if.file_status,
    if.scan_date,
    if.file_type`;

const COMPACT_ACTIVE_FILE_WITH_METADATA_SELECT = `
  SELECT
${COMPACT_METADATA_COLUMNS},
${COMPACT_FILE_COLUMNS}
  FROM image_files if
  LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
`;

// Join the single oldest active file per metadata row through a correlated MIN(if2.id) subquery.
// This keeps one row per composite_hash without a GROUP BY, so the first_seen cursor index can
// still satisfy ORDER BY and LIMIT can short-circuit instead of materializing the whole library.
const METADATA_FIRST_SEEN_WITH_ACTIVE_FILE_SELECT = `
  SELECT
${COMPACT_METADATA_COLUMNS},
${COMPACT_FILE_COLUMNS}
  FROM media_metadata mm INDEXED BY idx_metadata_first_seen_hash_desc
  INNER JOIN image_files if ON if.id = (
    SELECT MIN(if2.id)
    FROM image_files if2
    WHERE if2.composite_hash = mm.composite_hash AND if2.file_status = 'active'
  )
`;

/**
 * Count the visible library from `media_metadata` instead of from `image_files`.
 *
 * The previous shape (`image_files` LEFT JOIN `media_metadata`) had to fetch
 * `rating_score`/`postprocess_status` out of every ~11KB metadata row, which
 * meant an overflow-chain walk per row (~2s at 200k rows). Driving from
 * `media_metadata` with an `EXISTS(image_files)` guard keeps the whole count
 * inside the narrow `idx_media_metadata_visibility` covering index (migration
 * 027) while producing the same set: the visibility predicates are unchanged
 * (including their NULL handling), and requiring at least one active file row
 * is exactly what the LEFT JOIN form filtered on.
 */
function buildVisibleWithActiveFileCountQuery(visibleCondition: string, readyCondition: string): string {
  return `
    SELECT COUNT(*) as total
    FROM media_metadata mm
    WHERE ${visibleCondition}
      AND ${readyCondition}
      AND EXISTS (
        SELECT 1
        FROM image_files activefile
        WHERE activefile.composite_hash = mm.composite_hash
          AND activefile.file_status = 'active'
      )
  `;
}

/** Build joined media-metadata queries that require the currently active file row. */
export class MediaMetadataFileQueries {
  /** List active images with file columns for browser views. */
  static findAllWithFiles(options: {
    page?: number;
    limit?: number;
    sortBy?: 'first_seen_date' | 'width' | 'height' | 'scan_date' | 'file_size';
    sortOrder?: 'ASC' | 'DESC';
  }): { items: any[]; total: number } {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const sortBy = options.sortBy || 'first_seen_date';
    const sortOrder = options.sortOrder || 'DESC';
    const offset = (page - 1) * limit;
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();

    const countRow = db.prepare(
      buildVisibleWithActiveFileCountQuery(visibleCondition, readyCondition),
    ).get() as { total: number };

    let orderByClause: string;
    let selectClause = COMPACT_ACTIVE_FILE_WITH_METADATA_SELECT;
    let whereClause = `WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}`;
    if (sortBy === 'scan_date') {
      orderByClause = `ORDER BY if.scan_date ${sortOrder}`;
    } else if (sortBy === 'file_size') {
      orderByClause = `ORDER BY if.file_size ${sortOrder}`;
    } else if (sortBy === 'first_seen_date') {
      selectClause = METADATA_FIRST_SEEN_WITH_ACTIVE_FILE_SELECT;
      whereClause = `WHERE ${visibleCondition} AND ${readyCondition}`;
      orderByClause = `ORDER BY mm.first_seen_date ${sortOrder}, mm.composite_hash ${sortOrder}`;
    } else {
      orderByClause = `ORDER BY mm.${sortBy} ${sortOrder}`;
    }

    const query = `
      ${selectClause}
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `;

    const items = db.prepare(query).all(limit, offset);
    return { items, total: countRow.total };
  }

  /** List active images with cursor pagination for infinite scroll surfaces. */
  static findAllWithFilesCursor(options: {
    limit?: number;
    sortOrder?: 'ASC' | 'DESC';
    cursorDate?: string;
    cursorHash?: string;
    includeTotal?: boolean;
  }): { items: any[]; total: number; hasMore: boolean } {
    const limit = options.limit || 50;
    const sortOrder = options.sortOrder || 'DESC';
    const cursorDate = options.cursorDate;
    const cursorHash = options.cursorHash;
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();

    let cursorCondition = '';
    const queryParams: any[] = [];

    if (cursorDate && cursorHash) {
      if (sortOrder === 'DESC') {
        cursorCondition = `AND (mm.first_seen_date < ? OR (mm.first_seen_date = ? AND mm.composite_hash < ?))`;
      } else {
        cursorCondition = `AND (mm.first_seen_date > ? OR (mm.first_seen_date = ? AND mm.composite_hash > ?))`;
      }
      queryParams.push(cursorDate, cursorDate, cursorHash);
    }

    const query = `
      ${METADATA_FIRST_SEEN_WITH_ACTIVE_FILE_SELECT}
      WHERE ${visibleCondition} AND ${readyCondition}
      ${cursorCondition}
      ORDER BY mm.first_seen_date ${sortOrder}, mm.composite_hash ${sortOrder}
      LIMIT ?
    `;

    queryParams.push(limit + 1);

    const items = db.prepare(query).all(...queryParams);
    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const total = options.includeTotal === true
      ? MediaMetadataFileQueries.countVisibleWithActiveFile()
      : items.length + (hasMore ? 1 : 0);

    return { items, total, hasMore };
  }

  /**
   * Count every visible, post-processed media row that still has an active file.
   *
   * Exposed on its own so the route layer can serve the home feed total from
   * QueryCacheService and keep it off the first-page critical path.
   */
  static countVisibleWithActiveFile(): number {
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();

    const row = db.prepare(
      buildVisibleWithActiveFileCountQuery(visibleCondition, readyCondition),
    ).get() as { total: number } | undefined;

    return row?.total ?? 0;
  }

  /**
   * Load only the columns the media guards need (visibility + thumbnail routing).
   *
   * `media_metadata` rows average ~11KB, so a `SELECT *` guard on a hot media
   * route walks the row overflow chain for every thumbnail request on a page.
   */
  static findVisibilityGuardByHash(compositeHash: string): MediaVisibilityGuardRecord | null {
    const row = db.prepare(`
      SELECT ${getVisibilityGuardColumns()}
      FROM media_metadata
      WHERE composite_hash = ?
    `).get(compositeHash) as MediaVisibilityGuardRecord | undefined;

    return row ?? null;
  }

  /** Load one active image by composite hash with metadata and file columns in a single query. */
  static findByHashWithFile(compositeHash: string, options: { includeHidden?: boolean } = {}): any | null {
    const visibleCondition = options.includeHidden ? '1=1' : getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();
    const query = `
      ${ACTIVE_FILE_WITH_METADATA_SELECT}
      WHERE if.file_status = 'active'
        AND if.composite_hash = ?
        AND ${visibleCondition}
        AND ${readyCondition}
      ORDER BY if.last_verified_date DESC, if.id DESC
      LIMIT 1
    `;

    return db.prepare(query).get(compositeHash) ?? null;
  }

  /** Load joined file rows for a fixed composite-hash set. */
  static findByHashesWithFiles(compositeHashes: string[]): any[] {
    if (compositeHashes.length === 0) return [];

    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();
    const placeholders = compositeHashes.map(() => '?').join(',');
    const query = `
      ${ACTIVE_FILE_WITH_METADATA_SELECT}
      WHERE if.file_status = 'active'
        AND if.composite_hash IN (${placeholders})
        AND ${visibleCondition}
        AND ${readyCondition}
    `;

    return db.prepare(query).all(...compositeHashes);
  }

  /** Pick one random active media row for a specific file type without COUNT/OFFSET scans. */
  static getRandomByFileType(fileType: Extract<FileType, 'image' | 'video'>): any | null {
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();
    const maxFileIdRow = db.prepare(`
      SELECT MAX(id) as maxFileId
      FROM image_files
      WHERE file_status = 'active'
        AND file_type = ?
        AND composite_hash IS NOT NULL
    `).get(fileType) as { maxFileId: number | null };

    if (!maxFileIdRow?.maxFileId) {
      return null;
    }

    const stmt = db.prepare(`
      SELECT
        mm.composite_hash,
        mm.perceptual_hash,
        mm.dhash,
        mm.ahash,
        mm.color_histogram,
        mm.width,
        mm.height,
        mm.thumbnail_path,
        mm.ai_tool,
        mm.model_name,
        mm.lora_models,
        mm.steps,
        mm.cfg_scale,
        mm.sampler,
        mm.seed,
        mm.scheduler,
        mm.prompt,
        mm.negative_prompt,
        mm.denoise_strength,
        mm.generation_time,
        mm.batch_size,
        mm.batch_index,
        mm.auto_tags,
        mm.duration,
        mm.fps,
        mm.video_codec,
        mm.audio_codec,
        mm.bitrate,
        mm.character_prompt_text,
        mm.raw_nai_parameters,
        mm.first_seen_date,
        mm.metadata_updated_date,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status,
        if.scan_date,
        if.file_type
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active'
        AND if.file_type = ?
        AND if.composite_hash IS NOT NULL
        AND ${visibleCondition}
        AND ${readyCondition}
        AND if.id >= ?
      ORDER BY if.id ASC
      LIMIT 1
    `);

    const randomStartId = Math.floor(Math.random() * maxFileIdRow.maxFileId) + 1;
    console.log('[MediaMetadataModel] Random start id:', randomStartId, 'max', maxFileIdRow.maxFileId);

    const row = stmt.get(fileType, randomStartId) ?? stmt.get(fileType, 0);
    console.log(`[MediaMetadataModel] Random ${fileType} selected:`, (row as any)?.composite_hash?.substring(0, 8));

    return row || null;
  }

  /** Pick one random active image row without ORDER BY RANDOM(). */
  static getRandomImage(): any | null {
    return this.getRandomByFileType('image');
  }

  /** Pick one random active video row without ORDER BY RANDOM(). */
  static getRandomVideo(): any | null {
    return this.getRandomByFileType('video');
  }
}
