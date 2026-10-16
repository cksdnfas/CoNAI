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
