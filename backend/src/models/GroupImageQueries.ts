import { db } from '../database/init';
import { ImageSafetyService } from '../services/imageSafetyService';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';

type GroupImageCollectionType = 'manual' | 'auto';
type GroupImageListResult = { images: ImageWithFileView[]; total: number };
type GroupChildRecord = { id: number };
type FindChildGroups = (groupId: number) => GroupChildRecord[];

function getVisibleGroupImageCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('im.rating_score');
}

/** Build the shared WHERE clause for group image list queries. */
function buildGroupImageWhereClause(
  groupId: number,
  collectionType?: GroupImageCollectionType
): { whereClause: string; queryParams: (number | string)[] } {
  let whereClause = 'WHERE ig.group_id = ? AND ig.composite_hash IS NOT NULL';
  const queryParams: (number | string)[] = [groupId];

  if (collectionType) {
    whereClause += ' AND ig.collection_type = ?';
    queryParams.push(collectionType);
  }

  return { whereClause, queryParams };
}

/** Find one page of group images while preserving the existing response shape. */
export function findImagesByGroupQuery(
  groupId: number,
  page: number = 1,
  limit: number = 20,
  collectionType?: GroupImageCollectionType
): GroupImageListResult {
  const offset = (page - 1) * limit;
  const { whereClause, queryParams } = buildGroupImageWhereClause(groupId, collectionType);

  const countRow = db.prepare(
    `SELECT COUNT(*) as total
     FROM image_groups ig
     LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
     ${whereClause} AND ${getVisibleGroupImageCondition()}`
  ).get(...queryParams) as { total: number };
  const total = countRow.total;

  const query = `
    SELECT
      COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
      im.width,
      im.height,
      im.thumbnail_path,
      im.prompt,
      im.negative_prompt,
      im.seed,
      im.steps,
      im.cfg_scale,
      im.sampler,
      im.model_name as model,
      im.first_seen_date as created_date,
      im.rating_score,
      (SELECT id FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as id,
      (SELECT original_file_path FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as original_file_path,
      (SELECT file_status FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_status,
      (SELECT file_type FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_type,
      (SELECT file_size FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_size,
      (SELECT mime_type FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as mime_type,
      ig.collection_type
    FROM image_groups ig
    LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    ${whereClause} AND ${getVisibleGroupImageCondition()}
    GROUP BY ig.composite_hash
    ORDER BY ig.order_index ASC, ig.added_date DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...queryParams, limit, offset) as ImageWithFileView[];

  if (rows.length > 0) {
    console.log('[DEBUG Group.ts:findImagesByGroup] First row from DB:', {
      composite_hash: rows[0].composite_hash,
      id: rows[0].id,
      file_type: rows[0].file_type,
      mime_type: rows[0].mime_type,
      file_size: rows[0].file_size
    });
  }

  return { images: rows, total };
}

/** Find one page of group images together with file location fields. */
export function findImagesByGroupWithFilesQuery(
  groupId: number,
  page: number = 1,
  limit: number = 20,
  collectionType?: GroupImageCollectionType
): GroupImageListResult {
  const offset = (page - 1) * limit;
  const { whereClause, queryParams } = buildGroupImageWhereClause(groupId, collectionType);

  const countRow = db.prepare(
    `SELECT COUNT(*) as total
     FROM image_groups ig
     INNER JOIN media_metadata im ON ig.composite_hash = im.composite_hash
     ${whereClause} AND ${getVisibleGroupImageCondition()}`
  ).get(...queryParams) as { total: number };
  const total = countRow.total;

  const query = `
    SELECT
      im.*,
      if.id as file_id,
      if.original_file_path,
      if.file_status,
      if.folder_id,
      wf.folder_name
    FROM image_groups ig
    INNER JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.composite_hash = im.composite_hash AND if.file_status = 'active'
    LEFT JOIN watched_folders wf ON if.folder_id = wf.id
    ${whereClause} AND ${getVisibleGroupImageCondition()}
    ORDER BY ig.order_index ASC, ig.added_date DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...queryParams, limit, offset) as ImageWithFileView[];

  return { images: rows, total };
}

