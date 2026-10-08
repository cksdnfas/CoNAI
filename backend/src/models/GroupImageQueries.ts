import { db } from '../database/init';
import { ImageSafetyService } from '../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../services/mediaPostprocessVisibilityService';
import { AggregateCache, resolveSearchTotal } from '../services/aggregateCache';
import { buildIdPageResponse, normalizeIdPage, type IdPage, type IdPageResponse } from '../utils/idPage';
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

// Group membership / tree writes bump this row through triggers (migration 043), wherever they come from.
let groupsVersionStatement: { get(): unknown } | null = null;
AggregateCache.setVersionSource('groups', () => {
  try {
    groupsVersionStatement ??= db.prepare("SELECT version FROM aggregate_versions WHERE scope = 'groups'");
    const row = groupsVersionStatement.get() as { version: number } | undefined;
    return row ? row.version : null;
  } catch {
    return null;
  }
});

function getVisibleGroupImageCondition(alias = 'im') {
  return ImageSafetyService.buildVisibleScoreCondition(`${alias}.rating_score`);
}

function getReadyGroupImageCondition(alias = 'im') {
  return MediaPostprocessVisibilityService.buildReadyCondition(alias);
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

function hasChildGroups(groupId: number): boolean {
  return !!db.prepare('SELECT 1 FROM groups WHERE parent_id = ? LIMIT 1').get(groupId);
}

/** Build direct or recursive group membership source while deduplicating descendant images. */
function buildGroupImageQuerySource(
  groupId: number,
  collectionType?: GroupImageCollectionType,
  includeChildren: boolean = false,
): GroupImageQuerySource {
  if (includeChildren && hasChildGroups(groupId)) {
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

  // Two phases. The inner page picks the page's memberships in display order, reading only the visibility columns
  // (covered by idx_media_metadata_hash_visibility); for a direct group idx_image_groups_group_order serves the
  // ORDER BY, so it is an index walk that stops at LIMIT. Only the page's rows then join the metadata columns and one
  // deterministically chosen active file row. Membership rows are already one per hash (UNIQUE(group_id, hash) for
  // a direct group, GROUP BY in the descendant source), so no outer GROUP BY is needed.
  const query = `
    ${cteClause}
    SELECT
      COALESCE(im.composite_hash, page.composite_hash) as composite_hash,
      im.width,
      im.height,
      im.thumbnail_path,
      im.rating_score,
      im.first_seen_date,
      im.metadata_updated_date,
      if.id as id,
      if.original_file_path,
      if.file_status,
      if.file_type,
      if.file_size,
      if.mime_type,
      if.scan_date,
      page.collection_type
      ,page.order_index as cursor_order_index
      ,page.added_date as cursor_added_date
    FROM (
      SELECT ig.composite_hash, ig.order_index, ig.added_date, ig.collection_type
      FROM ${fromClause}
      LEFT JOIN media_metadata vis ON ig.composite_hash = vis.composite_hash
      ${whereClause} AND ${getVisibleGroupImageCondition('vis')} AND ${getReadyGroupImageCondition('vis')}
      ORDER BY ig.order_index ASC, ig.added_date DESC, ig.composite_hash ASC
      LIMIT ?${cursor ? '' : ' OFFSET ?'}
    ) page
    LEFT JOIN media_metadata im ON page.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.id = (
      SELECT MIN(if2.id)
      FROM image_files if2
      WHERE if2.composite_hash = page.composite_hash AND if2.file_status = 'active'
    )
    ORDER BY page.order_index ASC, page.added_date DESC, page.composite_hash ASC
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
    ORDER BY ig.order_index ASC, ig.added_date DESC, ig.composite_hash ASC, if.id ASC
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

export type GroupVisibleImageCounts = {
  /** Visible images directly in the group. */
  own: number;
  /** Visible images in the group and all descendants, each image counted once. */
  total: number;
};

/**
 * Count visible images for every group in one pass, own and descendant-inclusive.
 *
 * Uses the same membership source and filters as the in-group list count
 * (`findImagesByGroupQuery` with includeChildren and no collection filter), so
 * tree/card counts match the total shown inside the group. Visibility rules are
 * global (rating tiers, postprocess state), not per requester.
 * Visibility is resolved once per membership (materialized) before fanning out to
 * ancestors; the rest scales with memberships x group depth (~150ms for 120k
 * memberships / 400 groups in a synthetic test). `ancestry` uses UNION so a
 * corrupt parent cycle terminates instead of recursing forever.
 *
 * The group tree asks for these on every load, so the result is cached until group
 * membership or the library changes (see AggregateCache).
 */
export function countVisibleImagesByGroupQuery(): Map<number, GroupVisibleImageCounts> {
  const visibleCondition = getVisibleGroupImageCondition();
  const readyCondition = getReadyGroupImageCondition();
  const cached = AggregateCache.resolve(
    `group-visible-counts:${visibleCondition}:${readyCondition}`,
    () => computeVisibleImagesByGroup(visibleCondition, readyCondition),
    { scopes: ['groups', 'library'] },
  );
  return new Map(cached);
}

function computeVisibleImagesByGroup(visibleCondition: string, readyCondition: string): Array<[number, GroupVisibleImageCounts]> {
  const rows = db.prepare(`
    WITH RECURSIVE ancestry(ancestor_id, group_id) AS (
      SELECT id, id FROM groups
      UNION
      SELECT ancestry.ancestor_id, child.id
      FROM groups child
      INNER JOIN ancestry ON child.parent_id = ancestry.group_id
    ),
    visible_memberships(group_id, composite_hash) AS MATERIALIZED (
      SELECT ig.group_id, ig.composite_hash
      FROM image_groups ig
      LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      WHERE ig.composite_hash IS NOT NULL
        AND ${visibleCondition}
        AND ${readyCondition}
    )
    SELECT
      ancestry.ancestor_id AS group_id,
      SUM(ancestry.group_id = ancestry.ancestor_id) AS own_count,
      COUNT(DISTINCT visible.composite_hash) AS total_count
    FROM ancestry
    INNER JOIN visible_memberships visible ON visible.group_id = ancestry.group_id
    GROUP BY ancestry.ancestor_id
  `).all() as Array<{ group_id: number; own_count: number; total_count: number }>;

  return rows.map((row) => [row.group_id, { own: row.own_count, total: row.total_count }]);
}

/** Find all composite hashes for one group in display order. */
export function getCompositeHashesForGroupQuery(groupId: number, includeChildren: boolean = false): string[] {
  const query = includeChildren && hasChildGroups(groupId) ? `
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

/** One page of active image file ids for a group in selection order (the whole list when it fits a page). */
export function getImageFileIdsForGroupQuery(groupId: number, page: IdPage = normalizeIdPage(null)): IdPageResponse<number> {
  const fromWhere = `
    FROM image_groups ig
    INNER JOIN image_files if ON ig.composite_hash = if.composite_hash
    WHERE ig.group_id = ?
      AND if.file_status = 'active'
  `;
  const rows = db.prepare(`
    SELECT if.id
    ${fromWhere}
    ORDER BY ig.order_index ASC, ig.added_date DESC, if.id ASC
    LIMIT ? OFFSET ?
  `).all(groupId, page.limit + 1, page.offset) as { id: number }[];

  return buildIdPageResponse(rows.map(row => row.id), page, () => resolveSearchTotal('groupImageFileIds', [fromWhere], [groupId], () => (
    (db.prepare(`SELECT COUNT(*) as total ${fromWhere}`).get(groupId) as { total: number }).total
  )));
}
