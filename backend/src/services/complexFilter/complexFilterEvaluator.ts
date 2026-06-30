import { ComplexFilter, FilterCondition } from '@conai/shared';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
} from '../autoTagSqlShared';
import { normalizeAutoTagSearchTerm } from '../autoTagSearch/autoTagSearchTerms';
import { ImageSafetyService } from '../imageSafetyService';
import { ImageMetadataRecord } from '../../types/image';

export function matchesComplexFilterImage(filter: ComplexFilter, image: ImageMetadataRecord): boolean {
  if (ImageSafetyService.isHidden(image.rating_score)) {
    return false;
  }

  const excludeMatches = evaluateConditionGroup(filter.exclude_group, image, 'OR');
  if (excludeMatches === true) {
    return false;
  }

  const orMatches = evaluateConditionGroup(filter.or_group, image, 'OR');
  if (orMatches === false) {
    return false;
  }

  const andMatches = evaluateConditionGroup(filter.and_group, image, 'AND');
  if (andMatches === false) {
    return false;
  }

  return true;
}

function evaluateConditionGroup(
  conditions: FilterCondition[] | undefined,
  image: ImageMetadataRecord,
  operator: 'OR' | 'AND'
): boolean | null {
  const results = (conditions || [])
    .map((condition) => evaluateCondition(condition, image))
    .filter((result): result is boolean => result !== null);

  if (results.length === 0) {
    return null;
  }

  return operator === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function evaluateCondition(
  condition: FilterCondition,
  image: ImageMetadataRecord
): boolean | null {
  switch (condition.category) {
    case 'basic':
      return evaluateBasicCondition(condition, image);
    case 'positive_prompt':
    case 'negative_prompt':
      return evaluatePromptCondition(condition, image);
    case 'auto_tag':
      return evaluateAutoTagCondition(condition, image);
    default:
      return null;
  }
}

function evaluateBasicCondition(
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
    return includesText(image.model_name, value, false);
  }

  if (condition.type === 'lora_model') {
    return includesText(image.lora_models, value, false);
  }

  return null;
}

function evaluatePromptCondition(
  condition: FilterCondition,
  image: ImageMetadataRecord
): boolean | null {
  const value = String(condition.value ?? '');

  if (condition.type === 'prompt_contains') {
    return positivePromptIncludes(image, value, !!condition.case_sensitive);
  }

  if (condition.type === 'prompt_regex') {
    return positivePromptIncludes(image, value, true);
  }

  if (condition.type === 'negative_prompt_contains') {
    return includesText(image.negative_prompt, value, !!condition.case_sensitive);
  }

  if (condition.type === 'negative_prompt_regex') {
    return includesText(image.negative_prompt, value, true);
  }

  return null;
}

function evaluateAutoTagCondition(
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
    return matchesNumericRange(image.rating_score, condition.min_score, condition.max_score, true);
  }

  const autoTags = parseAutoTags(image.auto_tags);
  if (!autoTags) {
    return false;
  }

  if (condition.type === 'auto_tag_has_character') {
    const hasCharacter = hasNonEmptyObjectAtAnyPath(autoTags, AUTO_TAG_CHARACTER_JSON_PATHS);
    return condition.value === true ? hasCharacter : !hasCharacter;
  }

  if (condition.type === 'auto_tag_rating' && condition.rating_type) {
    if (condition.min_score === undefined && condition.max_score === undefined) {
      return null;
    }

    const value = readJsonPath(autoTags, `$.rating.${condition.rating_type}`)
      ?? readJsonPath(autoTags, `$.tagger.rating.${condition.rating_type}`);

    return matchesNumericRange(value, condition.min_score, condition.max_score, false);
  }

  if (condition.type === 'auto_tag_general') {
    return matchesAutoTagInPaths(autoTags, AUTO_TAG_GENERAL_JSON_PATHS, condition);
  }

  if (condition.type === 'auto_tag_character') {
    return matchesAutoTagInPaths(autoTags, AUTO_TAG_CHARACTER_JSON_PATHS, condition);
  }

  if (condition.type === 'auto_tag_any') {
    return matchesAutoTagInPaths(
      autoTags,
      [...AUTO_TAG_GENERAL_JSON_PATHS, ...AUTO_TAG_CHARACTER_JSON_PATHS],
      condition
    );
  }

  if (condition.type === 'auto_tag_model') {
    const model = readJsonPath(autoTags, '$.model')
      ?? readJsonPath(autoTags, '$.tagger.model')
      ?? readJsonPath(autoTags, '$.kaloscope.model');

    return model !== undefined && model !== null && String(model) === String(condition.value);
  }

  return null;
}

function positivePromptIncludes(
  image: ImageMetadataRecord,
  value: string,
  caseSensitive: boolean
): boolean {
  const fields = [
    image.prompt,
    image.character_prompt_text,
    ...extractRawNaiCharacterCaptions(image.raw_nai_parameters),
  ];

  return fields.some((field) => includesText(field, value, caseSensitive));
}

function includesText(
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

function parseAutoTags(autoTags: string | null): any | null {
  if (!autoTags) {
    return null;
  }

  try {
    return JSON.parse(autoTags);
  } catch {
    return null;
  }
}

function matchesAutoTagInPaths(
  autoTags: any,
  paths: readonly string[],
  condition: FilterCondition
): boolean {
  const variants = normalizeAutoTagSearchTerm(String(condition.value).toLowerCase(), true);

  return variants.some((variant) => paths.some((jsonPath) => {
    const bucket = readJsonPath(autoTags, jsonPath);
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

      return matchesNumericRange(rawScore, condition.min_score, condition.max_score, false);
    });
  }));
}

function matchesNumericRange(
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

function hasNonEmptyObjectAtAnyPath(autoTags: any, paths: readonly string[]): boolean {
  return paths.some((jsonPath) => {
    const value = readJsonPath(autoTags, jsonPath);
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
  });
}

function readJsonPath(source: any, jsonPath: string): any {
  return jsonPath
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], source);
}

function extractRawNaiCharacterCaptions(rawParameters: string | null): string[] {
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
