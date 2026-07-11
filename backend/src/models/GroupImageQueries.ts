import { db } from '../database/init';
import { ImageSafetyService } from '../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../services/mediaPostprocessVisibilityService';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';
import { PAGINATION } from '@conai/shared';

type GroupImageCollectionType = 'manual' | 'auto';
type GroupImageListResult = {
  images: ImageWithFileView[];
  total: number;
  hasMore?: boolean;
  totalKnown?: boolean;
  nextCursorOrderIndex?: number | null;
  nextCursorAddedDate?: string | null;
  nextCursorHash?: string | null;
};
type GroupChildRecord = { id: number };
type FindChildGroups = (groupId: number) => GroupChildRecord[];

function getVisibleGroupImageCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('im.rating_score');
}

function getReadyGroupImageCondition() {
  return MediaPostprocessVisibilityService.buildReadyCondition('im');
}

function getRandomGroupMembershipPivot(groupId: number): number | null {
  const row = db.prepare(`
    SELECT MAX(id) as maxId
    FROM image_groups
    WHERE group_id = ?
  `).get(groupId) as { maxId: number | null } | undefined;

  return row?.maxId ? Math.max(1, Math.floor(Math.random() * row.maxId) + 1) : null;
}

/** Load a bounded preview slice by indexed membership id. */
function findPreviewRowsFromPivot(
  groupId: number,
  pivot: number,
  direction: '>=' | '<',
  limit: number,
): ImageWithFileView[] {
  const query = `
    SELECT
      COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
      im.*,
      if.id as file_id,
      if.original_file_path,
      if.file_status,
      if.file_type,
      if.mime_type,
      if.folder_id,
      f.folder_name
    FROM image_groups ig
    LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.id = (
      SELECT if2.id
      FROM image_files if2
      WHERE if2.composite_hash = ig.composite_hash AND if2.file_status = 'active'
      ORDER BY if2.id DESC
      LIMIT 1
    )
    LEFT JOIN watched_folders f ON if.folder_id = f.id
    WHERE ig.group_id = ?
      AND ig.id ${direction} ?
      AND ${getVisibleGroupImageCondition()}
      AND ${getReadyGroupImageCondition()}
    ORDER BY ig.id ASC
    LIMIT ?
  `;

  return db.prepare(query).all(groupId, pivot, limit) as ImageWithFileView[];
}

/** Pick a random bounded membership slice and wrap at the end. */
function findRandomGroupPreviewRows(groupId: number, count: number): ImageWithFileView[] {
  const pivot = getRandomGroupMembershipPivot(groupId);
  if (pivot === null) {
    return [];
  }

  const rows = findPreviewRowsFromPivot(groupId, pivot, '>=', count);
  if (rows.length < count) {
    rows.push(...findPreviewRowsFromPivot(groupId, pivot, '<', count - rows.length));
  }
  return rows;
}

