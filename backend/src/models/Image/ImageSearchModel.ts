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
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams, {
      requireCompositeHash: true,
      requireActiveFile: true,
    });

    const safeConditions = [...conditions, getVisibleImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // 총 개수 조회
    const countQuery = `
      SELECT COUNT(DISTINCT im.composite_hash) as total
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ${groupJoinClause}
      ${whereClause}
    `;
    const countRow = db.prepare(countQuery).get(...params) as any;
    const total = countRow.total;

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

    // 데이터 조회 (그룹 정보 포함)
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
      ${groupJoinClause}
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      ${whereClause}
      GROUP BY im.composite_hash
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(dataQuery).all(...params, limit, offset) as any[];

    return { images: mapGroupedImageRows(rows), total };
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
      WHERE im.composite_hash IS NOT NULL AND if.file_status = 'active'
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
      WHERE im.composite_hash IS NOT NULL
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
    searchParams: AutoTagSearchParams,
    basicSearchParams?: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<{ images: any[], total: number }> {
    const page = searchParams.page || 1;
    const limit = searchParams.limit || 20;
    const sortBy = searchParams.sortBy || 'upload_date';
    const sortOrder = searchParams.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    // AutoTagSearchService가 쿼리 조건을 생성 (media_metadata 기반으로 수정 필요)
    const queryBuilder = await AutoTagSearchService.buildAutoTagSearchQuery(searchParams, basicSearchParams);

    // 조건을 media_metadata 테이블 기준으로 변경
    const conditions = queryBuilder.conditions.map((cond: string) => {
      return cond
        .replace(/\bi\.upload_date\b/g, 'im.first_seen_date')
        .replace(/\bi\.prompt\b/g, 'im.prompt')
        .replace(/\bi\.negative_prompt\b/g, 'im.negative_prompt')
        .replace(/\bi\.ai_tool\b/g, 'im.ai_tool')
        .replace(/\bi\.model_name\b/g, 'im.model_name')
        .replace(/\bi\.auto_tags\b/g, 'im.auto_tags');
    });

    const safeConditions = [...conditions, getVisibleImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    // 총 개수 조회
    const countQuery = `
      SELECT COUNT(DISTINCT im.composite_hash) as total
      FROM media_metadata im
      ${whereClause}
    `;

    const countRow = db.prepare(countQuery).get(...queryBuilder.params) as any;
    const total = countRow.total;

    // 정렬 컬럼 매핑
    let sortColumn = 'im.first_seen_date';
    if (sortBy === 'upload_date') {
      sortColumn = 'im.first_seen_date';
    } else if (sortBy === 'file_size') {
      sortColumn = 'if.file_size';
    }

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
      ${whereClause}
      GROUP BY im.composite_hash
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(dataQuery).all(...queryBuilder.params, limit, offset) as any[];

    return { images: mapGroupedImageRows(rows), total };
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
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams, {
      requireCompositeHash: true,
      requireActiveFile: true,
    });

    const safeConditions = [...conditions, getVisibleImageCondition()];
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
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams);

    const safeConditions = [...conditions, getVisibleImageCondition()];
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
   * Using OFFSET with random index for true randomness
   */
  static async getRandomFromSearch(
    searchParams: ImageSearchParamsInput
  ): Promise<any | null> {
    const { conditions, params, groupJoinClause } = buildImageSearchFilterParts(searchParams);

    const safeConditions = [...conditions, getVisibleImageCondition()];
    const whereClause = safeConditions.length > 0 ? `WHERE ${safeConditions.join(' AND ')}` : '';

    // First get the count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ${groupJoinClause}
      ${whereClause}
    `;

    const countRow = db.prepare(countQuery).get(...params) as { total: number };

    if (!countRow || countRow.total === 0) {
      return null;
    }

    // Generate random offset
    const randomOffset = Math.floor(Math.random() * countRow.total);
    console.log('[ImageSearchModel] Random offset:', randomOffset, 'out of', countRow.total);

    // Get the image at that offset
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
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ${groupJoinClause}
      ${whereClause}
      LIMIT 1 OFFSET ?
    `;

    const row = db.prepare(query).get(...params, randomOffset);
    console.log('[ImageSearchModel] Random image selected:', (row as any)?.composite_hash?.substring(0, 8));

    return row || null;
  }
}
