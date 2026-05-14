import type { Response } from 'express'
import { routeParam } from './routeParam'

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

function parseNumberIfDefined(value: unknown) {
  return value === undefined ? undefined : Number(value)
}

/** Validate an integer range only when the caller provided the field. */
export function validateIntegerInRangeIfDefined(
  res: Response,
  value: unknown,
  min: number,
  max: number,
  error: string,
) {
  const numericValue = parseNumberIfDefined(value)
  if (numericValue !== undefined && (!Number.isInteger(numericValue) || numericValue < min || numericValue > max)) {
    return sendRouteBadRequest(res, error)
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
  const numericValue = parseNumberIfDefined(value)
  if (numericValue !== undefined && (!Number.isFinite(numericValue) || numericValue < min || numericValue > max)) {
    return sendRouteBadRequest(res, error)
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
  const numericValue = parseNumberIfDefined(value)
  if (numericValue !== undefined && (!Number.isFinite(numericValue) || numericValue <= minExclusive)) {
    return sendRouteBadRequest(res, error)
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

type PositiveIntegerQueryOptions = {
  min?: number
  max?: number
  error: string
}

export type PositiveIntegerQueryResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

/** Parse one HTTP query integer without parseInt coercion. Missing input keeps the fallback. */
export function parsePositiveIntegerQuery(
  value: unknown,
  fallback: number,
  { min = 1, max, error }: PositiveIntegerQueryOptions,
): PositiveIntegerQueryResult {
  if (value === undefined) {
    return { ok: true, value: fallback }
  }

  if (Array.isArray(value) || typeof value === 'boolean' || value === null) {
    return { ok: false, error }
  }

  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    return { ok: false, error }
  }

  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    return { ok: false, error }
  }

  return { ok: true, value: parsed }
}

/** Parse one route parameter as an integer while preserving legacy parseInt behavior. */
export function parseRouteIntegerParam(value: string | string[] | undefined, radix?: number): number {
  const normalized = routeParam(value)
  return radix === undefined ? Number.parseInt(normalized) : Number.parseInt(normalized, radix)
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
