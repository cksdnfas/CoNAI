import { db } from '../database/init';
import {
  ComplexFilter,
  FilterValidationResult,
  FilterExecutionStats,
} from '@conai/shared';
import { RatingScoreService } from './ratingScoreService';
import { matchesComplexFilterImage } from './complexFilter/complexFilterEvaluator';
import {
  buildComplexFilterQuery,
  ComplexQueryBuildResult,
  ComplexSearchScope,
} from './complexFilter/complexFilterQueryBuilder';
import { validateComplexFilter } from './complexFilter/complexFilterValidator';
import { ImageMetadataRecord } from '../types/image';
import { RatingWeights } from '../types/rating';

/**
 * Complex Filter Service
 * PoE-style advanced filtering with AND/OR/NOT logic
 *
 * 새 구조: media_metadata + image_files 기반 쿼리
 *
 * Execution order (priority):
 * 1. Exclude (NOT) group - highest priority
 * 2. OR group - medium priority
 * 3. AND group - lowest priority
 *
 * Final result = (OR results ∩ AND results) - Exclude results
 */

export class ComplexFilterService {

  /**
   * Build complex search query with CTE (Common Table Expression)
   * Uses multi-stage filtering for optimal performance
   *
   * 새 구조: media_metadata 테이블 기반, composite_hash로 식별
   */
  static buildComplexQuery(
    filter: ComplexFilter,
    weights: RatingWeights | null,
    basicParams?: ComplexSearchScope
  ): ComplexQueryBuildResult {
    return buildComplexFilterQuery(filter, weights, basicParams);
  }

  /**
   * Execute complex search query
   * 새 구조: media_metadata 기반 검색, composite_hash 사용
   */
  static async executeComplexSearch(
    filter: ComplexFilter,
    basicParams?: ComplexSearchScope,
    pagination?: {
      page: number;
      limit: number;
      sortBy?: 'upload_date' | 'first_seen_date' | 'filename' | 'file_size' | 'width' | 'height';
      sortOrder?: 'ASC' | 'DESC';
      includeStats?: boolean;
      cursorValue?: string | number | null;
      cursorHash?: string;
      useCursor?: boolean;
      includeTotal?: boolean;
    }
  ): Promise<{ images: any[]; total: number; hasMore: boolean; totalKnown: boolean; nextCursorValue?: string | number | null; nextCursorHash?: string | null; stats?: FilterExecutionStats }> {
    const includeStats = pagination?.includeStats !== false;
    const startTime = includeStats ? Date.now() : 0;

    // Fetch rating weights
    const weights = await RatingScoreService.getWeights();

    // Build query
    const {
      query: baseQuery,
      params,
      cteClause,
      cteParams,
      countFromClause,
      whereClause,
      groupByClause,
      statsSources,
    } = this.buildComplexQuery(filter, weights, basicParams);

    // Count total results (composite_hash 기반) with an explicitly composed query
    // instead of regex-rewriting the SELECT clause.
    //
    // The count is driven straight from media_metadata: fromClause LEFT JOINs
    // image_files only to project file columns onto the data rows, and a LEFT JOIN
    // can neither drop nor add composite hashes. Dropping it from the count keeps
    // the exact same result while removing an image_files fan-out over the whole
    // match set, so the count query can stay inside media_metadata's indexes.
    const shouldCountTotal = !pagination?.useCursor || pagination.includeTotal !== false;
    let total = 0;
    if (shouldCountTotal) {
      const countQuery = `
        ${cteClause}
        SELECT COUNT(DISTINCT im.composite_hash) as total
        ${countFromClause}
        ${whereClause}
      `;
      const countRow = db.prepare(countQuery).get(...params) as any;
      total = countRow?.total || 0;
    }

    // Apply pagination
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 25;
    let sortBy = pagination?.sortBy || 'first_seen_date';
    const sortOrder = pagination?.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    // 날짜 필드 매핑 (레거시 호환성)
    if (sortBy === 'upload_date') {
      sortBy = 'first_seen_date';
    }

    const sortExpressions = {
      first_seen_date: `COALESCE(im.first_seen_date, '')`,
      filename: `COALESCE(if.original_file_path, '')`,
      file_size: 'COALESCE(if.file_size, 0)',
      width: 'COALESCE(im.width, 0)',
      height: 'COALESCE(im.height, 0)',
    } as const;
    const sortExpression = sortExpressions[sortBy];
    const cursorDirection = sortOrder === 'ASC' ? '>' : '<';
    const useCursor = pagination?.useCursor === true;
    const hasCursor = useCursor && pagination?.cursorValue !== undefined && pagination.cursorHash;
    const cursorClause = hasCursor
      ? `AND (${sortExpression} ${cursorDirection} ? OR (${sortExpression} = ? AND im.composite_hash ${cursorDirection} ?))`
      : '';
    const dataParams = hasCursor
      ? [...params, pagination.cursorValue, pagination.cursorValue, pagination.cursorHash]
      : params;
    const dataQuery = `
      ${baseQuery}
      ${cursorClause}
      ${groupByClause}
      ORDER BY ${sortExpression} ${sortOrder}, im.composite_hash ${sortOrder}
      LIMIT ?${useCursor ? '' : ' OFFSET ?'}
    `;

    const rows = db.prepare(dataQuery).all(...dataParams, limit + (useCursor ? 1 : 0), ...(useCursor ? [] : [offset])) as any[];
    const hasMore = useCursor ? rows.length > limit : page * limit < total;
    if (useCursor && rows.length > limit) {
      rows.pop();
    }
    const lastRow = rows.at(-1);

    const stats: FilterExecutionStats | undefined = includeStats
      ? {
          excluded_count: statsSources.excluded ? this.countCteRows(cteClause, cteParams, 'excluded') : 0,
          or_matched_count: statsSources.orResults ? this.countCteRows(cteClause, cteParams, 'or_results') : 0,
          and_matched_count: statsSources.andResults ? this.countCteRows(cteClause, cteParams, 'and_results') : 0,
          final_result_count: shouldCountTotal ? total : rows.length,
          execution_time_ms: Date.now() - startTime,
        }
      : undefined;

    return {
      images: rows,
      total,
      hasMore,
      totalKnown: shouldCountTotal,
      nextCursorValue: lastRow ? (sortBy === 'filename' ? lastRow.original_file_path : lastRow[sortBy]) : null,
      nextCursorHash: lastRow?.composite_hash ?? null,
      stats,
    };
  }

