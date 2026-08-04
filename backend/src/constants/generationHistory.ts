export const DEFAULT_GENERATION_HISTORY_MAX_ITEMS = 10_000;
export const MIN_GENERATION_HISTORY_MAX_ITEMS = 1;
export const MAX_GENERATION_HISTORY_MAX_ITEMS = 1_000_000;

/** Normalize persisted or environment-provided history limits into the supported range. */
export function normalizeGenerationHistoryMaxItems(
  value: unknown,
  fallback = DEFAULT_GENERATION_HISTORY_MAX_ITEMS,
): number {
  if (value === null || value === undefined || value === '') {
    return normalizeGenerationHistoryMaxItems(fallback, DEFAULT_GENERATION_HISTORY_MAX_ITEMS);
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return normalizeGenerationHistoryMaxItems(fallback, DEFAULT_GENERATION_HISTORY_MAX_ITEMS);
  }

  return Math.min(
    MAX_GENERATION_HISTORY_MAX_ITEMS,
    Math.max(MIN_GENERATION_HISTORY_MAX_ITEMS, Math.floor(parsed)),
  );
}