export function normalizeGroupImagePositiveInteger(
  value: unknown,
  fallback: number,
  max: number = PAGINATION.MAX_LIMIT
): number {
  if (typeof value === 'boolean' || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const floored = Math.floor(parsed);
  return Math.min(Math.max(floored, 1), max);
}

type GroupImageQuerySource = {
  cteClause: string;
  fromClause: string;
  whereClause: string;
  queryParams: (number | string)[];
};

/** Build direct or recursive group membership source while deduplicating descendant images. */
function buildGroupImageQuerySource(
  groupId: number,
  collectionType?: GroupImageCollectionType,
  includeChildren: boolean = false,
): GroupImageQuerySource {
  if (includeChildren) {
    const collectionClause = collectionType ? 'AND source_ig.collection_type = ?' : '';
    return {
      cteClause: `WITH RECURSIVE target_groups(id) AS (
        SELECT ?
        UNION ALL
        SELECT g.id
        FROM groups g
        INNER JOIN target_groups parent ON g.parent_id = parent.id
      )`,
      fromClause: `(
        SELECT
          source_ig.composite_hash,
          MIN(source_ig.order_index) AS order_index,
          MAX(source_ig.added_date) AS added_date,
          CASE
            WHEN SUM(source_ig.collection_type = 'manual') > 0 THEN 'manual'
            ELSE 'auto'
          END AS collection_type
        FROM image_groups source_ig
        WHERE source_ig.group_id IN (SELECT id FROM target_groups)
          AND source_ig.composite_hash IS NOT NULL
          ${collectionClause}
        GROUP BY source_ig.composite_hash
      ) ig`,
      whereClause: 'WHERE ig.composite_hash IS NOT NULL',
      queryParams: collectionType ? [groupId, collectionType] : [groupId],
    };
  }

  let whereClause = 'WHERE ig.group_id = ? AND ig.composite_hash IS NOT NULL';
  const queryParams: (number | string)[] = [groupId];

  if (collectionType) {
    whereClause += ' AND ig.collection_type = ?';
    queryParams.push(collectionType);
  }

  return {
    cteClause: '',
    fromClause: 'image_groups ig',
    whereClause,
    queryParams,
  };
}

/** Find one page of group images while preserving the existing response shape. */
export function findImagesByGroupQuery(
  groupId: number,
  page: number = 1,
  limit: number = 20,
  collectionType?: GroupImageCollectionType,
  cursor?: { orderIndex: number; addedDate: string; compositeHash: string; includeTotal?: boolean },
  includeChildren: boolean = false,
): GroupImageListResult {
  const normalizedPage = normalizeGroupImagePositiveInteger(page, 1);
  const normalizedLimit = normalizeGroupImagePositiveInteger(limit, 20);
  const offset = (normalizedPage - 1) * normalizedLimit;
  const {
    cteClause,
    fromClause,
    whereClause: baseWhereClause,
    queryParams: baseQueryParams,
  } = buildGroupImageQuerySource(groupId, collectionType, includeChildren);
  let whereClause = baseWhereClause;
  const queryParams = [...baseQueryParams];

  if (cursor) {
    whereClause += ` AND (
      ig.order_index > ?
      OR (ig.order_index = ? AND ig.added_date < ?)
      OR (ig.order_index = ? AND ig.added_date = ? AND ig.composite_hash > ?)
    )`;
    queryParams.push(cursor.orderIndex, cursor.orderIndex, cursor.addedDate, cursor.orderIndex, cursor.addedDate, cursor.compositeHash);
  }

  const shouldCountTotal = !cursor || cursor.includeTotal !== false;
  const countRow = shouldCountTotal ? db.prepare(
    `${cteClause}
     SELECT COUNT(*) as total
     FROM ${fromClause}
     LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
     ${baseWhereClause} AND ${getVisibleGroupImageCondition()} AND ${getReadyGroupImageCondition()}`
  ).get(...baseQueryParams) as { total: number } : null;
  const total = countRow?.total ?? 0;

  const query = `
    ${cteClause}
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
      ,ig.order_index as cursor_order_index
      ,ig.added_date as cursor_added_date
    FROM ${fromClause}
    LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    ${whereClause} AND ${getVisibleGroupImageCondition()} AND ${getReadyGroupImageCondition()}
    GROUP BY ig.composite_hash
    ORDER BY ig.order_index ASC, ig.added_date DESC, ig.composite_hash ASC
    LIMIT ?${cursor ? '' : ' OFFSET ?'}
  `;

  const rows = db.prepare(query).all(
    ...queryParams,
    normalizedLimit + (cursor ? 1 : 0),
    ...(cursor ? [] : [offset]),
  ) as Array<ImageWithFileView & { cursor_order_index: number; cursor_added_date: string }>;
  const hasMore = cursor ? rows.length > normalizedLimit : offset + rows.length < total;
  if (cursor && rows.length > normalizedLimit) {
    rows.pop();
  }
  const lastRow = rows.at(-1);

  return {
    images: rows,
    total,
    hasMore,
    totalKnown: shouldCountTotal,
    nextCursorOrderIndex: lastRow?.cursor_order_index ?? null,
    nextCursorAddedDate: lastRow?.cursor_added_date ?? null,
    nextCursorHash: lastRow?.composite_hash ?? null,
  };
}

/** Find one page of group images together with file location fields. */
export function findImagesByGroupWithFilesQuery(
  groupId: number,
  page: number = 1,
  limit: number = 20,
  collectionType?: GroupImageCollectionType
): GroupImageListResult {
  const normalizedPage = normalizeGroupImagePositiveInteger(page, 1);
  const normalizedLimit = normalizeGroupImagePositiveInteger(limit, 20);
  const offset = (normalizedPage - 1) * normalizedLimit;
  const { fromClause, whereClause, queryParams } = buildGroupImageQuerySource(groupId, collectionType);

  const countRow = db.prepare(
    `SELECT COUNT(*) as total
     FROM ${fromClause}
     INNER JOIN media_metadata im ON ig.composite_hash = im.composite_hash
     ${whereClause} AND ${getVisibleGroupImageCondition()} AND ${getReadyGroupImageCondition()}`
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
    FROM ${fromClause}
    INNER JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.composite_hash = im.composite_hash AND if.file_status = 'active'
    LEFT JOIN watched_folders wf ON if.folder_id = wf.id
    ${whereClause} AND ${getVisibleGroupImageCondition()} AND ${getReadyGroupImageCondition()}
    ORDER BY ig.order_index ASC, ig.added_date DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...queryParams, normalizedLimit, offset) as ImageWithFileView[];

  return { images: rows, total };
}

/** Find one random visible image for a group. */
export function findRandomImageForGroupQuery(groupId: number): ImageMetadataRecord | null {
  return findRandomGroupPreviewRows(groupId, 1)[0] ?? null;
}

/** Find preview images for a group and recurse into children when needed. */
export function findPreviewImagesQuery(
  groupId: number,
  count: number = 8,
  includeChildren: boolean = true,
  findChildGroups: FindChildGroups
): ImageWithFileView[] {
  const normalizedCount = normalizeGroupImagePositiveInteger(count, 8, 20);
  const rows = findRandomGroupPreviewRows(groupId, normalizedCount);

  if (rows.length > 0 || !includeChildren) {
    return rows;
  }

  const children = findChildGroups(groupId);
  if (children.length === 0) {
    return [];
  }

  for (const child of children) {
    const childImages = findPreviewImagesQuery(child.id, normalizedCount, true, findChildGroups);
    if (childImages.length > 0) {
      return childImages;
    }
  }

  return [];
}

/** Find all composite hashes for one group in display order. */
export function getCompositeHashesForGroupQuery(groupId: number, includeChildren: boolean = false): string[] {
  const query = includeChildren ? `
    WITH RECURSIVE target_groups(id) AS (
      SELECT ?
      UNION ALL
      SELECT g.id
      FROM groups g
      INNER JOIN target_groups parent ON g.parent_id = parent.id
    )
    SELECT ig.composite_hash
    FROM image_groups ig
    INNER JOIN target_groups target ON target.id = ig.group_id
    GROUP BY ig.composite_hash
    ORDER BY MIN(ig.order_index) ASC, MAX(ig.added_date) DESC
  ` : `
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
