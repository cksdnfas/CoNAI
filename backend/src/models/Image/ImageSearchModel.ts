import { db } from '../../database/init';
import { AutoTagSearchParams } from '../../types/autoTag';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { ImageWithFileView } from '../../types/image';
import {
  appendPositivePromptSearchCondition,
  buildImageSearchFilterParts,
  mapGroupedImageRows,
  type ImageSearchParamsInput,
} from './ImageSearchHelpers';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';

/**
 * 이미지 검색 모델 (새 구조 기반)
 *
 * ✅ 새 구조 전환 완료: media_metadata + image_files 기반
 *
 * 변경사항:
 * - images 테이블 → media_metadata + image_files JOIN
 * - image_id → composite_hash
 * - upload_date → first_seen_date
 * - 모든 기존 기능 유지
 */
function getVisibleImageCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('im.rating_score');
}

function getReadyImageCondition() {
  return MediaPostprocessVisibilityService.buildReadyCondition('im');
}

/**
 * Shared search total cache.
 *
 * Every search runs its WHERE clause twice: once as `COUNT(DISTINCT …)` for the
 * total and once for the page. The count is the expensive half — it cannot stop
 * early the way an ordered `LIMIT` page can — and the answer barely moves between
 * two consecutive requests from the same user. Caching it for 30s removes the
 * duplicate execution from the request path without changing the response shape.
 *
 * Originally written for `searchByAutoTags`; `advancedSearch` now shares it
 * (HEAVY-1), which is why the naming is search-generic.
 */
const SEARCH_TOTAL_CACHE_TTL_MS = 30_000;
const SEARCH_TOTAL_CACHE_MAX_ENTRIES = 250;

type SearchTotalCacheEntry = {
  total: number;
  expiresAt: number;
};

const searchTotalCache = new Map<string, SearchTotalCacheEntry>();

function getSearchTotalCacheKey(scope: string, conditions: string[], params: unknown[]): string {
  return JSON.stringify({ scope, conditions, params });
}

function getCachedSearchTotal(cacheKey: string, now = Date.now()): number | null {
  const cached = searchTotalCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    searchTotalCache.delete(cacheKey);
    return null;
  }

  return cached.total;
}

function setCachedSearchTotal(cacheKey: string, total: number, now = Date.now()): void {
  if (searchTotalCache.size >= SEARCH_TOTAL_CACHE_MAX_ENTRIES) {
    const oldestKey = searchTotalCache.keys().next().value;
    if (oldestKey) {
      searchTotalCache.delete(oldestKey);
    }
  }

  searchTotalCache.set(cacheKey, {
    total,
    expiresAt: now + SEARCH_TOTAL_CACHE_TTL_MS,
  });
}

