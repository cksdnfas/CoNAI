import { ComplexFilter, FilterCondition, removeWeights } from '@conai/shared';
import { RatingWeights } from '../../types/rating';
import { ImageSafetyService } from '../imageSafetyService';
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService';
import { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } from '../../utils/sqlLike';
import { buildComplexFilterAutoTagCondition } from './complexFilterAutoTagSql';

export type ComplexSearchScope = {
  ai_tool?: string;
  model_name?: string;
  start_date?: string;
  end_date?: string;
};

export type ComplexQueryStatsSources = {
  excluded: boolean;
  orResults: boolean;
  andResults: boolean;
};

export type ComplexQueryBuildResult = {
  query: string;
  params: any[];
  cteClause: string;
  cteParams: any[];
  statsSources: ComplexQueryStatsSources;
};

type BasicScopeConditions = {
  conditions: string[];
  params: any[];
};

function getVisibleImageCondition() {
  return ImageSafetyService.buildVisibleScoreCondition('im.rating_score');
}

function getReadyImageCondition() {
  return MediaPostprocessVisibilityService.buildReadyCondition('im');
}

function normalizePromptSearchValue(value: string): string {
  return removeWeights(value.replace(/\\([()[\]{}])/g, '$1'))
    .replace(/\s+/g, ' ')
    .trim();
}

function buildWeightedLoraPromptSearchPattern(value: string, caseSensitive: boolean): string | null {
  const normalizedValue = normalizePromptSearchValue(value)
    .replace(/(<lora:[^:>]+):[+-]?(?:\d+(?:\.\d*)?|\.\d+)>/i, '$1>');
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
];

function buildPromptNormalizedSqlExpression(valueExpression: string, caseSensitive: boolean): string {
  let expression = `COALESCE(${valueExpression}, '')`;
  for (const [from, to] of PROMPT_NORMALIZATION_SQL_REPLACEMENTS) {
    expression = `REPLACE(${expression}, ${from}, ${to})`;
  }
  return caseSensitive ? expression : `LOWER(${expression})`;
}

export function buildComplexFilterQuery(
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
  const basicScope = buildBasicScopeConditions(basicParams);

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
    const groupResult = buildGroupQuery(conditions, operator, groupParams, weights);

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

  if (filter.exclude_group && filter.exclude_group.length > 0) {
    statsSources.excluded = addGroupCte('excluded', filter.exclude_group, 'OR', true);
  }

  if (filter.or_group && filter.or_group.length > 0) {
    statsSources.orResults = addGroupCte('or_results', filter.or_group, 'OR');
  }

  if (filter.and_group && filter.and_group.length > 0) {
    statsSources.andResults = addGroupCte('and_results', filter.and_group, 'AND');
  }

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

function buildBasicScopeConditions(basicParams?: ComplexSearchScope): BasicScopeConditions {
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

function buildGroupQuery(
  conditions: FilterCondition[],
  operator: 'OR' | 'AND',
  params: any[],
  weights: RatingWeights | null
): { conditions: string[]; params: any[] } {
  const sqlConditions: string[] = [];

  for (const condition of conditions) {
    const conditionSql = buildConditionSQL(condition, params, weights);
    if (conditionSql) {
      sqlConditions.push(conditionSql);
    }
  }

  return { conditions: sqlConditions, params };
}

function buildConditionSQL(condition: FilterCondition, params: any[], weights: RatingWeights | null): string | null {
  switch (condition.category) {
    case 'basic':
      return buildBasicConditionSQL(condition, params);
    case 'positive_prompt':
      return buildPromptConditionSQL(condition, params, false);
    case 'negative_prompt':
      return buildPromptConditionSQL(condition, params, true);
    case 'auto_tag':
      return buildComplexFilterAutoTagCondition(condition, params, weights);
    default:
      return null;
  }
}

function buildBasicConditionSQL(condition: FilterCondition, params: any[]): string | null {
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

function buildPromptConditionSQL(
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
    const shouldUseNormalizedPromptMatch = normalizedValue && (normalizedValue !== value || /[()[\]{}]/.test(value));
    const normalizedPattern = shouldUseNormalizedPromptMatch
      ? buildSqlContainsPattern(condition.case_sensitive ? normalizedValue : normalizedValue.toLowerCase())
      : null;
    const normalizedAlternatePatterns = appendUniquePattern(
      appendUniquePattern([], normalizedPattern),
      buildWeightedLoraPromptSearchPattern(value, !!condition.case_sensitive)
    );

    if (!isNegative) {
      return buildPositivePromptSearchCondition(pattern, params, !!condition.case_sensitive, normalizedAlternatePatterns);
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
    const pattern = `%${String(condition.value)}%`;

    if (!isNegative) {
      return buildPositivePromptSearchCondition(pattern, params, true);
    }

    params.push(pattern);
    return `${column} LIKE ?`;
  }

  return null;
}

function buildPositivePromptSearchCondition(
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
    OR ${normalizedPatterns.map(() => normalizedBasePromptCondition).join('\n    OR ')}
    OR ${normalizedPatterns.map(() => normalizedCharacterTextCondition).join('\n    OR ')}
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
