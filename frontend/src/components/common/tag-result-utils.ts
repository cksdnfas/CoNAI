export function getSortedEntries(scores: Record<string, number> | undefined) {
  return Object.entries(scores ?? {}).sort(([, left], [, right]) => right - left)
}

export function formatScore(score: number) {
  return `${(score * 100).toFixed(score >= 0.995 ? 0 : 1)}%`
}