/** Resolve a search total from cache, computing it at most once per TTL. */
function resolveSearchTotal(scope: string, conditions: string[], params: unknown[], compute: () => number): number {
  const cacheKey = getSearchTotalCacheKey(scope, conditions, params);
  const cached = getCachedSearchTotal(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const total = compute();
  setCachedSearchTotal(cacheKey, total);
  return total;
}

export class ImageSearchModel {

  /**
   * 고급 검색 (필터, 정렬, 그룹 포함)
   * @param searchParams 검색 조건
   * @param page 페이지 번호
   * @param limit 페이지당 항목 수
   * @param sortBy 정렬 기준
   * @param sortOrder 정렬 순서
   * @returns 이미지 목록 및 총 개수
   */
  static async advancedSearch(
    searchParams: ImageSearchParamsInput,
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    cursor?: { useCursor?: boolean; value?: string | number | null; compositeHash?: string; includeTotal?: boolean },
  ): Promise<{ images: any[], total: number; hasMore?: boolean; totalKnown?: boolean; nextCursorValue?: string | number | null; nextCursorHash?: string | null }> {
    // Sorting by file size is the only mode that needs `image_files` columns; every
    // other mode can state "has an active file" as an EXISTS and let the planner
    // drive from media_metadata's date index instead of scanning every active file.
    const wantsFileSizeSort = sortBy === 'file_size';
    const { conditions, params, groupJoinClause, requiresFileJoin, canDuplicateRows } = buildImageSearchFilterParts(searchParams, {
      requireCompositeHash: true,
      requireActiveFile: true,
      activeFileMode: wantsFileSizeSort ? 'join' : 'exists',
    });

    const fileJoinClause = requiresFileJoin || wantsFileSizeSort
      ? "LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'"
      : '';
    const collapseRows = canDuplicateRows || fileJoinClause !== '';

    const safeConditions = [...conditions, getVisibleImageCondition(), getReadyImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const shouldCountTotal = !cursor?.useCursor || cursor.includeTotal !== false;
    let total = 0;
    if (shouldCountTotal) {
      // A total has to visit every match, so it can never terminate early the way
      // the page query can. That flips the trade-off: the prompt index is faster
      // there at any match width, so the count builds its own condition set with
      // the width probe disabled.
      const countParts = buildImageSearchFilterParts(searchParams, {
        requireCompositeHash: true,
        requireActiveFile: true,
        activeFileMode: wantsFileSizeSort ? 'join' : 'exists',
        promptIndexMode: 'always',
      });
      const countConditions = [...countParts.conditions, getVisibleImageCondition(), getReadyImageCondition()];
      const countFileJoin = countParts.requiresFileJoin || wantsFileSizeSort
        ? "LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'"
        : '';
      const countCollapse = countParts.canDuplicateRows || countFileJoin !== '';
      const countQuery = `
        SELECT ${countCollapse ? 'COUNT(DISTINCT im.composite_hash)' : 'COUNT(*)'} as total
        FROM media_metadata im
        ${countFileJoin}
        ${countParts.groupJoinClause}
        WHERE ${countConditions.join(' AND ')}
      `;
      total = resolveSearchTotal('advancedSearch', countConditions, countParts.params, () => {
        const countRow = db.prepare(countQuery).get(...countParts.params) as any;
        return countRow.total as number;
      });
    }

    // 정렬 컬럼 매핑 (upload_date → first_seen_date, filename은 제거)
    let sortColumn = 'im.first_seen_date';
    if (sortBy === 'upload_date') {
      sortColumn = 'im.first_seen_date';
    } else if (sortBy === 'file_size') {
      sortColumn = 'if.file_size';
    } else if (sortBy === 'width') {
      sortColumn = 'im.width';
    } else if (sortBy === 'height') {
      sortColumn = 'im.height';
    } else if (sortBy === 'filename') {
      // filename은 더 이상 없으므로 first_seen_date로 대체
      sortColumn = 'im.first_seen_date';
    }
    const cursorDirection = sortOrder === 'ASC' ? '>' : '<';
    const hasCursor = cursor?.useCursor && cursor.value !== undefined && cursor.compositeHash;
    const cursorClause = hasCursor
      ? `AND (${sortColumn} ${cursorDirection} ? OR (${sortColumn} = ? AND im.composite_hash ${cursorDirection} ?))`
      : '';
    const cursorParams = hasCursor ? [cursor.value, cursor.value, cursor.compositeHash] : [];

    // 1단계: 페이지에 들어갈 composite_hash만 정렬 인덱스로 확정.
    //
    // The page used to be resolved by one wide query: `im.*` plus four
    // GROUP_CONCATs over the group joins, grouped and sorted across the whole
    // match set. That forced a temp b-tree for every match even when only 20 rows
    // were wanted, so a broad search paid for the entire library. Selecting just
    // the hashes lets `ORDER BY … LIMIT` stop at the page boundary; the wide
    // columns are then fetched for exactly those 20 rows.
    const pageQuery = `
      SELECT im.composite_hash, ${sortColumn} AS cursor_value
      FROM media_metadata im
      ${fileJoinClause}
      ${groupJoinClause}
      ${whereClause}
      ${cursorClause}
      ${collapseRows ? 'GROUP BY im.composite_hash' : ''}
      ORDER BY ${sortColumn} ${sortOrder}, im.composite_hash ${sortOrder}
      LIMIT ?${cursor?.useCursor ? '' : ' OFFSET ?'}
    `;

    const pageRows = db.prepare(pageQuery).all(
      ...params,
      ...cursorParams,
      limit + (cursor?.useCursor ? 1 : 0),
      ...(cursor?.useCursor ? [] : [offset]),
    ) as Array<{ composite_hash: string; cursor_value: string | number | null }>;

    const hasMore = cursor?.useCursor ? pageRows.length > limit : page * limit < total;
    if (cursor?.useCursor && pageRows.length > limit) {
      pageRows.pop();
    }
    const lastPageRow = pageRows.at(-1);

    if (pageRows.length === 0) {
      return {
        images: [],
        total,
        hasMore: cursor?.useCursor ? false : hasMore,
        totalKnown: shouldCountTotal,
        nextCursorValue: null,
        nextCursorHash: null,
      };
    }

    // 2단계: 확정된 해시에 대해서만 넓은 컬럼과 그룹 정보를 읽는다.
    const pageHashes = pageRows.map((row) => row.composite_hash);
    const pageHashPlaceholders = pageHashes.map(() => '?').join(', ');
    const pageOrderCase = pageHashes.map((_, index) => `WHEN ? THEN ${index}`).join(' ');

    const dataQuery = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id,
        GROUP_CONCAT(DISTINCT g.id) as group_ids,
        GROUP_CONCAT(DISTINCT g.name) as group_names,
        GROUP_CONCAT(DISTINCT g.color) as group_colors,
        GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      WHERE im.composite_hash IN (${pageHashPlaceholders})
      GROUP BY im.composite_hash
      ORDER BY CASE im.composite_hash ${pageOrderCase} ELSE ${pageHashes.length} END
    `;

    const rows = db.prepare(dataQuery).all(...pageHashes, ...pageHashes) as any[];

    return {
      images: mapGroupedImageRows(rows),
      total,
      hasMore,
      totalKnown: shouldCountTotal,
      nextCursorValue: lastPageRow?.cursor_value ?? null,
      nextCursorHash: lastPageRow?.composite_hash ?? null,
    };
  }

  /**
   * 그룹 정보 포함 전체 조회
   */
  static async findWithGroups(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    const offset = (page - 1) * limit;

    // 총 개수 조회 (composite_hash 있는 것만)
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash IS NOT NULL AND if.file_status = 'active' AND ${getReadyImageCondition()}
    `).get() as any;
    const total = countRow.total;

    // 정렬 컬럼 매핑
    let sortColumn = 'im.first_seen_date';
    if (sortBy === 'upload_date') {
      sortColumn = 'im.first_seen_date';
    } else if (sortBy === 'file_size') {
      sortColumn = 'if.file_size';
    } else if (sortBy === 'filename') {
      sortColumn = 'im.first_seen_date';
    }

    const query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id,
        GROUP_CONCAT(g.id) as group_ids,
        GROUP_CONCAT(g.name) as group_names,
        GROUP_CONCAT(g.color) as group_colors,
        GROUP_CONCAT(ig.collection_type) as collection_types
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      WHERE im.composite_hash IS NOT NULL AND ${getReadyImageCondition()}
      GROUP BY im.composite_hash
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(limit, offset) as any[];

    return { images: mapGroupedImageRows(rows), total };
  }

  /**
   * 자동 태그 기반 검색
   */
  static async searchByAutoTags(
    searchParams: AutoTagSearchParams & {
      pagination?: 'offset' | 'cursor';
      cursorValue?: string | number | null;
      cursorHash?: string;
      includeTotal?: boolean;
    },
    basicSearchParams?: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<{ images: any[], total: number; hasMore: boolean; totalKnown: boolean; nextCursorValue?: string | number | null; nextCursorHash?: string | null }> {
    const page = searchParams.page || 1;
    const limit = searchParams.limit || 20;
    const sortBy = searchParams.sortBy || 'upload_date';
    const sortOrder = searchParams.sortOrder || 'DESC';
    const offset = (page - 1) * limit;
    const useCursor = searchParams.pagination === 'cursor';
    const shouldCountTotal = !useCursor || searchParams.includeTotal !== false;

    // AutoTagSearchService가 쿼리 조건을 생성 (media_metadata 기반으로 수정 필요)
    const queryBuilder = await AutoTagSearchService.buildAutoTagSearchQuery(searchParams, basicSearchParams);

    const mapAutoTagConditionAliases = (cond: string) => cond
        .replace(/\bi\.upload_date\b/g, 'im.first_seen_date')
        .replace(/\bi\.prompt\b/g, 'im.prompt')
        .replace(/\bi\.negative_prompt\b/g, 'im.negative_prompt')
        .replace(/\bi\.ai_tool\b/g, 'im.ai_tool')
        .replace(/\bi\.model_name\b/g, 'im.model_name')
        .replace(/\bi\.auto_tags\b/g, 'im.auto_tags')
        .replace(/\bi\.rating_score\b/g, 'im.rating_score')
        .replace(/\bi\.composite_hash\b/g, 'im.composite_hash');

    // 조건을 media_metadata 테이블 기준으로 변경
    const conditions = queryBuilder.conditions.map(mapAutoTagConditionAliases);
    const orderedConditions = (queryBuilder.orderedConditions ?? queryBuilder.conditions)
      .map(mapAutoTagConditionAliases);

    const safeConditions = [...conditions, getVisibleImageCondition(), getReadyImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    // 총 개수 조회
    const countQuery = `
      SELECT COUNT(DISTINCT im.composite_hash) as total
      FROM media_metadata im
      ${whereClause}
    `;

    let total = 0;
    if (shouldCountTotal) {
      total = resolveSearchTotal('searchByAutoTags', safeConditions, queryBuilder.params, () => {
        const countRow = db.prepare(countQuery).get(...queryBuilder.params) as any;
        return countRow.total as number;
      });
    }

    // 정렬 컬럼 매핑
    let sortColumn = 'im.first_seen_date';
    if (sortBy === 'upload_date') {
      sortColumn = 'im.first_seen_date';
    } else if (sortBy === 'file_size') {
      sortColumn = 'if.file_size';
    }

    const pageJoinClause = sortBy === 'file_size'
      ? "LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'"
      : '';
    const pageGroupClause = sortBy === 'file_size' ? 'GROUP BY im.composite_hash' : '';

    const pageSafeConditions = [...orderedConditions, getVisibleImageCondition(), getReadyImageCondition()];
    if (useCursor && searchParams.cursorValue !== undefined && searchParams.cursorHash) {
      const cursorDirection = sortOrder === 'ASC' ? '>' : '<';
      pageSafeConditions.push(`(${sortColumn} ${cursorDirection} ? OR (${sortColumn} = ? AND im.composite_hash ${cursorDirection} ?))`);
      queryBuilder.params.push(searchParams.cursorValue, searchParams.cursorValue, searchParams.cursorHash);
    }
    const pageWhereClause = pageSafeConditions.length > 0 ? `WHERE ${pageSafeConditions.join(' AND ')}` : '';

    const pageHashQuery = `
      SELECT im.composite_hash, ${sortColumn} as cursor_value
      FROM media_metadata im
      ${pageJoinClause}
      ${pageWhereClause}
      ${pageGroupClause}
      ORDER BY ${sortColumn} ${sortOrder}, im.composite_hash ${sortOrder}
      LIMIT ?${useCursor ? '' : ' OFFSET ?'}
    `;

    const pageHashRows = db.prepare(pageHashQuery).all(
      ...queryBuilder.params,
      limit + (useCursor ? 1 : 0),
      ...(useCursor ? [] : [offset]),
    ) as Array<{ composite_hash: string; cursor_value: string | number | null }>;
    const hasMore = useCursor ? pageHashRows.length > limit : page * limit < total;
    if (useCursor && pageHashRows.length > limit) {
      pageHashRows.pop();
    }
    const pageHashes = pageHashRows.map((row) => row.composite_hash);

    if (pageHashes.length === 0) {
      return { images: [], total, hasMore: false, totalKnown: shouldCountTotal, nextCursorValue: null, nextCursorHash: null };
    }

    const pageHashPlaceholders = pageHashes.map(() => '?').join(', ');
    const pageOrderCase = pageHashes.map((_, index) => `WHEN ? THEN ${index}`).join(' ');

    // 데이터 조회
    const dataQuery = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id,
        GROUP_CONCAT(DISTINCT g.id) as group_ids,
        GROUP_CONCAT(DISTINCT g.name) as group_names,
        GROUP_CONCAT(DISTINCT g.color) as group_colors,
        GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      WHERE im.composite_hash IN (${pageHashPlaceholders})
      GROUP BY im.composite_hash
      ORDER BY CASE im.composite_hash ${pageOrderCase} ELSE ${pageHashes.length} END
    `;

    const rows = db.prepare(dataQuery).all(...pageHashes, ...pageHashes) as any[];

    const lastPageHash = pageHashRows.at(-1);
    return {
      images: mapGroupedImageRows(rows),
      total,
      hasMore,
      totalKnown: shouldCountTotal,
      nextCursorValue: lastPageHash?.cursor_value ?? null,
      nextCursorHash: lastPageHash?.composite_hash ?? null,
    };
  }

  /**
   * 검색 조건에 맞는 이미지 composite_hash 목록 조회 (랜덤 선택용)
   * ✅ 완전히 composite_hash 기반으로 전환됨 (string[] 반환)
   */
  static async searchImageIds(
    searchParams: ImageSearchParamsInput
  ): Promise<string[]> {
    // searchCompositeHashes() 메서드로 위임
    return this.searchCompositeHashes(searchParams);
  }

  /**
   * image_files.id 목록 조회 (선택 기능용 - 중복 이미지 개별 선택 가능)
   * @returns image_files.id 숫자 배열
   */
  static async searchImageFileIds(
    searchParams: ImageSearchParamsInput
  ): Promise<number[]> {
    // No LIMIT here: every match is returned, so the index helps at any width.
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams, {
      requireCompositeHash: true,
      requireActiveFile: true,
      promptIndexMode: 'always',
    });

    const safeConditions = [...conditions, getVisibleImageCondition(), getReadyImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    const query = `
      SELECT if.id
      FROM media_metadata im
      INNER JOIN image_files if ON im.composite_hash = if.composite_hash
      ${groupJoinClause}
      ${whereClause}
      ORDER BY im.first_seen_date DESC, if.id ASC
    `;

    const rows = db.prepare(query).all(...params) as Array<{ id: number }>;
    return rows.map(row => row.id);
  }

  /**
   * composite_hash 목록 조회 (새 코드용)
   * @returns composite_hash 문자열 배열
   */
  static async searchCompositeHashes(
    searchParams: ImageSearchParamsInput
  ): Promise<string[]> {
    // No LIMIT here either: the whole match set is materialised for the caller.
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams, {
      promptIndexMode: 'always',
    });

    const safeConditions = [...conditions, getVisibleImageCondition(), getReadyImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    const query = `
      SELECT DISTINCT im.composite_hash
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ${groupJoinClause}
      ${whereClause}
      ORDER BY im.first_seen_date DESC
    `;

    const rows = db.prepare(query).all(...params) as { composite_hash: string }[];
    return rows.map(row => row.composite_hash);
  }

  /**
   * 검색 조건에 맞는 랜덤 이미지 조회
   * Uses an indexed file-id start point instead of count + deep OFFSET scans.
   */
  static async getRandomFromSearch(
    searchParams: ImageSearchParamsInput
  ): Promise<any | null> {
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams, {
      requireCompositeHash: true,
      requireActiveFile: true,
    });

    const safeConditions = [...conditions, getVisibleImageCondition(), getReadyImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    const maxFileIdRow = db.prepare(`
      SELECT MAX(id) as maxFileId
      FROM image_files
      WHERE file_status = 'active'
        AND composite_hash IS NOT NULL
    `).get() as { maxFileId: number | null };

    if (!maxFileIdRow?.maxFileId) {
      return null;
    }

    const query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id,
        if.file_type
      FROM image_files if
      INNER JOIN media_metadata im ON if.composite_hash = im.composite_hash
      ${groupJoinClause}
      ${whereClause}
        AND if.id >= ?
      ORDER BY if.id ASC
      LIMIT 1
    `;

    const randomStartId = Math.floor(Math.random() * maxFileIdRow.maxFileId) + 1;
    console.log('[ImageSearchModel] Random start id:', randomStartId, 'max', maxFileIdRow.maxFileId);

    const stmt = db.prepare(query);
    const row = stmt.get(...params, randomStartId) ?? stmt.get(...params, 0);
    console.log('[ImageSearchModel] Random image selected:', (row as any)?.composite_hash?.substring(0, 8));

    return row || null;
  }
}