  /** Count one generated CTE using the same scoped parameters as the search query. */
  private static countCteRows(cteClause: string, cteParams: any[], cteName: 'excluded' | 'or_results' | 'and_results'): number {
    if (cteClause.length === 0) {
      return 0;
    }

    const row = db.prepare(`
      ${cteClause}
      SELECT COUNT(DISTINCT composite_hash) as total
      FROM ${cteName}
    `).get(...cteParams) as { total?: number } | undefined;

    return row?.total || 0;
  }

  /**
   * Evaluate a complex filter against one already-known media record.
   *
   * This is intentionally separate from executeComplexSearch(): new-image
   * auto-collection should decide whether the current image belongs to existing
   * groups, not run a whole-library search/rebuild for every generated image.
   */
  static matchesImage(filter: ComplexFilter, image: ImageMetadataRecord): boolean {
    return matchesComplexFilterImage(filter, image);
  }

  /**
   * Validate complex filter
   */
  static validateFilter(filter: ComplexFilter): FilterValidationResult {
    return validateComplexFilter(filter);
  }

  /**
   * Execute complex search and return only composite_hash (for random selection)
   * 새 구조: composite_hash 기반
   */
  static async executeComplexSearchIds(
    filter: ComplexFilter,
    basicParams?: ComplexSearchScope
  ): Promise<string[]> {
    const { query: hashesQuery, params } = await this.buildComplexSearchHashesQuery(filter, basicParams);

    // Execute query
    const rows = db.prepare(hashesQuery).all(...params) as { composite_hash: string }[];
    return rows.map(row => row.composite_hash);
  }

  /**
   * Build complex search SQL that returns only matching composite hashes.
   * Auto-collection can feed this directly into INSERT ... SELECT, avoiding
   * a JS array of every matched image.
   */
  static async buildComplexSearchHashesQuery(
    filter: ComplexFilter,
    basicParams?: ComplexSearchScope
  ): Promise<{ query: string; params: any[] }> {
    const weights = await RatingScoreService.getWeights();
    const { params, cteClause, countFromClause, whereClause } = this.buildComplexQuery(filter, weights, basicParams);
    const query = `
      ${cteClause}
      SELECT DISTINCT im.composite_hash
      ${countFromClause}
      ${whereClause}
    `;

    return { query, params };
  }

}

