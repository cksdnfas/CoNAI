import { db } from '../../database/init';
import { AutoTagSearchParams } from '../../types/autoTag';
import { AutoTagSearchService } from '../../services/autoTagSearchService';

/**
 * 검색 관련 작업을 담당하는 이미지 모델
 */
export class ImageSearchModel {
  /**
   * 고급 검색 (프롬프트 중심, 그룹 정보 포함)
   */
  static advancedSearch(
    searchParams: {
      search_text?: string;           // 긍정 프롬프트 검색 키워드
      negative_text?: string;         // 네거티브 프롬프트 검색 키워드 (필터)
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
    return new Promise((resolve, reject) => {
      const conditions: string[] = [];
      const params: any[] = [];

      // 긍정 프롬프트 검색
      if (searchParams.search_text) {
        conditions.push('i.prompt LIKE ?');
        params.push(`%${searchParams.search_text}%`);
      }

      // 네거티브 프롬프트 필터 (AND 조건)
      if (searchParams.negative_text) {
        conditions.push('i.negative_prompt LIKE ?');
        params.push(`%${searchParams.negative_text}%`);
      }

      // AI 도구 필터링
      if (searchParams.ai_tool) {
        conditions.push('i.ai_tool = ?');
        params.push(searchParams.ai_tool);
      }

      // 모델명 검색
      if (searchParams.model_name) {
        conditions.push('i.model_name LIKE ?');
        params.push(`%${searchParams.model_name}%`);
      }

      // 크기 필터링
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

      // 파일 크기 필터링
      if (searchParams.min_file_size) {
        conditions.push('i.file_size >= ?');
        params.push(searchParams.min_file_size);
      }
      if (searchParams.max_file_size) {
        conditions.push('i.file_size <= ?');
        params.push(searchParams.max_file_size);
      }

      // 날짜 범위 필터링 (날짜만 비교하도록 수정)
      if (searchParams.start_date) {
        conditions.push('DATE(i.upload_date) >= DATE(?)');
        params.push(searchParams.start_date);
      }
      if (searchParams.end_date) {
        conditions.push('DATE(i.upload_date) <= DATE(?)');
        params.push(searchParams.end_date);
      }

      // 그룹 필터링
      let groupJoinClause = '';
      let groupFilterApplied = false;
      if (searchParams.group_id !== undefined) {
        if (searchParams.group_id === 0) {
          // 그룹에 속하지 않은 이미지들
          groupJoinClause = 'LEFT JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
          conditions.push('ig_filter.image_id IS NULL');
          groupFilterApplied = true;
        } else {
          // 특정 그룹에 속한 이미지들
          groupJoinClause = 'INNER JOIN image_groups ig_filter ON i.id = ig_filter.image_id';
          conditions.push('ig_filter.group_id = ?');
          params.push(searchParams.group_id);
          groupFilterApplied = true;
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const offset = (page - 1) * limit;

      // 총 개수 조회
      const countQuery = `
        SELECT COUNT(DISTINCT i.id) as total
        FROM images i ${groupJoinClause} ${whereClause}
      `;

      db.get(countQuery, params, (err, countRow: any) => {
        if (err) {
          reject(err);
          return;
        }

        const total = countRow.total;

        // 그룹 정보를 포함한 데이터 조회
        const dataQuery = `
          SELECT
            i.*,
            GROUP_CONCAT(DISTINCT g.id) as group_ids,
            GROUP_CONCAT(DISTINCT g.name) as group_names,
            GROUP_CONCAT(DISTINCT g.color) as group_colors,
            GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
          FROM images i
          ${groupJoinClause}
          LEFT JOIN image_groups ig ON i.id = ig.image_id
          LEFT JOIN groups g ON ig.group_id = g.id
          ${whereClause}
          GROUP BY i.id
          ORDER BY i.${sortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `;

        db.all(
          dataQuery,
          [...params, limit, offset],
          (err, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              // 그룹 정보 파싱
              const enrichedImages = rows.map(row => ({
                ...row,
                groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
                  id: parseInt(row.group_ids.split(',')[index]),
                  name,
                  color: row.group_colors.split(',')[index] || null,
                  collection_type: row.collection_types.split(',')[index]
                })) : []
              }));

              resolve({ images: enrichedImages, total });
            }
          }
        );
      });
    });
  }

  /**
   * 그룹 정보를 포함한 이미지 조회
   */
  static findWithGroups(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * limit;

      // 총 개수 조회
      db.get('SELECT COUNT(*) as total FROM images', (err, countRow: any) => {
        if (err) {
          reject(err);
          return;
        }

        const total = countRow.total;

        // 그룹 정보를 포함한 이미지 조회
        const query = `
          SELECT
            i.*,
            GROUP_CONCAT(g.id) as group_ids,
            GROUP_CONCAT(g.name) as group_names,
            GROUP_CONCAT(g.color) as group_colors,
            GROUP_CONCAT(ig.collection_type) as collection_types
          FROM images i
          LEFT JOIN image_groups ig ON i.id = ig.image_id
          LEFT JOIN groups g ON ig.group_id = g.id
          GROUP BY i.id
          ORDER BY i.${sortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `;

        db.all(query, [limit, offset], (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            // 그룹 정보 파싱
            const enrichedImages = rows.map(row => ({
              ...row,
              groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
                id: parseInt(row.group_ids.split(',')[index]),
                name,
                color: row.group_colors.split(',')[index] || null,
                collection_type: row.collection_types.split(',')[index]
              })) : []
            }));

            resolve({ images: enrichedImages, total });
          }
        });
      });
    });
  }

  /**
   * 오토태그 기반 이미지 검색 (그룹 정보 포함)
   */
  static async searchByAutoTags(
    searchParams: AutoTagSearchParams
  ): Promise<{ images: any[], total: number }> {
    return new Promise(async (resolve, reject) => {
      const page = searchParams.page || 1;
      const limit = searchParams.limit || 20;
      const sortBy = searchParams.sortBy || 'upload_date';
      const sortOrder = searchParams.sortOrder || 'DESC';
      const offset = (page - 1) * limit;

      // 오토태그 검색 조건 생성
      const queryBuilder = await AutoTagSearchService.buildAutoTagSearchQuery(searchParams);
      const whereClause = queryBuilder.conditions.length > 0
        ? `WHERE ${queryBuilder.conditions.join(' AND ')}`
        : '';

      // 총 개수 조회
      const countQuery = `
        SELECT COUNT(DISTINCT i.id) as total
        FROM images i
        ${whereClause}
      `;

      db.get(countQuery, queryBuilder.params, (err, countRow: any) => {
        if (err) {
          reject(err);
          return;
        }

        const total = countRow.total;

        // 그룹 정보를 포함한 데이터 조회
        const dataQuery = `
          SELECT
            i.*,
            GROUP_CONCAT(DISTINCT g.id) as group_ids,
            GROUP_CONCAT(DISTINCT g.name) as group_names,
            GROUP_CONCAT(DISTINCT g.color) as group_colors,
            GROUP_CONCAT(DISTINCT ig.collection_type) as collection_types
          FROM images i
          LEFT JOIN image_groups ig ON i.id = ig.image_id
          LEFT JOIN groups g ON ig.group_id = g.id
          ${whereClause}
          GROUP BY i.id
          ORDER BY i.${sortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `;

        db.all(
          dataQuery,
          [...queryBuilder.params, limit, offset],
          (err, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              // 그룹 정보 파싱
              const enrichedImages = rows.map(row => ({
                ...row,
                groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
                  id: parseInt(row.group_ids.split(',')[index]),
                  name,
                  color: row.group_colors.split(',')[index] || null,
                  collection_type: row.collection_types.split(',')[index]
                })) : []
              }));

              resolve({ images: enrichedImages, total });
            }
          }
        );
      });
    });
  }
}
