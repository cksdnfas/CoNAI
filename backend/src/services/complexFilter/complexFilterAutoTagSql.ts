import { FilterCondition } from '@conai/shared';
import { RatingWeights } from '../../types/rating';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
  buildAutoTagExistsForPaths,
  buildAutoTagModelExpr,
  buildAutoTagRatingExpr,
  pushAutoTagPathMatchParams,
} from '../autoTagSqlShared';
import { normalizeAutoTagSearchTerm } from '../autoTagSearch/autoTagSearchTerms';
import { AutoTagIndexService, MEDIA_ROW_ID_COLUMN, buildIndexedMediaSubquery } from '../autoTagIndexService';

/** Build the complex-filter SQL fragment for one auto-tag condition. */
export function buildComplexFilterAutoTagCondition(
  condition: FilterCondition,
  params: any[],
  _weights: RatingWeights | null,
): string | null {
  const canUseIndex = AutoTagIndexService.hasIndexTable();

  if (condition.type === 'auto_tag_exists') {
    return condition.value === true
      ? 'im.auto_tags IS NOT NULL'
      : 'im.auto_tags IS NULL';
  }

  if (condition.type === 'auto_tag_has_character') {
    if (canUseIndex) {
      return condition.value === true
        ? buildIndexedHasTypeCondition(params, ['character'], false)
        : buildIndexedHasTypeCondition(params, ['character'], true);
    }

    if (condition.value === true) {
      return `(
        (
          json_extract(im.auto_tags, '$.character') IS NOT NULL
          AND json_type(im.auto_tags, '$.character') = 'object'
          AND json_extract(im.auto_tags, '$.character') != '{}'
        )
        OR
        (
          json_extract(im.auto_tags, '$.tagger.character') IS NOT NULL
          AND json_type(im.auto_tags, '$.tagger.character') = 'object'
          AND json_extract(im.auto_tags, '$.tagger.character') != '{}'
        )
      )`;
    }

    return `(
      (
        json_extract(im.auto_tags, '$.character') IS NULL
        OR json_type(im.auto_tags, '$.character') != 'object'
        OR json_extract(im.auto_tags, '$.character') = '{}'
      )
      AND
      (
        json_extract(im.auto_tags, '$.tagger.character') IS NULL
        OR json_type(im.auto_tags, '$.tagger.character') != 'object'
        OR json_extract(im.auto_tags, '$.tagger.character') = '{}'
      )
    )`;
  }

  if (condition.type === 'auto_tag_rating' && condition.rating_type) {
    const conditions: string[] = [];

    if (condition.min_score !== undefined) {
      params.push(condition.min_score);
      conditions.push(`${buildAutoTagRatingExpr('im', condition.rating_type as 'general' | 'sensitive' | 'questionable' | 'explicit')} >= ?`);
    }
    if (condition.max_score !== undefined) {
      params.push(condition.max_score);
      conditions.push(`${buildAutoTagRatingExpr('im', condition.rating_type as 'general' | 'sensitive' | 'questionable' | 'explicit')} <= ?`);
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  if (condition.type === 'auto_tag_rating_score') {
    const conditions: string[] = [];

    if (condition.min_score !== undefined) {
      params.push(condition.min_score);
      conditions.push(`im.rating_score >= ?`);
    }
    if (condition.max_score !== undefined) {
      params.push(condition.max_score);
      conditions.push(`im.rating_score < ?`);
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  if (condition.type === 'auto_tag_general') {
    if (canUseIndex) {
      return buildIndexedTagMatchCondition(condition, params, ['general']);
    }

    return buildComplexFilterTagExistsCondition(
      condition,
      params,
      AUTO_TAG_GENERAL_JSON_PATHS,
    );
  }

  if (condition.type === 'auto_tag_character') {
    if (canUseIndex) {
      return buildIndexedTagMatchCondition(condition, params, ['character']);
    }

    return buildComplexFilterTagExistsCondition(
      condition,
      params,
      AUTO_TAG_CHARACTER_JSON_PATHS,
    );
  }

  if (condition.type === 'auto_tag_model') {
    if (canUseIndex) {
      return buildIndexedModelCondition(condition, params);
    }

    params.push(condition.value);
    return `${buildAutoTagModelExpr('im')} = ?`;
  }

  if (condition.type === 'auto_tag_any') {
    if (canUseIndex) {
      return buildIndexedTagMatchCondition(condition, params, ['general', 'character']);
    }

    const tag = String(condition.value).toLowerCase();
    // Complex filters represent selected chips; keep multi-word tags as one tag instead of OR-ing each token.
    const variants = normalizeAutoTagSearchTerm(tag, true);
    const anyConditions: string[] = [];

    for (const variant of variants) {
      const generalCondition = buildAutoTagExistsForPaths(
        'im',
        AUTO_TAG_GENERAL_JSON_PATHS,
        buildComplexFilterTagPredicate(condition),
      );

      const characterCondition = buildAutoTagExistsForPaths(
        'im',
        AUTO_TAG_CHARACTER_JSON_PATHS,
        buildComplexFilterTagPredicate(condition),
      );

      anyConditions.push(`(${generalCondition} OR ${characterCondition})`);

      pushAutoTagPathMatchParams(
        params,
        AUTO_TAG_GENERAL_JSON_PATHS.length,
        variant,
        condition.min_score,
        condition.max_score,
      );

      pushAutoTagPathMatchParams(
        params,
        AUTO_TAG_CHARACTER_JSON_PATHS.length,
        variant,
        condition.min_score,
        condition.max_score,
      );
    }

    return anyConditions.length > 0 ? `(${anyConditions.join(' OR ')})` : null;
  }

  return null;
}

function wrapIndexedSubquery(
  params: any[],
  subquery: ReturnType<typeof buildIndexedMediaSubquery>,
  negate = false,
): string | null {
  if (!subquery) {
    return null;
  }
  params.push(...subquery.params);
  return `im.${MEDIA_ROW_ID_COLUMN} ${negate ? 'NOT ' : ''}IN (${subquery.sql})`;
}

function buildIndexedHasTypeCondition(params: any[], tagTypes: readonly string[], negate: boolean): string {
  return wrapIndexedSubquery(params, buildIndexedMediaSubquery({ tagTypes }), negate) as string;
}

function buildIndexedModelCondition(condition: FilterCondition, params: any[]): string | null {
  return wrapIndexedSubquery(params, buildIndexedMediaSubquery({ tagTypes: ['model'], tag: String(condition.value) }));
}

function buildIndexedTagMatchCondition(
  condition: FilterCondition,
  params: any[],
  tagTypes: readonly string[],
): string | null {
  return wrapIndexedSubquery(params, buildIndexedMediaSubquery({
    tagTypes,
    tag: String(condition.value),
    minScore: condition.min_score,
    maxScore: condition.max_score,
  }));
}

/** Build a repeated EXISTS condition for general/character auto-tag filters. */
function buildComplexFilterTagExistsCondition(
  condition: FilterCondition,
  params: any[],
  jsonPaths: readonly string[],
): string | null {
  const normalizedValue = String(condition.value).toLowerCase();
  // Complex filters represent selected chips; keep multi-word tags as one tag instead of OR-ing each token.
  const variants = normalizeAutoTagSearchTerm(normalizedValue, true);
  const tagConditions: string[] = [];

  for (const variant of variants) {
    const existsCondition = buildAutoTagExistsForPaths(
      'im',
      jsonPaths,
      buildComplexFilterTagPredicate(condition),
    );

    tagConditions.push(existsCondition);
    pushAutoTagPathMatchParams(
      params,
      jsonPaths.length,
      variant,
      condition.min_score,
      condition.max_score,
    );
  }

  return tagConditions.length > 0 ? `(${tagConditions.join(' OR ')})` : null;
}

/** Build the shared key/value predicate used inside json_each EXISTS checks. */
function buildComplexFilterTagPredicate(condition: FilterCondition): string {
  return `LOWER(key) LIKE ?${condition.min_score !== undefined ? ' AND value >= ?' : ''}${condition.max_score !== undefined ? ' AND value <= ?' : ''}`;
}