/** Find one random visible image for a group. */
export function findRandomImageForGroupQuery(groupId: number): ImageMetadataRecord | null {
  const query = `
    SELECT
      COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
      im.perceptual_hash,
      im.dhash,
      im.ahash,
      im.color_histogram,
      im.width,
      im.height,
      im.thumbnail_path,
      im.ai_tool,
      im.model_name,
      im.lora_models,
      im.steps,
      im.cfg_scale,
      im.sampler,
      im.seed,
      im.scheduler,
      im.prompt,
      im.negative_prompt,
      im.denoise_strength,
      im.generation_time,
      im.batch_size,
      im.batch_index,
      im.auto_tags,
      im.model_references,
      im.character_prompt_text,
      im.raw_nai_parameters,
      im.duration,
      im.fps,
      im.video_codec,
      im.audio_codec,
      im.bitrate,
      im.rating_score,
      im.first_seen_date,
      im.metadata_updated_date
    FROM image_groups ig
    LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    WHERE ig.group_id = ? AND ${getVisibleGroupImageCondition()}
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const row = db.prepare(query).get(groupId) as ImageMetadataRecord | undefined;
  return row || null;
}

/** Find preview images for a group and recurse into children when needed. */
export function findPreviewImagesQuery(
  groupId: number,
  count: number = 8,
  includeChildren: boolean = true,
  findChildGroups: FindChildGroups
): ImageWithFileView[] {
  const query = `
    WITH sampled_hashes AS (
      SELECT ig.composite_hash
      FROM image_groups ig
      LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      WHERE ig.group_id = ? AND ${getVisibleGroupImageCondition()}
      GROUP BY ig.composite_hash
      ORDER BY RANDOM()
      LIMIT ?
    )
    SELECT
      COALESCE(im.composite_hash, sampled_hashes.composite_hash) as composite_hash,
      im.perceptual_hash,
      im.dhash,
      im.ahash,
      im.color_histogram,
      im.width,
      im.height,
      im.thumbnail_path,
      im.ai_tool,
      im.model_name,
      im.lora_models,
      im.steps,
      im.cfg_scale,
      im.sampler,
      im.seed,
      im.scheduler,
      im.prompt,
      im.negative_prompt,
      im.denoise_strength,
      im.generation_time,
      im.batch_size,
      im.batch_index,
      im.auto_tags,
      im.duration,
      im.fps,
      im.video_codec,
      im.audio_codec,
      im.bitrate,
      im.rating_score,
      im.first_seen_date,
      im.metadata_updated_date,
      if.id as file_id,
      if.original_file_path,
      if.file_status,
      if.file_type,
      if.mime_type,
      if.folder_id,
      f.folder_name
    FROM sampled_hashes
    LEFT JOIN media_metadata im ON sampled_hashes.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.id = (
      SELECT if2.id
      FROM image_files if2
      WHERE if2.composite_hash = sampled_hashes.composite_hash
        AND if2.file_status = 'active'
      ORDER BY if2.id DESC
      LIMIT 1
    )
    LEFT JOIN watched_folders f ON if.folder_id = f.id
  `;

  const rows = db.prepare(query).all(groupId, count) as ImageWithFileView[];

  if (rows.length > 0 || !includeChildren) {
    return rows;
  }

  const children = findChildGroups(groupId);
  if (children.length === 0) {
    return [];
  }

  for (const child of children) {
    const childImages = findPreviewImagesQuery(child.id, count, true, findChildGroups);
    if (childImages.length > 0) {
      return childImages;
    }
  }

  return [];
}

/** Find all composite hashes for one group in display order. */
export function getCompositeHashesForGroupQuery(groupId: number): string[] {
  const query = `
    SELECT composite_hash
    FROM image_groups
    WHERE group_id = ?
    ORDER BY order_index ASC, added_date DESC
  `;

  const rows = db.prepare(query).all(groupId) as { composite_hash: string }[];
  return rows.map(row => row.composite_hash);
}

/** Find all active image file ids for one group in selection order. */
export function getImageFileIdsForGroupQuery(groupId: number): number[] {
  const query = `
    SELECT if.id
    FROM image_groups ig
    INNER JOIN image_files if ON ig.composite_hash = if.composite_hash
    WHERE ig.group_id = ?
      AND if.file_status = 'active'
    ORDER BY ig.order_index ASC, ig.added_date DESC, if.id ASC
  `;

  const rows = db.prepare(query).all(groupId) as { id: number }[];
  return rows.map(row => row.id);
}
