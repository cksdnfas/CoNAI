export const BACKGROUND_MEDIA_RETRY_BASE_DELAY_MS = 5_000;
export const BACKGROUND_MEDIA_RETRY_MAX_DELAY_MS = 15 * 60_000;

/** Persisted per-row backoff keeps one broken file from monopolizing every batch. */
export function resolveBackgroundMediaRetryDelayMs(
  attemptCount: number,
  baseDelayMs = BACKGROUND_MEDIA_RETRY_BASE_DELAY_MS,
  maxDelayMs = BACKGROUND_MEDIA_RETRY_MAX_DELAY_MS,
): number {
  const safeAttempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(baseDelayMs * Math.pow(2, safeAttempt - 1), maxDelayMs);
}

/** SQLite CURRENT_TIMESTAMP uses this UTC representation. */
export function toSqliteUtcDateTime(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 19).replace('T', ' ');
}
