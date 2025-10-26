import { db } from '../../database/init';
import { AutoTagSearchParams } from '../../types/autoTag';
import { AutoTagSearchService } from '../../services/autoTagSearchService';

export class ImageSearchModel {
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

    if (searchParams.search_text) {
      conditions.push('i.prompt LIKE ?');
      params.push(`%${searchParams.search_text}%`);
    }
    if (searchParams.negative_text) {
      conditions.push('i.negative_prompt LIKE ?');
      params.push(`%${searchParams.negative_text}%`);
    }
    if (searchParams.ai_tool) {
      conditions.push('i.ai_tool = ?');
      params.push(searchParams.ai_tool);
    }
    if (searchParams.model_name) {
      conditions.push('i.model_name LIKE ?');
      params.push(`%${searchParams.model_name}%`);
    }
    if (searchParams.min_width) {
      conditions.push('i.width >= ?');
      params.push(searchParams.min_width);
    }
    if (searchParams.max_width) {
      conditions.push('i.width <= ?');
      params.push(searchParams.max_width);
    }
    if (searchParams.min_height) {
      conditions.push('i.height >= ?');
      params.push(searchParams.min_height);
    }
    if (searchParams.max_height) {
      conditions.push('i.height <= ?');
      params.push(searchParams.max_height);
    }
    if (searchParams.min_file_size) {
      conditions.push('i.file_size >= ?');
      params.push(searchParams.min_file_size);
    }
    if (searchParams.max_file_size) {
      conditions.push('i.file_size <= ?');
      params.push(searchParams.max_file_size);
    }
    if (searchParams.start_date) {
      conditions.push('DATE(i.upload_date) >= DATE(?)');
      params.push(searchParams.start_date);
    }
    if (searchParams.end_date) {
      conditions.push('DATE(i.upload_date) <= DATE(?)');
      params.push(searchParams.end_date);
    }

    let groupJoinClause = '';
    if (searchParams.group_id !== undefined) {
      if (searchParams.group_id === 0) {
        groupJoinClause = 'LEFT JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
        conditions.push('ig_filter.image_id IS NULL');
      } else {
        groupJoinClause = 'INNER JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
        conditions.push('ig_filter.group_id = ?');
        params.push(searchParams.group_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countQuery = `SELECT COUNT(DISTINCT i.id) as total FROM images i ${groupJoinClause} ${whereClause}`;
    const countRow = db.prepare(countQuery).get(...params) as any;
    const total = countRow.total;

    const dataQuery = `
      SELECT i.*, GROUP_CONCAT(DISTINCT g.id) as group_ids, GROUP_CONCAT(DISTINCT g.name) as group_names,
      GROUP_CONCAT(DISTINCT g.color) as group_colors, GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
      FROM images i ${groupJoinClause}
      LEFT JOIN image_groups ig ON i.id = ig.image_id
      LEFT JOIN groups g ON ig.group_id = g.id ${whereClause}
      GROUP BY i.id ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

    const rows = db.prepare(dataQuery).all(...params, limit, offset) as any[];
    const enrichedImages = rows.map(row => ({
      ...row,
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
  }

  static async findWithGroups(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    const offset = (page - 1) * limit;
    const countRow = db.prepare('SELECT COUNT(*) as total FROM images').get() as any;
    const total = countRow.total;

    const query = `
      SELECT i.*, GROUP_CONCAT(g.id) as group_ids, GROUP_CONCAT(g.name) as group_names,
      GROUP_CONCAT(g.color) as group_colors, GROUP_CONCAT(ig.collection_type) as collection_types
      FROM images i
      LEFT JOIN image_groups ig ON i.id = ig.image_id
      LEFT JOIN groups g ON ig.group_id = g.id
      GROUP BY i.id ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

    const rows = db.prepare(query).all(limit, offset) as any[];
    const enrichedImages = rows.map(row => ({
      ...row,
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
  }

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

    const queryBuilder = await AutoTagSearchService.buildAutoTagSearchQuery(searchParams, basicSearchParams);
    const whereClause = queryBuilder.conditions.length > 0 ? `WHERE ${queryBuilder.conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(DISTINCT i.id) as total FROM images i ${whereClause}`;

    // 디버깅: 생성된 쿼리와 파라미터 출력
    console.log('[AutoTagSearch] Generated Query:', countQuery);
    console.log('[AutoTagSearch] Query Params:', queryBuilder.params);
    console.log('[AutoTagSearch] Search Params:', JSON.stringify(searchParams, null, 2));

    const countRow = db.prepare(countQuery).get(...queryBuilder.params) as any;
    const total = countRow.total;

    console.log('[AutoTagSearch] Total Results:', total);

    const dataQuery = `
      SELECT i.*, GROUP_CONCAT(DISTINCT g.id) as group_ids, GROUP_CONCAT(DISTINCT g.name) as group_names,
      GROUP_CONCAT(DISTINCT g.color) as group_colors, GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
      FROM images i
      LEFT JOIN image_groups ig ON i.id = ig.image_id
      LEFT JOIN groups g ON ig.group_id = g.id ${whereClause}
      GROUP BY i.id ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

    const rows = db.prepare(dataQuery).all(...queryBuilder.params, limit, offset) as any[];
    const enrichedImages = rows.map(row => ({
      ...row,
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
   * 검색 조건에 맞는 이미지 ID만 조회 (랜덤 선택용)
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
  ): Promise<number[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (searchParams.search_text) {
      conditions.push('i.prompt LIKE ?');
      params.push(`%${searchParams.search_text}%`);
    }
    if (searchParams.negative_text) {
      conditions.push('i.negative_prompt LIKE ?');
      params.push(`%${searchParams.negative_text}%`);
    }
    if (searchParams.ai_tool) {
      conditions.push('i.ai_tool = ?');
      params.push(searchParams.ai_tool);
    }
    if (searchParams.model_name) {
      conditions.push('i.model_name LIKE ?');
      params.push(`%${searchParams.model_name}%`);
    }
    if (searchParams.min_width) {
      conditions.push('i.width >= ?');
      params.push(searchParams.min_width);
    }
    if (searchParams.max_width) {
      conditions.push('i.width <= ?');
      params.push(searchParams.max_width);
    }
    if (searchParams.min_height) {
      conditions.push('i.height >= ?');
      params.push(searchParams.min_height);
    }
    if (searchParams.max_height) {
      conditions.push('i.height <= ?');
      params.push(searchParams.max_height);
    }
    if (searchParams.min_file_size) {
      conditions.push('i.file_size >= ?');
      params.push(searchParams.min_file_size);
    }
    if (searchParams.max_file_size) {
      conditions.push('i.file_size <= ?');
      params.push(searchParams.max_file_size);
    }
    if (searchParams.start_date) {
      conditions.push('DATE(i.upload_date) >= DATE(?)');
      params.push(searchParams.start_date);
    }
    if (searchParams.end_date) {
      conditions.push('DATE(i.upload_date) <= DATE(?)');
      params.push(searchParams.end_date);
    }

    let groupJoinClause = '';
    if (searchParams.group_id !== undefined) {
      if (searchParams.group_id === 0) {
        groupJoinClause = 'LEFT JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
        conditions.push('ig_filter.image_id IS NULL');
      } else {
        groupJoinClause = 'INNER JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
        conditions.push('ig_filter.group_id = ?');
        params.push(searchParams.group_id);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT DISTINCT i.id
      FROM images i ${groupJoinClause}
      ${whereClause}
      ORDER BY i.upload_date DESC
    `;

    const rows = db.prepare(query).all(...params) as { id: number }[];
    return rows.map(row => row.id);
  }
}
