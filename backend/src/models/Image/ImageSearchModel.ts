import { db } from '../../database/init';
import { AutoTagSearchParams } from '../../types/autoTag';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { ImageWithFileView } from '../../types/image';

/**
 * 이미지 검색 모델 (새 구조 기반)
 *
 * ✅ 새 구조 전환 완료: image_metadata + image_files 기반
 *
 * 변경사항:
 * - images 테이블 → image_metadata + image_files JOIN
 * - image_id → composite_hash
 * - upload_date → first_seen_date
 * - 모든 기존 기능 유지
 */
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
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    },
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    // 프롬프트 검색
    if (searchParams.search_text) {
      conditions.push('im.prompt LIKE ?');
      params.push(`%${searchParams.search_text}%`);
    }
    if (searchParams.negative_text) {
      conditions.push('im.negative_prompt LIKE ?');
      params.push(`%${searchParams.negative_text}%`);
    }

    // AI 도구 및 모델
    if (searchParams.ai_tool) {
      conditions.push('im.ai_tool = ?');
      params.push(searchParams.ai_tool);
    }
    if (searchParams.model_name) {
      conditions.push('im.model_name LIKE ?');
      params.push(`%${searchParams.model_name}%`);
    }

    // 이미지 크기 필터
    if (searchParams.min_width) {
      conditions.push('im.width >= ?');
      params.push(searchParams.min_width);
    }
    if (searchParams.max_width) {
      conditions.push('im.width <= ?');
      params.push(searchParams.max_width);
    }
    if (searchParams.min_height) {
      conditions.push('im.height >= ?');
      params.push(searchParams.min_height);
    }
    if (searchParams.max_height) {
      conditions.push('im.height <= ?');
      params.push(searchParams.max_height);
    }

    // 파일 크기 필터 (image_files 테이블)
    if (searchParams.min_file_size) {
      conditions.push('if.file_size >= ?');
      params.push(searchParams.min_file_size);
    }
    if (searchParams.max_file_size) {
      conditions.push('if.file_size <= ?');
      params.push(searchParams.max_file_size);
    }

    // 날짜 범위 필터
    if (searchParams.start_date) {
      conditions.push('DATE(im.first_seen_date) >= DATE(?)');
      params.push(searchParams.start_date);
    }
    if (searchParams.end_date) {
      conditions.push('DATE(im.first_seen_date) <= DATE(?)');
      params.push(searchParams.end_date);
    }

    // 그룹 필터 (composite_hash 기반)
    let groupJoinClause = '';
    if (searchParams.group_id !== undefined) {
      if (searchParams.group_id === 0) {
        // 그룹 없는 이미지
        groupJoinClause = 'LEFT JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.composite_hash IS NULL');
      } else {
        // 특정 그룹의 이미지
        groupJoinClause = 'INNER JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.group_id = ?');
        params.push(searchParams.group_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // 총 개수 조회
    const countQuery = `
      SELECT COUNT(DISTINCT im.composite_hash) as total
      FROM image_metadata im
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
      FROM image_metadata im
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

    // 그룹 정보 변환
    const enrichedImages = rows.map(row => ({
      ...row,
      // 레거시 호환: composite_hash를 id로도 제공
      id: row.composite_hash,
      // 레거시 호환: first_seen_date를 upload_date로도 제공
      upload_date: row.first_seen_date,
      // 그룹 배열로 변환
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
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

    // 총 개수 조회
    const countRow = db.prepare('SELECT COUNT(*) as total FROM image_metadata').get() as any;
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
      FROM image_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      GROUP BY im.composite_hash
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(limit, offset) as any[];

    const enrichedImages = rows.map(row => ({
      ...row,
      id: row.composite_hash,
      upload_date: row.first_seen_date,
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
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

    // AutoTagSearchService가 쿼리 조건을 생성 (image_metadata 기반으로 수정 필요)
    const queryBuilder = await AutoTagSearchService.buildAutoTagSearchQuery(searchParams, basicSearchParams);

    // 조건을 image_metadata 테이블 기준으로 변경
    const conditions = queryBuilder.conditions.map((cond: string) => {
      return cond
        .replace(/\bi\.upload_date\b/g, 'im.first_seen_date')
        .replace(/\bi\.prompt\b/g, 'im.prompt')
        .replace(/\bi\.negative_prompt\b/g, 'im.negative_prompt')
        .replace(/\bi\.ai_tool\b/g, 'im.ai_tool')
        .replace(/\bi\.model_name\b/g, 'im.model_name')
        .replace(/\bi\.auto_tags\b/g, 'im.auto_tags');
    });

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 총 개수 조회
    const countQuery = `
      SELECT COUNT(DISTINCT im.composite_hash) as total
      FROM image_metadata im
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
      FROM image_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
      LEFT JOIN groups g ON ig.group_id = g.id
      ${whereClause}
      GROUP BY im.composite_hash
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(dataQuery).all(...queryBuilder.params, limit, offset) as any[];

    const enrichedImages = rows.map(row => ({
      ...row,
      id: row.composite_hash,
      upload_date: row.first_seen_date,
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
  }

  /**
   * 검색 조건에 맞는 이미지 composite_hash 목록 조회 (랜덤 선택용)
   * ✅ 완전히 composite_hash 기반으로 전환됨 (string[] 반환)
   */
  static async searchImageIds(
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    }
  ): Promise<string[]> {
    // searchCompositeHashes() 메서드로 위임
    return this.searchCompositeHashes(searchParams);
  }

  /**
   * composite_hash 목록 조회 (새 코드용)
   * @returns composite_hash 문자열 배열
   */
  static async searchCompositeHashes(
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    }
  ): Promise<string[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (searchParams.search_text) {
      conditions.push('im.prompt LIKE ?');
      params.push(`%${searchParams.search_text}%`);
    }
    if (searchParams.negative_text) {
      conditions.push('im.negative_prompt LIKE ?');
      params.push(`%${searchParams.negative_text}%`);
    }
    if (searchParams.ai_tool) {
      conditions.push('im.ai_tool = ?');
      params.push(searchParams.ai_tool);
    }
    if (searchParams.model_name) {
      conditions.push('im.model_name LIKE ?');
      params.push(`%${searchParams.model_name}%`);
    }
    if (searchParams.min_width) {
      conditions.push('im.width >= ?');
      params.push(searchParams.min_width);
    }
    if (searchParams.max_width) {
      conditions.push('im.width <= ?');
      params.push(searchParams.max_width);
    }
    if (searchParams.min_height) {
      conditions.push('im.height >= ?');
      params.push(searchParams.min_height);
    }
    if (searchParams.max_height) {
      conditions.push('im.height <= ?');
      params.push(searchParams.max_height);
    }
    if (searchParams.min_file_size) {
      conditions.push('if.file_size >= ?');
      params.push(searchParams.min_file_size);
    }
    if (searchParams.max_file_size) {
      conditions.push('if.file_size <= ?');
      params.push(searchParams.max_file_size);
    }
    if (searchParams.start_date) {
      conditions.push('DATE(im.first_seen_date) >= DATE(?)');
      params.push(searchParams.start_date);
    }
    if (searchParams.end_date) {
      conditions.push('DATE(im.first_seen_date) <= DATE(?)');
      params.push(searchParams.end_date);
    }

    let groupJoinClause = '';
    if (searchParams.group_id !== undefined) {
      if (searchParams.group_id === 0) {
        groupJoinClause = 'LEFT JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.composite_hash IS NULL');
      } else {
        groupJoinClause = 'INNER JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.group_id = ?');
        params.push(searchParams.group_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT DISTINCT im.composite_hash
      FROM image_metadata im
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
   */
  static async getRandomFromSearch(
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    }
  ): Promise<any | null> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (searchParams.search_text) {
      conditions.push('im.prompt LIKE ?');
      params.push(`%${searchParams.search_text}%`);
    }
    if (searchParams.negative_text) {
      conditions.push('im.negative_prompt LIKE ?');
      params.push(`%${searchParams.negative_text}%`);
    }
    if (searchParams.ai_tool) {
      conditions.push('im.ai_tool = ?');
      params.push(searchParams.ai_tool);
    }
    if (searchParams.model_name) {
      conditions.push('im.model_name LIKE ?');
      params.push(`%${searchParams.model_name}%`);
    }
    if (searchParams.min_width) {
      conditions.push('im.width >= ?');
      params.push(searchParams.min_width);
    }
    if (searchParams.max_width) {
      conditions.push('im.width <= ?');
      params.push(searchParams.max_width);
    }
    if (searchParams.min_height) {
      conditions.push('im.height >= ?');
      params.push(searchParams.min_height);
    }
    if (searchParams.max_height) {
      conditions.push('im.height <= ?');
      params.push(searchParams.max_height);
    }
    if (searchParams.min_file_size) {
      conditions.push('if.file_size >= ?');
      params.push(searchParams.min_file_size);
    }
    if (searchParams.max_file_size) {
      conditions.push('if.file_size <= ?');
      params.push(searchParams.max_file_size);
    }
    if (searchParams.start_date) {
      conditions.push('DATE(im.first_seen_date) >= DATE(?)');
      params.push(searchParams.start_date);
    }
    if (searchParams.end_date) {
      conditions.push('DATE(im.first_seen_date) <= DATE(?)');
      params.push(searchParams.end_date);
    }

    // 그룹 필터
    let groupJoinClause = '';
    if (searchParams.group_id !== undefined) {
      if (searchParams.group_id === 0) {
        groupJoinClause = 'LEFT JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.composite_hash IS NULL');
      } else {
        groupJoinClause = 'INNER JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
        conditions.push('ig_filter.group_id = ?');
        params.push(searchParams.group_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_size,
        if.mime_type,
        if.folder_id
      FROM image_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      ${groupJoinClause}
      ${whereClause}
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = db.prepare(query).get(...params);
    return row || null;
  }
}
