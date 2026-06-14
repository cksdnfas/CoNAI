import { FilterCondition, FilterValidationResult, ComplexFilter } from '@conai/shared';

export function validateComplexFilter(filter: ComplexFilter): FilterValidationResult {
  const errors: string[] = [];

  if (filter.exclude_group) {
    errors.push(...validateConditions(filter.exclude_group, 'Exclude'));
  }
  if (filter.or_group) {
    errors.push(...validateConditions(filter.or_group, 'OR'));
  }
  if (filter.and_group) {
    errors.push(...validateConditions(filter.and_group, 'AND'));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateConditions(conditions: FilterCondition[], groupName: string): string[] {
  const errors: string[] = [];

  conditions.forEach((condition, index) => {
    if (!condition.category) {
      errors.push(`${groupName} group, condition ${index + 1}: category is required`);
    }
    if (!condition.type) {
      errors.push(`${groupName} group, condition ${index + 1}: type is required`);
    }

    if (condition.type === 'auto_tag_exists' || condition.type === 'auto_tag_has_character') {
      if (typeof condition.value !== 'boolean') {
        errors.push(`${groupName} group, condition ${index + 1}: value must be boolean for ${condition.type}`);
      }
    } else if (requiresStringValue(condition.type)) {
      if (typeof condition.value !== 'string' || condition.value.trim() === '') {
        errors.push(`${groupName} group, condition ${index + 1}: value must be a non-empty string for ${condition.type}`);
      }
    } else if (condition.type === 'auto_tag_rating' || condition.type === 'auto_tag_rating_score') {
      if (condition.min_score === undefined && condition.max_score === undefined) {
        errors.push(`${groupName} group, condition ${index + 1}: at least one of min_score or max_score is required for ${condition.type}`);
      }
    } else if (condition.value === undefined || condition.value === null) {
      errors.push(`${groupName} group, condition ${index + 1}: value is required`);
    }

    if (condition.type !== 'auto_tag_rating_score') {
      if (condition.min_score !== undefined && (condition.min_score < 0 || condition.min_score > 1)) {
        errors.push(`${groupName} group, condition ${index + 1}: min_score must be between 0 and 1`);
      }
      if (condition.max_score !== undefined && (condition.max_score < 0 || condition.max_score > 1)) {
        errors.push(`${groupName} group, condition ${index + 1}: max_score must be between 0 and 1`);
      }
    }

    if (condition.min_score !== undefined && condition.max_score !== undefined && condition.min_score > condition.max_score) {
      errors.push(`${groupName} group, condition ${index + 1}: min_score cannot be greater than max_score`);
    }

    if (condition.type === 'auto_tag_rating' && !condition.rating_type) {
      errors.push(`${groupName} group, condition ${index + 1}: rating_type is required for auto_tag_rating`);
    }
  });

  return errors;
}

function requiresStringValue(type: string): boolean {
  return type === 'auto_tag_general'
    || type === 'auto_tag_character'
    || type === 'prompt_contains'
    || type === 'prompt_regex'
    || type === 'negative_prompt_contains'
    || type === 'negative_prompt_regex'
    || type === 'ai_tool'
    || type === 'ai_tool_group'
    || type === 'model_name'
    || type === 'lora_model'
    || type === 'auto_tag_model'
    || type === 'auto_tag_any';
}
