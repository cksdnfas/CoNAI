import { db } from '../database/init';
import { ComplexFilter,
FilterCondition,
FilterValidationResult,
FilterExecutionStats } from '@conai/shared';
import { RatingScoreService } from './ratingScoreService';
import { RatingWeights } from '../types/rating';
import { ImageSafetyService } from './imageSafetyService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { buildComplexFilterAutoTagCondition } from './complexFilter/complexFilterAutoTagSql';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
} from './autoTagSqlShared';
import { normalizeAutoTagSearchTerm } from './autoTagSearch/autoTagSearchTerms';
import { ImageMetadataRecord } from '../types/image';
import { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } from '../utils/sqlLike';

type ComplexSearchScope = {
  ai_tool?: string;
  model_name?: string;
  start_date?: string;
  end_date?: string;
};

type ComplexQueryStatsSources = {
  excluded: boolean;
  orResults: boolean;
  andResults: boolean;
};

type ComplexQueryBuildResult = {
  query: string;
  params: any[];
  cteClause: string;
  cteParams: any[];
  statsSources: ComplexQueryStatsSources;
};

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
function getVisibleImageCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('im.rating_score');
}

function getReadyImageCondition() {
  return MediaPostprocessVisibilityService.buildReadyCondition('im');
}

function normalizePromptSearchValue(value: string): string {
  return value
    .replace(/\\/g, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/:[+-]?[\d.]+/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildWeightedLoraPromptSearchPattern(value: string, caseSensitive: boolean): string | null {
  const normalizedValue = normalizePromptSearchValue(value);
  const match = /^<lora:([^:>]+)>$/i.exec(normalizedValue);
  if (!match) {
    return null;
  }

  const prefix = `<lora:${match[1]}:`;
  return buildSqlContainsPattern(caseSensitive ? prefix : prefix.toLowerCase());
}

function appendUniquePattern(patterns: string[], pattern: string | null): string[] {
  if (!pattern || patterns.includes(pattern)) {
    return patterns;
  }
  return [...patterns, pattern];
}

const PROMPT_NORMALIZATION_SQL_REPLACEMENTS: Array<[string, string]> = [
  ['char(92)', "''"],
  ["'('", "''"],
  ["')'", "''"],
  ["'['", "''"],
  ["']'", "''"],
  ["'{'", "''"],
  ["'}'", "''"],
  ["'_'", "' '"],
];

function buildPromptNormalizedSqlExpression(valueExpression: string, caseSensitive: boolean): string {
  let expression = `COALESCE(${valueExpression}, '')`;
  for (const [from, to] of PROMPT_NORMALIZATION_SQL_REPLACEMENTS) {
    expression = `REPLACE(${expression}, ${from}, ${to})`;
  }
  return caseSensitive ? expression : `LOWER(${expression})`;
}

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
    const cteParams: any[] = [];
    const ctes: string[] = [];
    const statsSources: ComplexQueryStatsSources = {
      excluded: false,
      orResults: false,
      andResults: false,
    };
    const basicScope = this.buildBasicScopeConditions(basicParams);

    const buildScopedWhere = (groupConditions: string[], operator: 'OR' | 'AND') => {
      const scopedConditions = [getReadyImageCondition(), ...basicScope.conditions];
      if (groupConditions.length > 0) {
        scopedConditions.push(`(${groupConditions.join(` ${operator} `)})`);
      }

      return scopedConditions.length > 0
        ? `WHERE ${scopedConditions.join(' AND ')}`
        : '';
    };

    const addGroupCte = (
      cteName: 'excluded' | 'or_results' | 'and_results',
      conditions: FilterCondition[],
      operator: 'OR' | 'AND',
      includeEmptyGroup = false
    ) => {
      const groupParams: any[] = [];
      const groupResult = this.buildGroupQuery(conditions, operator, groupParams, weights);

      if (!includeEmptyGroup && groupResult.conditions.length === 0) {
        return false;
      }

      ctes.push(`
        ${cteName} AS (
          SELECT DISTINCT im.composite_hash
          FROM media_metadata im
          ${buildScopedWhere(groupResult.conditions, operator)}
        )
      `);
      cteParams.push(...basicScope.params, ...groupResult.params);
      return true;
    };

    // 1. Build EXCLUDE (NOT) CTE - highest priority
    if (filter.exclude_group && filter.exclude_group.length > 0) {
      statsSources.excluded = addGroupCte('excluded', filter.exclude_group, 'OR', true);
    }

    // 2. Build OR CTE
    if (filter.or_group && filter.or_group.length > 0) {
      statsSources.orResults = addGroupCte('or_results', filter.or_group, 'OR');
    }

    // 3. Build AND CTE
    if (filter.and_group && filter.and_group.length > 0) {
      statsSources.andResults = addGroupCte('and_results', filter.and_group, 'AND');
    }

    // Build final query. Basic search scope must apply to the final selection too:
    // OR/AND CTEs narrow matching sets, while exclude-only and no-group searches
    // still need the requested ai_tool/model/date constraints.
    const finalConditions: string[] = [getVisibleImageCondition(), getReadyImageCondition(), ...basicScope.conditions];
    const finalParams = [...basicScope.params];

    if (statsSources.orResults) {
      finalConditions.push('im.composite_hash IN (SELECT composite_hash FROM or_results)');
    }
    if (statsSources.andResults) {
      finalConditions.push('im.composite_hash IN (SELECT composite_hash FROM and_results)');
    }
    if (statsSources.excluded) {
      finalConditions.push('im.composite_hash NOT IN (SELECT composite_hash FROM excluded)');
    }

    const finalWhere = `WHERE ${finalConditions.join(' AND ')}`;

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

    const cteClause = ctes.length > 0 ? `WITH ${ctes.join(', ')}` : '';
    const query = cteClause.length > 0
      ? `${cteClause} ${selectClause} ${finalWhere}`
      : `${selectClause} ${finalWhere}`;

    return {
      query,
      params: [...cteParams, ...finalParams],
      cteClause,
      cteParams,
      statsSources,
    };
  }

  /** Build reusable basic search-scope conditions and parameters. */
  private static buildBasicScopeConditions(basicParams?: ComplexSearchScope): { conditions: string[]; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (basicParams?.ai_tool) {
      conditions.push('im.ai_tool = ?');
      params.push(basicParams.ai_tool);
    }
    if (basicParams?.model_name) {
      conditions.push(`im.model_name LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`);
      params.push(buildSqlContainsPattern(basicParams.model_name));
    }
    if (basicParams?.start_date) {
      conditions.push('DATE(im.first_seen_date) >= DATE(?)');
      params.push(basicParams.start_date);
    }
    if (basicParams?.end_date) {
      conditions.push('DATE(im.first_seen_date) <= DATE(?)');
      params.push(basicParams.end_date);
    }

    return { conditions, params };
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
   * Build SQL for basic conditions (ai_tool, model_name, lora_model)
   * 새 구조: media_metadata 테이블 사용 (im 별칭)
   */
  private static buildBasicConditionSQL(condition: FilterCondition, params: any[]): string | null {
    if (condition.type === 'ai_tool') {
      params.push(condition.value);
      return 'im.ai_tool = ?';
    }
    if (condition.type === 'ai_tool_group') {
      const normalizedValue = String(condition.value).trim().toLowerCase();

      if (normalizedValue === 'nai') {
        return `LOWER(COALESCE(im.ai_tool, '')) = 'novelai'`;
      }
      if (normalizedValue === 'comfyui') {
        return `LOWER(COALESCE(im.ai_tool, '')) = 'comfyui'`;
      }
      if (normalizedValue === 'other') {
        return `COALESCE(TRIM(im.ai_tool), '') != '' AND LOWER(im.ai_tool) NOT IN ('novelai', 'comfyui')`;
      }
      return null;
    }
    if (condition.type === 'model_name') {
      params.push(buildSqlContainsPattern(String(condition.value)));
      return `im.model_name LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
    }
    if (condition.type === 'lora_model') {
      params.push(buildSqlContainsPattern(String(condition.value).toLowerCase()));
      return `LOWER(COALESCE(im.lora_models, '')) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
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
        ? buildSqlContainsPattern(value)
        : buildSqlContainsPattern(value.toLowerCase());
      const normalizedValue = normalizePromptSearchValue(value);
      const normalizedPattern = normalizedValue && normalizedValue !== value
        ? buildSqlContainsPattern(condition.case_sensitive ? normalizedValue : normalizedValue.toLowerCase())
        : null;
      const normalizedAlternatePatterns = appendUniquePattern(
        appendUniquePattern([], normalizedPattern),
        buildWeightedLoraPromptSearchPattern(value, !!condition.case_sensitive)
      );

      // Positive prompt 검색은 NAI character prompt까지 포함
      if (!isNegative) {
        return this.buildPositivePromptSearchCondition(pattern, params, !!condition.case_sensitive, normalizedAlternatePatterns);
      }

      params.push(pattern);
      const rawCondition = condition.case_sensitive
        ? `${column} LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`
        : `LOWER(${column}) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
      if (normalizedAlternatePatterns.length > 0) {
        const normalizedCondition = `${buildPromptNormalizedSqlExpression(column, !!condition.case_sensitive)} LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
        params.push(...normalizedAlternatePatterns);
        return `(${[rawCondition, ...normalizedAlternatePatterns.map(() => normalizedCondition)].join(' OR ')})`;
      }
      return rawCondition;
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
    caseSensitive: boolean,
    normalizedPatterns: string[] = []
  ): string {
    const basePromptCondition = caseSensitive
      ? `im.prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`
      : `LOWER(im.prompt) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;

    const characterTextCondition = caseSensitive
      ? `im.character_prompt_text LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`
      : `LOWER(im.character_prompt_text) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;

    const charCaptionCondition = caseSensitive
      ? `COALESCE(json_extract(char_item.value, '$.char_caption'), '') LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`
      : `LOWER(COALESCE(json_extract(char_item.value, '$.char_caption'), '')) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;

    params.push(pattern, pattern, pattern);

    const normalizedBasePromptCondition = `${buildPromptNormalizedSqlExpression('im.prompt', caseSensitive)} LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
    const normalizedCharacterTextCondition = `${buildPromptNormalizedSqlExpression('im.character_prompt_text', caseSensitive)} LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
    const normalizedCharCaptionCondition = `${buildPromptNormalizedSqlExpression("json_extract(char_item.value, '$.char_caption')", caseSensitive)} LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
    const hasNormalizedPatterns = normalizedPatterns.length > 0;

    if (hasNormalizedPatterns) {
      params.push(...normalizedPatterns, ...normalizedPatterns, ...normalizedPatterns);
    }

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
      ${hasNormalizedPatterns ? `
      OR ${normalizedPatterns.map(() => normalizedBasePromptCondition).join('\n      OR ')}
      OR ${normalizedPatterns.map(() => normalizedCharacterTextCondition).join('\n      OR ')}
      OR (
        json_valid(im.raw_nai_parameters) = 1
        AND EXISTS (
          SELECT 1
          FROM json_each(im.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
          WHERE ${normalizedPatterns.map(() => normalizedCharCaptionCondition).join(' OR ')}
        )
      )` : ''}
    )`;
  }

  /**
   * Build SQL for auto-tag conditions
   * 새 구조: media_metadata 테이블 사용 (im 별칭)
   */
  private static buildAutoTagConditionSQL(condition: FilterCondition, params: any[], weights: RatingWeights | null): string | null {
    return buildComplexFilterAutoTagCondition(condition, params, weights);
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
    if (ImageSafetyService.isHidden(image.rating_score)) {
      return false;
    }

    const excludeMatches = this.evaluateConditionGroup(filter.exclude_group, image, 'OR');
    if (excludeMatches === true) {
      return false;
    }

    const orMatches = this.evaluateConditionGroup(filter.or_group, image, 'OR');
    if (orMatches === false) {
      return false;
    }

    const andMatches = this.evaluateConditionGroup(filter.and_group, image, 'AND');
    if (andMatches === false) {
      return false;
    }

    return true;
  }

  private static evaluateConditionGroup(
    conditions: FilterCondition[] | undefined,
    image: ImageMetadataRecord,
    operator: 'OR' | 'AND'
  ): boolean | null {
    const results = (conditions || [])
      .map((condition) => this.evaluateCondition(condition, image))
      .filter((result): result is boolean => result !== null);

    if (results.length === 0) {
      return null;
    }

    return operator === 'AND'
      ? results.every(Boolean)
      : results.some(Boolean);
  }

  private static evaluateCondition(
    condition: FilterCondition,
    image: ImageMetadataRecord
  ): boolean | null {
    switch (condition.category) {
      case 'basic':
        return this.evaluateBasicCondition(condition, image);
      case 'positive_prompt':
      case 'negative_prompt':
        return this.evaluatePromptCondition(condition, image);
      case 'auto_tag':
        return this.evaluateAutoTagCondition(condition, image);
      default:
        return null;
    }
  }

  private static evaluateBasicCondition(
    condition: FilterCondition,
    image: ImageMetadataRecord
  ): boolean | null {
    const value = String(condition.value ?? '');

    if (condition.type === 'ai_tool') {
      return (image.ai_tool || '') === value;
    }

    if (condition.type === 'ai_tool_group') {
      const normalizedValue = value.trim().toLowerCase();
      const aiTool = (image.ai_tool || '').trim().toLowerCase();

      if (normalizedValue === 'nai') {
        return aiTool === 'novelai';
      }
      if (normalizedValue === 'comfyui') {
        return aiTool === 'comfyui';
      }
      if (normalizedValue === 'other') {
        return aiTool !== '' && aiTool !== 'novelai' && aiTool !== 'comfyui';
      }
      return null;
    }

    if (condition.type === 'model_name') {
      return this.includesText(image.model_name, value, false);
    }

    if (condition.type === 'lora_model') {
      return this.includesText(image.lora_models, value, false);
    }

    return null;
  }

  private static evaluatePromptCondition(
    condition: FilterCondition,
    image: ImageMetadataRecord
  ): boolean | null {
    const value = String(condition.value ?? '');

    if (condition.type === 'prompt_contains') {
      return this.positivePromptIncludes(image, value, !!condition.case_sensitive);
    }

    if (condition.type === 'prompt_regex') {
      // Existing SQL path treats regex as a LIKE-style text match.
      return this.positivePromptIncludes(image, value, true);
    }

    if (condition.type === 'negative_prompt_contains') {
      return this.includesText(image.negative_prompt, value, !!condition.case_sensitive);
    }

    if (condition.type === 'negative_prompt_regex') {
      // Existing SQL path treats regex as a LIKE-style text match.
      return this.includesText(image.negative_prompt, value, true);
    }

    return null;
  }

  private static evaluateAutoTagCondition(
    condition: FilterCondition,
    image: ImageMetadataRecord
  ): boolean | null {
    if (condition.type === 'auto_tag_exists') {
      const exists = image.auto_tags !== null && image.auto_tags !== undefined;
      return condition.value === true ? exists : !exists;
    }

    if (condition.type === 'auto_tag_rating_score') {
      if (condition.min_score === undefined && condition.max_score === undefined) {
        return null;
      }
      return this.matchesNumericRange(image.rating_score, condition.min_score, condition.max_score, true);
    }

    const autoTags = this.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    if (condition.type === 'auto_tag_has_character') {
      const hasCharacter = this.hasNonEmptyObjectAtAnyPath(autoTags, AUTO_TAG_CHARACTER_JSON_PATHS);
      return condition.value === true ? hasCharacter : !hasCharacter;
    }

    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      if (condition.min_score === undefined && condition.max_score === undefined) {
        return null;
      }

      const value = this.readJsonPath(autoTags, `$.rating.${condition.rating_type}`)
        ?? this.readJsonPath(autoTags, `$.tagger.rating.${condition.rating_type}`);

      return this.matchesNumericRange(value, condition.min_score, condition.max_score, false);
    }

    if (condition.type === 'auto_tag_general') {
      return this.matchesAutoTagInPaths(autoTags, AUTO_TAG_GENERAL_JSON_PATHS, condition);
    }

    if (condition.type === 'auto_tag_character') {
      return this.matchesAutoTagInPaths(autoTags, AUTO_TAG_CHARACTER_JSON_PATHS, condition);
    }

    if (condition.type === 'auto_tag_any') {
      return this.matchesAutoTagInPaths(
        autoTags,
        [...AUTO_TAG_GENERAL_JSON_PATHS, ...AUTO_TAG_CHARACTER_JSON_PATHS],
        condition
      );
    }

    if (condition.type === 'auto_tag_model') {
      const model = this.readJsonPath(autoTags, '$.model')
        ?? this.readJsonPath(autoTags, '$.tagger.model')
        ?? this.readJsonPath(autoTags, '$.kaloscope.model');

      return model !== undefined && model !== null && String(model) === String(condition.value);
    }

    return null;
  }

  private static positivePromptIncludes(
    image: ImageMetadataRecord,
    value: string,
    caseSensitive: boolean
  ): boolean {
    const fields = [
      image.prompt,
      image.character_prompt_text,
      ...this.extractRawNaiCharacterCaptions(image.raw_nai_parameters),
    ];

    return fields.some((field) => this.includesText(field, value, caseSensitive));
  }

  private static includesText(
    source: string | null | undefined,
    value: string,
    caseSensitive: boolean
  ): boolean {
    if (!source || !value) {
      return false;
    }

    if (caseSensitive) {
      return source.includes(value);
    }

    return source.toLowerCase().includes(value.toLowerCase());
  }

  private static parseAutoTags(autoTags: string | null): any | null {
    if (!autoTags) {
      return null;
    }

    try {
      return JSON.parse(autoTags);
    } catch {
      return null;
    }
  }

  private static matchesAutoTagInPaths(
    autoTags: any,
    paths: readonly string[],
    condition: FilterCondition
  ): boolean {
    const variants = normalizeAutoTagSearchTerm(String(condition.value).toLowerCase(), true);

    return variants.some((variant) => paths.some((jsonPath) => {
      const bucket = this.readJsonPath(autoTags, jsonPath);
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        return false;
      }

      return Object.entries(bucket).some(([key, rawScore]) => {
        if (!key.toLowerCase().includes(variant)) {
          return false;
        }

        if (condition.min_score === undefined && condition.max_score === undefined) {
          return true;
        }

        return this.matchesNumericRange(rawScore, condition.min_score, condition.max_score, false);
      });
    }));
  }

  private static matchesNumericRange(
    rawValue: unknown,
    minScore: number | undefined,
    maxScore: number | undefined,
    maxExclusive: boolean
  ): boolean {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return false;
    }

    if (minScore !== undefined && value < minScore) {
      return false;
    }

    if (maxScore !== undefined) {
      return maxExclusive ? value < maxScore : value <= maxScore;
    }

    return true;
  }

  private static hasNonEmptyObjectAtAnyPath(autoTags: any, paths: readonly string[]): boolean {
    return paths.some((jsonPath) => {
      const value = this.readJsonPath(autoTags, jsonPath);
      return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
    });
  }

  private static readJsonPath(source: any, jsonPath: string): any {
    return jsonPath
      .replace(/^\$\.?/, '')
      .split('.')
      .filter(Boolean)
      .reduce((current, key) => current?.[key], source);
  }

  private static extractRawNaiCharacterCaptions(rawParameters: string | null): string[] {
    if (!rawParameters) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawParameters);
      const captions = parsed?.v4_prompt?.caption?.char_captions;
      if (!Array.isArray(captions)) {
        return [];
      }

      return captions
        .map((item) => item?.char_caption)
        .filter((caption): caption is string => typeof caption === 'string');
    } catch {
      return [];
    }
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
        condition.type === 'ai_tool' || condition.type === 'ai_tool_group' || condition.type === 'model_name' || condition.type === 'lora_model' ||
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
    basicParams?: ComplexSearchScope
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

