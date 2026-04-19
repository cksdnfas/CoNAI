import type { Response } from 'express'

/** Send the standard 400 validation payload without changing route response shape. */
export function sendRouteBadRequest(res: Response, error: string) {
  res.status(400).json({
    success: false,
    error,
  })
  return false
}

/** Validate a boolean field only when the caller provided it. */
export function validateBooleanIfDefined(res: Response, value: unknown, error: string) {
  if (value !== undefined && typeof value !== 'boolean') {
    return sendRouteBadRequest(res, error)
  }

  return true
}

/** Validate an integer range only when the caller provided the field. */
export function validateIntegerInRangeIfDefined(
  res: Response,
  value: unknown,
  min: number,
  max: number,
  error: string,
) {
  if (value !== undefined) {
    const numericValue = Number(value)
    if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
      return sendRouteBadRequest(res, error)
    }
  }

  return true
}

/** Validate a numeric range only when the caller provided the field. */
export function validateNumberInRangeIfDefined(
  res: Response,
  value: unknown,
  min: number,
  max: number,
  error: string,
) {
  if (value !== undefined) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
      return sendRouteBadRequest(res, error)
    }
  }

  return true
}

/** Validate that a number is greater than one lower bound when provided. */
export function validateNumberGreaterThanIfDefined(
  res: Response,
  value: unknown,
  minExclusive: number,
  error: string,
) {
  if (value !== undefined) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue <= minExclusive) {
      return sendRouteBadRequest(res, error)
    }
  }

  return true
}

/** Validate that an optional string belongs to one supported value set. */
export function validateStringEnumIfDefined<T extends string>(
  res: Response,
  value: unknown,
  validValues: readonly T[],
  error: string,
) {
  if (value !== undefined && (typeof value !== 'string' || !validValues.includes(value as T))) {
    return sendRouteBadRequest(res, error)
  }

  return true
}

/** Parse one optional positive integer field while treating empty input as missing. */
export function parsePositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** Parse an integer query value while keeping the provided fallback for invalid input. */
export function parseIntegerWithFallback(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Parse a numeric query value while keeping the provided fallback for invalid input. */
export function parseNumberWithFallback(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
