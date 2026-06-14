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
    }
  ): Promise<{ images: any[]; total: number; stats?: FilterExecutionStats }> {
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
      statsSources,
    } = this.buildComplexQuery(filter, weights, basicParams);

    // Count total results (composite_hash 기반)
    // Replace the main SELECT clause (im.*) with COUNT, handling whitespace and multi-line
    const countQuery = baseQuery.replace(
      /SELECT\s+im\.\*,[\s\S]+?FROM/i,
      'SELECT COUNT(DISTINCT im.composite_hash) as total FROM'
    );
    const countRow = db.prepare(countQuery).get(...params) as any;
    const total = countRow?.total || 0;

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

    const dataQuery = `
      ${baseQuery}
      ORDER BY im.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(dataQuery).all(...params, limit, offset) as any[];

    const stats: FilterExecutionStats | undefined = includeStats
      ? {
          excluded_count: statsSources.excluded ? this.countCteRows(cteClause, cteParams, 'excluded') : 0,
          or_matched_count: statsSources.orResults ? this.countCteRows(cteClause, cteParams, 'or_results') : 0,
          and_matched_count: statsSources.andResults ? this.countCteRows(cteClause, cteParams, 'and_results') : 0,
          final_result_count: total,
          execution_time_ms: Date.now() - startTime,
        }
      : undefined;

    return { images: rows, total, stats };
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
    const { query: baseQuery, params } = this.buildComplexQuery(filter, weights, basicParams);
    const query = baseQuery.replace(
      /SELECT\s+im\.\*,[\s\S]+?FROM/i,
      'SELECT DISTINCT im.composite_hash FROM'
    );

    return { query, params };
  }

}

