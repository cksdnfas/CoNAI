/**
 * Validation utilities
 * Shared validation functions to ensure consistency across backend and frontend
 */

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate and parse ID parameter
 * Used extensively across backend routes (188+ locations)
 * @param id - ID string or number to validate
 * @param fieldName - Name of the field for error messages (default: 'ID')
 * @returns Validated number ID
 * @throws ValidationError if ID is invalid
 */
export function validateId(id: string | number, fieldName: string = 'ID'): number {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;

  if (isNaN(numId) || numId < 0 || !Number.isFinite(numId)) {
    throw new ValidationError(`Invalid ${fieldName}`);
  }

  return numId;
}

/**
 * Validate required string field
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @param minLength - Minimum length (default: 1)
 * @returns Trimmed string
 * @throws ValidationError if string is empty or too short
 */
export function validateRequiredString(
  value: string | undefined | null,
  fieldName: string,
  minLength: number = 1
): string {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required`);
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new ValidationError(`${fieldName} must be at least ${minLength} character(s)`);
  }

  return trimmed;
}

/**
 * Validate enum value
 * @param value - Value to validate
 * @param validValues - Array of valid values
 * @param fieldName - Name of the field for error messages
 * @returns Validated value
 * @throws ValidationError if value is not in valid values
 */
export function validateEnum<T extends string>(
  value: string,
  validValues: readonly T[],
  fieldName: string
): T {
  if (!validValues.includes(value as T)) {
    throw new ValidationError(
      `Invalid ${fieldName}. Must be one of: ${validValues.join(', ')}`
    );
  }
  return value as T;
}

/**
 * Validate number range
 * @param value - Number to validate
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @param fieldName - Name of the field for error messages
 * @throws ValidationError if value is out of range
 */
export function validateRange(
  value: number | undefined,
  min: number,
  max: number,
  fieldName: string
): void {
  if (value === undefined) return;

  if (typeof value !== 'number' || isNaN(value)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }

  if (value < min || value > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max}`
    );
  }
}

/**
 * Validate min < max constraint
 * @param min - Minimum value
 * @param max - Maximum value
 * @param fieldName - Name of the field for error messages
 * @throws ValidationError if min >= max
 */
export function validateMinMax(
  min: number | undefined,
  max: number | undefined,
  fieldName: string
): void {
  if (min !== undefined && max !== undefined && min >= max) {
    throw new ValidationError(`${fieldName} min must be less than max`);
  }
}

/**
 * Validate and parse JSON string
 * @param jsonString - JSON string to parse
 * @param fieldName - Name of the field for error messages
 * @returns Parsed object
 * @throws ValidationError if JSON is invalid
 */
export function validateAndParseJSON<T = any>(
  jsonString: string,
  fieldName: string = 'JSON'
): T {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new ValidationError(`Invalid ${fieldName}: must be valid JSON`);
  }
}

/**
 * Validate regex pattern
 * @param pattern - Regex pattern string
 * @param fieldName - Name of the field for error messages
 * @returns Compiled RegExp object
 * @throws ValidationError if pattern is invalid
 */
export function validateRegexPattern(
  pattern: string,
  fieldName: string = 'Pattern'
): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ValidationError(`Invalid ${fieldName}: ${message}`);
  }
}
