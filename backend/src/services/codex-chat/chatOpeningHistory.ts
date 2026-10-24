/** Shared by profile normalization and the user-settings migration without loading profile stores. */
export const TEXT_MAX_LENGTH = 20_000
export const OPENING_HISTORY_MAX_ENTRIES = 100

export type ChatOpeningMessage = { role: 'user' | 'assistant'; content: string }

export function normalizeOpeningHistory(value: unknown): ChatOpeningMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, OPENING_HISTORY_MAX_ENTRIES).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.content !== 'string') return []
    const content = entry.content.trim().slice(0, TEXT_MAX_LENGTH)
    return content ? [{ role: entry.role as ChatOpeningMessage['role'], content }] : []
  })
}

export function normalizeGreetingPosition(value: unknown, historyLength: number): number {
  const position = Number(value)
  return Number.isFinite(position) ? Math.max(0, Math.min(historyLength, Math.trunc(position))) : 0
}

/**
 * The greeting's place in the history normalizeOpeningHistory keeps: entries it drops before the greeting (blank,
 * malformed or past the cap) do not count, so a blank message left open in an editor does not move the greeting.
 */
export function keptGreetingPosition(history: unknown, position: unknown): number {
  const raw = Array.isArray(history) ? history : []
  return normalizeOpeningHistory(raw.slice(0, normalizeGreetingPosition(position, raw.length))).length
}
