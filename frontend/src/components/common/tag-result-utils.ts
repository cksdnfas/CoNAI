export function getSortedEntries(scores: Record<string, number> | undefined) {
  return Object.entries(scores ?? {}).sort(([, left], [, right]) => right - left)
}

export function parseTaglistTokens(taglist: string | undefined) {
  if (!taglist) {
    return []
  }

  const seen = new Set<string>()
  const tokens: string[] = []

  for (const rawToken of taglist.split(',')) {
    const token = rawToken.trim()
    if (!token || seen.has(token)) {
      continue
    }

    seen.add(token)
    tokens.push(token)
  }

  return tokens
}

export function formatScore(score: number) {
  return `${(score * 100).toFixed(score >= 0.995 ? 0 : 1)}%`
}
