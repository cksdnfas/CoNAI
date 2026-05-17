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

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
    `).get() as { total: number };

    let orderByClause: string;
    if (sortBy === 'scan_date') {
      orderByClause = `ORDER BY if.scan_date ${sortOrder}`;
    } else if (sortBy === 'file_size') {
      orderByClause = `ORDER BY if.file_size ${sortOrder}`;
    } else if (sortBy === 'first_seen_date') {
      orderByClause = `ORDER BY mm.first_seen_date ${sortOrder}`;
    } else {
      orderByClause = `ORDER BY mm.${sortBy} ${sortOrder}`;
    }

    const query = `
      ${ACTIVE_FILE_WITH_METADATA_SELECT}
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
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
  }): { items: any[]; total: number; hasMore: boolean } {
    const limit = options.limit || 50;
    const sortOrder = options.sortOrder || 'DESC';
    const cursorDate = options.cursorDate;
    const cursorHash = options.cursorHash;
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
    `).get() as { total: number };

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
      ${ACTIVE_FILE_WITH_METADATA_SELECT}
      WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
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

    return { items, total: countRow.total, hasMore };
  }

  /** Load one active visible image by composite hash with metadata and file columns in a single query. */
  static findByHashWithFile(compositeHash: string): any | null {
    const visibleCondition = getVisibleMediaMetadataCondition();
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

  /** Pick one random active media row for a specific file type without ORDER BY RANDOM(). */
  static getRandomByFileType(fileType: Extract<FileType, 'image' | 'video'>): any | null {
    const visibleCondition = getVisibleMediaMetadataCondition();
    const readyCondition = getReadyMediaMetadataCondition();
    const countStmt = db.prepare(`
      SELECT COUNT(*) as total
      FROM image_files if
      LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
      WHERE if.file_status = 'active' AND if.file_type = ? AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
    `);
    const countRow = countStmt.get(fileType) as { total: number };

    if (!countRow || countRow.total === 0) {
      return null;
    }

    const randomOffset = Math.floor(Math.random() * countRow.total);
    console.log('[MediaMetadataModel] Random offset:', randomOffset, 'out of', countRow.total);

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
      WHERE if.file_status = 'active' AND if.file_type = ? AND if.composite_hash IS NOT NULL AND ${visibleCondition} AND ${readyCondition}
      LIMIT 1 OFFSET ?
    `);

    const row = stmt.get(fileType, randomOffset);
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
