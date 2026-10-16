/** Parse stored JSON text; empty, non-string or malformed input returns `fallback` (one bad row must not fail a list). */
export function parseJsonOr<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a JSON object that may arrive already parsed or as text; anything that is not an object becomes `{}` (a shallow copy). */
export function parseJsonRecord(value: unknown): Record<string, any> {
  if (isPlainRecord(value)) {
    return { ...value };
  }

  const parsed = typeof value === 'string' && value.trim() ? parseJsonOr<unknown>(value, null) : null;
  return isPlainRecord(parsed) ? { ...parsed } : {};
}
