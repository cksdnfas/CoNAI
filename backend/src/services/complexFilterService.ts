import { db } from '../database/init';
import {
  ComplexFilter,
  FilterCondition,
  FilterValidationResult,
  FilterExecutionStats
} from '@comfyui-image-manager/shared';
import { RatingScoreService } from './ratingScoreService';
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
    basicParams?: {
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): { query: string; params: any[] } {
    const params: any[] = [];
    const ctes: string[] = [];

    // Build basic filter conditions (applies to all groups)
    const basicConditions: string[] = [];
    if (basicParams?.ai_tool) {
      basicConditions.push('im.ai_tool = ?');
      params.push(basicParams.ai_tool);
    }
    if (basicParams?.model_name) {
      basicConditions.push('im.model_name LIKE ?');
      params.push(`%${basicParams.model_name}%`);
    }
    if (basicParams?.start_date) {
      basicConditions.push('DATE(im.first_seen_date) >= DATE(?)');
      params.push(basicParams.start_date);
    }
    if (basicParams?.end_date) {
      basicConditions.push('DATE(im.first_seen_date) <= DATE(?)');
      params.push(basicParams.end_date);
    }

    const basicWhere = basicConditions.length > 0
      ? `WHERE ${basicConditions.join(' AND ')}`
      : '';

    // 1. Build EXCLUDE (NOT) CTE - highest priority
    if (filter.exclude_group && filter.exclude_group.length > 0) {
      const excludeResult = this.buildGroupQuery(filter.exclude_group, 'OR', params, weights);
      ctes.push(`
        excluded AS (
          SELECT DISTINCT im.composite_hash
          FROM media_metadata im
          ${basicWhere}
          ${excludeResult.conditions.length > 0 ? (basicWhere ? 'AND' : 'WHERE') + ' (' + excludeResult.conditions.join(' OR ') + ')' : ''}
        )
      `);
    }

    // 2. Build OR CTE
    let hasOrGroup = false;
    if (filter.or_group && filter.or_group.length > 0) {
      const orResult = this.buildGroupQuery(filter.or_group, 'OR', params, weights);
      if (orResult.conditions.length > 0) {
        hasOrGroup = true;
        ctes.push(`
          or_results AS (
            SELECT DISTINCT im.composite_hash
            FROM media_metadata im
            ${basicWhere}
            ${(basicWhere ? 'AND' : 'WHERE') + ' (' + orResult.conditions.join(' OR ') + ')'}
          )
        `);
      }
    }

    // 3. Build AND CTE
    let hasAndGroup = false;
    if (filter.and_group && filter.and_group.length > 0) {
      const andResult = this.buildGroupQuery(filter.and_group, 'AND', params, weights);
      if (andResult.conditions.length > 0) {
        hasAndGroup = true;
        ctes.push(`
          and_results AS (
            SELECT DISTINCT im.composite_hash
            FROM media_metadata im
            ${basicWhere}
            ${(basicWhere ? 'AND' : 'WHERE') + ' (' + andResult.conditions.join(' AND ') + ')'}
          )
        `);
      }
    }

    // Build final query
    const finalConditions: string[] = [];

    if (hasOrGroup) {
      finalConditions.push('im.composite_hash IN (SELECT composite_hash FROM or_results)');
    }
    if (hasAndGroup) {
      finalConditions.push('im.composite_hash IN (SELECT composite_hash FROM and_results)');
    }
    if (filter.exclude_group && filter.exclude_group.length > 0) {
      finalConditions.push('im.composite_hash NOT IN (SELECT composite_hash FROM excluded)');
    }

    // If no groups specified, return all images (with basic filters)
    const finalWhere = finalConditions.length > 0
      ? `WHERE ${finalConditions.join(' AND ')}`
      : basicWhere;

    // ✅ image_files JOIN 추가하여 id 필드 포함
    const selectClause = `
      SELECT
        im.*,
        if.id,
        if.original_file_path,
        if.file_status,
        if.file_type,
        if.file_size,
        if.mime_type
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
    `;

    const query = ctes.length > 0
      ? `WITH ${ctes.join(', ')} ${selectClause} ${finalWhere}`
      : `${selectClause} ${finalWhere}`;

    return { query, params };
  }

  /**
   * Build query for a single group (OR or AND)
   */
  private static buildGroupQuery(
    conditions: FilterCondition[],
    operator: 'OR' | 'AND',
    params: any[],
    weights: RatingWeights | null
  ): { conditions: string[]; params: any[] } {
    const sqlConditions: string[] = [];

    for (const condition of conditions) {
      const conditionSql = this.buildConditionSQL(condition, params, weights);
      if (conditionSql) {
        sqlConditions.push(conditionSql);
      }
    }

    return { conditions: sqlConditions, params };
  }

  /**
   * Build SQL for individual condition
   */
  private static buildConditionSQL(condition: FilterCondition, params: any[], weights: RatingWeights | null): string | null {
    switch (condition.category) {
      case 'basic':
        return this.buildBasicConditionSQL(condition, params);
      case 'positive_prompt':
        return this.buildPromptConditionSQL(condition, params, false);
      case 'negative_prompt':
        return this.buildPromptConditionSQL(condition, params, true);
      case 'auto_tag':
        return this.buildAutoTagConditionSQL(condition, params, weights);
      default:
        return null;
    }
  }

  /**
   * Build SQL for basic conditions (ai_tool, model_name)
   * 새 구조: media_metadata 테이블 사용 (im 별칭)
   */
  private static buildBasicConditionSQL(condition: FilterCondition, params: any[]): string | null {
    if (condition.type === 'ai_tool') {
      params.push(condition.value);
      return 'im.ai_tool = ?';
    }
    if (condition.type === 'model_name') {
      params.push(`%${condition.value}%`);
      return 'im.model_name LIKE ?';
    }
    return null;
  }

  /**
   * Build SQL for prompt conditions
   * 새 구조: media_metadata 테이블 사용 (im 별칭)
   */
  private static buildPromptConditionSQL(
    condition: FilterCondition,
    params: any[],
    isNegative: boolean
  ): string | null {
    const column = isNegative ? 'im.negative_prompt' : 'im.prompt';

    if (condition.type === 'prompt_contains' || condition.type === 'negative_prompt_contains') {
      const value = String(condition.value);
      const pattern = condition.case_sensitive
        ? `%${value}%`
        : `%${value.toLowerCase()}%`;

      // Positive prompt 검색은 NAI character prompt까지 포함
      if (!isNegative) {
        return this.buildPositivePromptSearchCondition(pattern, params, !!condition.case_sensitive);
      }

      params.push(pattern);
      return condition.case_sensitive
        ? `${column} LIKE ?`
        : `LOWER(${column}) LIKE ?`;
    }

    if (condition.type === 'prompt_regex' || condition.type === 'negative_prompt_regex') {
      // SQLite doesn't support regex natively, use LIKE with wildcards
      const pattern = `%${String(condition.value)}%`;

      // Positive prompt 검색은 NAI character prompt까지 포함
      if (!isNegative) {
        return this.buildPositivePromptSearchCondition(pattern, params, true);
      }

      params.push(pattern);
      return `${column} LIKE ?`;
    }

    return null;
  }

  /**
   * Positive prompt 검색 조건 생성
   * - base prompt(im.prompt)
   * - 정규화 컬럼(im.character_prompt_text)
   * - raw_nai_parameters.v4_prompt.caption.char_captions[].char_caption (fallback)
   */
  private static buildPositivePromptSearchCondition(
    pattern: string,
    params: any[],
    caseSensitive: boolean
  ): string {
    const basePromptCondition = caseSensitive
      ? 'im.prompt LIKE ?'
      : 'LOWER(im.prompt) LIKE ?';

    const characterTextCondition = caseSensitive
      ? 'im.character_prompt_text LIKE ?'
      : 'LOWER(im.character_prompt_text) LIKE ?';

    const charCaptionCondition = caseSensitive
      ? `COALESCE(json_extract(char_item.value, '$.char_caption'), '') LIKE ?`
      : `LOWER(COALESCE(json_extract(char_item.value, '$.char_caption'), '')) LIKE ?`;

    params.push(pattern, pattern, pattern);

    return `(
      ${basePromptCondition}
      OR ${characterTextCondition}
      OR (
        json_valid(im.raw_nai_parameters) = 1
        AND EXISTS (
          SELECT 1
          FROM json_each(im.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
          WHERE ${charCaptionCondition}
        )
      )
    )`;
  }

  /**
   * Build SQL for auto-tag conditions
   * 새 구조: media_metadata 테이블 사용 (im 별칭)
   */
  private static buildAutoTagConditionSQL(condition: FilterCondition, params: any[], weights: RatingWeights | null): string | null {
    // Auto-tag exists
    if (condition.type === 'auto_tag_exists') {
      return condition.value === true
        ? 'im.auto_tags IS NOT NULL'
        : 'im.auto_tags IS NULL';
    }

    // Has character
    if (condition.type === 'auto_tag_has_character') {
      if (condition.value === true) {
        // 캐릭터 필드가 존재하고, object이며, 빈 객체가 아님
        return `(
          json_extract(im.auto_tags, '$.character') IS NOT NULL
          AND json_type(im.auto_tags, '$.character') = 'object'
          AND json_extract(im.auto_tags, '$.character') != '{}'
        )`;
      } else {
        // 캐릭터 필드가 없거나, object가 아니거나, 빈 객체임
        return `(
          json_extract(im.auto_tags, '$.character') IS NULL
          OR json_type(im.auto_tags, '$.character') != 'object'
          OR json_extract(im.auto_tags, '$.character') = '{}'
        )`;
      }
    }

    // Rating type-based
    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      const jsonPath = `$.rating.${condition.rating_type}`;
      const conditions: string[] = [];

      if (condition.min_score !== undefined) {
        params.push(condition.min_score);
        conditions.push(`json_extract(im.auto_tags, '${jsonPath}') >= ?`);
      }
      if (condition.max_score !== undefined) {
        params.push(condition.max_score);
        conditions.push(`json_extract(im.auto_tags, '${jsonPath}') <= ?`);
      }

      return conditions.length > 0 ? conditions.join(' AND ') : null;
    }

    // Rating score (weighted)
    if (condition.type === 'auto_tag_rating_score' && weights) {
      const conditions: string[] = [];

      // 점수 계산 식 생성
      const scoreExpression = `
        (ROUND(json_extract(im.auto_tags, '$.rating.general') * 1000) / 1000 * ${weights.general_weight} +
         ROUND(json_extract(im.auto_tags, '$.rating.sensitive') * 1000) / 1000 * ${weights.sensitive_weight} +
         ROUND(json_extract(im.auto_tags, '$.rating.questionable') * 1000) / 1000 * ${weights.questionable_weight} +
         ROUND(json_extract(im.auto_tags, '$.rating.explicit') * 1000) / 1000 * ${weights.explicit_weight})
      `.trim();

      if (condition.min_score !== undefined) {
        params.push(condition.min_score);
        conditions.push(`${scoreExpression} >= ?`);
      }
      if (condition.max_score !== undefined) {
        params.push(condition.max_score);
        conditions.push(`${scoreExpression} < ?`);
      }

      return conditions.length > 0 ? conditions.join(' AND ') : null;
    }

    // General tag
    if (condition.type === 'auto_tag_general') {
      const tag = String(condition.value).toLowerCase();
      const variants = this.normalizeSearchTerm(tag);

      const tagConditions: string[] = [];
      for (const variant of variants) {
        const existsCondition = `EXISTS (
          SELECT 1 FROM json_each(im.auto_tags, '$.general')
          WHERE LOWER(key) LIKE ?
          ${condition.min_score !== undefined ? ' AND value >= ?' : ''}
          ${condition.max_score !== undefined ? ' AND value <= ?' : ''}
        )`;

        tagConditions.push(existsCondition);
        params.push(`%${variant}%`);
        if (condition.min_score !== undefined) params.push(condition.min_score);
        if (condition.max_score !== undefined) params.push(condition.max_score);
      }

      return tagConditions.length > 0 ? `(${tagConditions.join(' OR ')})` : null;
    }

    // Character tag
    if (condition.type === 'auto_tag_character') {
      const character = String(condition.value).toLowerCase();
      const variants = this.normalizeSearchTerm(character);

      const charConditions: string[] = [];
      for (const variant of variants) {
        const existsCondition = `EXISTS (
          SELECT 1 FROM json_each(im.auto_tags, '$.character')
          WHERE LOWER(key) LIKE ?
          ${condition.min_score !== undefined ? ' AND value >= ?' : ''}
          ${condition.max_score !== undefined ? ' AND value <= ?' : ''}
        )`;

        charConditions.push(existsCondition);
        params.push(`%${variant}%`);
        if (condition.min_score !== undefined) params.push(condition.min_score);
        if (condition.max_score !== undefined) params.push(condition.max_score);
      }

      return charConditions.length > 0 ? `(${charConditions.join(' OR ')})` : null;
    }

    // Model
    if (condition.type === 'auto_tag_model') {
      params.push(condition.value);
      return `json_extract(im.auto_tags, '$.model') = ?`;
    }

    // Any Tag (General + Character)
    if (condition.type === 'auto_tag_any') {
      const tag = String(condition.value).toLowerCase();
      const variants = this.normalizeSearchTerm(tag);

      const anyConditions: string[] = [];
      for (const variant of variants) {
        const generalCondition = `EXISTS (
          SELECT 1 FROM json_each(im.auto_tags, '$.general')
          WHERE LOWER(key) LIKE ?
          ${condition.min_score !== undefined ? ' AND value >= ?' : ''}
          ${condition.max_score !== undefined ? ' AND value <= ?' : ''}
        )`;

        const characterCondition = `EXISTS (
          SELECT 1 FROM json_each(im.auto_tags, '$.character')
          WHERE LOWER(key) LIKE ?
          ${condition.min_score !== undefined ? ' AND value >= ?' : ''}
          ${condition.max_score !== undefined ? ' AND value <= ?' : ''}
        )`;

        // OR condition for each variant
        anyConditions.push(`(${generalCondition} OR ${characterCondition})`);

        // Params for general
        params.push(`%${variant}%`);
        if (condition.min_score !== undefined) params.push(condition.min_score);
        if (condition.max_score !== undefined) params.push(condition.max_score);

        // Params for character
        params.push(`%${variant}%`);
        if (condition.min_score !== undefined) params.push(condition.min_score);
        if (condition.max_score !== undefined) params.push(condition.max_score);
      }

      return anyConditions.length > 0 ? `(${anyConditions.join(' OR ')})` : null;
    }

    return null;
  }

  /**
   * Normalize search term for auto-tag matching
   * (Reuse logic from autoTagSearchService)
   */
  private static normalizeSearchTerm(term: string): string[] {
    const variants: Set<string> = new Set();
    const normalized = term.trim().toLowerCase();

    if (!normalized) return [];

    variants.add(normalized);

    // Underscore ↔ space variations
    if (normalized.includes('_')) {
      variants.add(normalized.replace(/_/g, ' '));
      variants.add(normalized.replace(/_/g, ''));
    }
    if (normalized.includes(' ')) {
      variants.add(normalized.replace(/ /g, '_'));
      variants.add(normalized.replace(/ /g, ''));
    }

    // Hyphen variations
    if (normalized.includes('-')) {
      variants.add(normalized.replace(/-/g, '_'));
      variants.add(normalized.replace(/-/g, ' '));
      variants.add(normalized.replace(/-/g, ''));
    }

    return Array.from(variants);
  }

  /**
   * Execute complex search query
   * 새 구조: media_metadata 기반 검색, composite_hash 사용
   */
  static async executeComplexSearch(
    filter: ComplexFilter,
    basicParams?: {
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    },
    pagination?: {
      page: number;
      limit: number;
      sortBy?: 'upload_date' | 'first_seen_date' | 'filename' | 'file_size' | 'width' | 'height';
      sortOrder?: 'ASC' | 'DESC';
    }
  ): Promise<{ images: any[]; total: number; stats?: FilterExecutionStats }> {
    const startTime = Date.now();

    // Fetch rating weights
    const weights = await RatingScoreService.getWeights();

    // Build query
    const { query: baseQuery, params } = this.buildComplexQuery(filter, weights, basicParams);

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

    // Calculate stats (simplified)
    const executionTime = Date.now() - startTime;
    const stats: FilterExecutionStats = {
      excluded_count: 0,  // TODO: Calculate from CTE
      or_matched_count: 0,
      and_matched_count: 0,
      final_result_count: total,
      execution_time_ms: executionTime
    };

    return { images: rows, total, stats };
  }

  /**
   * Validate complex filter
   */
  static validateFilter(filter: ComplexFilter): FilterValidationResult {
    const errors: string[] = [];

    // Validate each group
    if (filter.exclude_group) {
      const groupErrors = this.validateConditions(filter.exclude_group, 'Exclude');
      errors.push(...groupErrors);
    }
    if (filter.or_group) {
      const groupErrors = this.validateConditions(filter.or_group, 'OR');
      errors.push(...groupErrors);
    }
    if (filter.and_group) {
      const groupErrors = this.validateConditions(filter.and_group, 'AND');
      errors.push(...groupErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate conditions in a group
   */
  private static validateConditions(conditions: FilterCondition[], groupName: string): string[] {
    const errors: string[] = [];

    conditions.forEach((condition, index) => {
      // Check required fields
      if (!condition.category) {
        errors.push(`${groupName} group, condition ${index + 1}: category is required`);
      }
      if (!condition.type) {
        errors.push(`${groupName} group, condition ${index + 1}: type is required`);
      }

      // Type-specific value validation
      if (condition.type === 'auto_tag_exists' || condition.type === 'auto_tag_has_character') {
        // Boolean types: value must be boolean
        if (typeof condition.value !== 'boolean') {
          errors.push(`${groupName} group, condition ${index + 1}: value must be boolean for ${condition.type}`);
        }
      } else if (condition.type === 'auto_tag_general' || condition.type === 'auto_tag_character' ||
        condition.type === 'prompt_contains' || condition.type === 'prompt_regex' ||
        condition.type === 'negative_prompt_contains' || condition.type === 'negative_prompt_regex' ||
        condition.type === 'ai_tool' || condition.type === 'model_name' ||
        condition.type === 'auto_tag_model' || condition.type === 'auto_tag_any') {
        // String types: value must be non-empty string
        if (typeof condition.value !== 'string' || condition.value.trim() === '') {
          errors.push(`${groupName} group, condition ${index + 1}: value must be a non-empty string for ${condition.type}`);
        }
      } else if (condition.type === 'auto_tag_rating' || condition.type === 'auto_tag_rating_score') {
        // Rating types: at least one of min_score or max_score must be set
        if (condition.min_score === undefined && condition.max_score === undefined) {
          errors.push(`${groupName} group, condition ${index + 1}: at least one of min_score or max_score is required for ${condition.type}`);
        }
      } else {
        // Default validation: value is required
        if (condition.value === undefined || condition.value === null) {
          errors.push(`${groupName} group, condition ${index + 1}: value is required`);
        }
      }

      // Validate score ranges
      if (condition.type !== 'auto_tag_rating_score') {
        if (condition.min_score !== undefined) {
          if (condition.min_score < 0 || condition.min_score > 1) {
            errors.push(`${groupName} group, condition ${index + 1}: min_score must be between 0 and 1`);
          }
        }
        if (condition.max_score !== undefined) {
          if (condition.max_score < 0 || condition.max_score > 1) {
            errors.push(`${groupName} group, condition ${index + 1}: max_score must be between 0 and 1`);
          }
        }
      }

      if (condition.min_score !== undefined && condition.max_score !== undefined) {
        if (condition.min_score > condition.max_score) {
          errors.push(`${groupName} group, condition ${index + 1}: min_score cannot be greater than max_score`);
        }
      }

      // Validate rating type
      if (condition.type === 'auto_tag_rating' && !condition.rating_type) {
        errors.push(`${groupName} group, condition ${index + 1}: rating_type is required for auto_tag_rating`);
      }
    });

    return errors;
  }

  /**
   * Execute complex search and return only composite_hash (for random selection)
   * 새 구조: composite_hash 기반
   */
  static async executeComplexSearchIds(
    filter: ComplexFilter,
    basicParams?: {
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<string[]> {
    // Fetch rating weights
    const weights = await RatingScoreService.getWeights();

    // Build query
    const { query: baseQuery, params } = this.buildComplexQuery(filter, weights, basicParams);

    // Modify query to select only composite_hash
    const hashesQuery = baseQuery.replace(
      /SELECT\s+im\.\*,[\s\S]+?FROM/i,
      'SELECT DISTINCT im.composite_hash FROM'
    );

    // Execute query
    const rows = db.prepare(hashesQuery).all(...params) as { composite_hash: string }[];
    return rows.map(row => row.composite_hash);
  }

}
