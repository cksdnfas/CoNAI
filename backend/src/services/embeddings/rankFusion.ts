/** Ranking helpers for text-embedding results (no imports: keyword search modules use them too). */

/** Vector spaces of text embeddings (see semanticIndex). */
export const SEMANTIC_SPACES = {
  recall: 'chat-recall',
  lore: 'chat-lore',
  message: 'chat-message',
  file: 'file',
  post: 'post-knowledge',
} as const

/** Reciprocal rank fusion of several best-first rankings (k = 60, the usual damping). */
export function fuseRanks<K>(rankings: ReadonlyArray<ReadonlyArray<K>>, k = 60) {
  const scores = new Map<K, number>()
  for (const ranking of rankings) {
    ranking.forEach((key, index) => scores.set(key, (scores.get(key) ?? 0) + 1 / (k + index + 1)))
  }
  return scores
}

/** Fewer candidates than this make the median meaningless: a higher bar applies instead. */
const MIN_FOR_MEDIAN = 5
const SMALL_SET_MIN_SCORE = 0.7

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Items clearly closer than the rest, best first. EmbeddingGemma's scores sit in a narrow band (unrelated text is
 * still ~0.6), so an item counts by its lead over the median candidate, with `minScore` as a floor; with few
 * candidates, by a high score instead.
 */
export function standouts<K>(scores: ReadonlyMap<K, number>, minScore: number, minLead: number): Array<[K, number]> {
  const values = [...scores.values()]
  const floor = values.length >= MIN_FOR_MEDIAN ? Math.max(minScore, median(values) + minLead) : Math.max(minScore, SMALL_SET_MIN_SCORE)
  return [...scores.entries()].filter(([, score]) => score >= floor).sort((a, b) => b[1] - a[1])
}
