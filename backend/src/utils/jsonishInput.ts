/** Parse a JSON-ish editor value while preserving already-parsed values and invalid text for validation. */
export function parseJsonishInput(value: unknown, fallback: unknown) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') return value
  const trimmedValue = value.trim()
  if (!trimmedValue) return fallback
  try {
    return JSON.parse(trimmedValue)
  } catch {
    return value
  }
}
