export function getSortedEntries(scores: Record<string, number> | undefined) {
  return Object.entries(scores ?? {}).sort(([, left], [, right]) => right - left)
}

const RATING_PROMPT_TAGS = new Set(['general', 'safe', 'sensitive', 'questionable', 'explicit'])

export function isRatingPromptTag(tag: string) {
  return RATING_PROMPT_TAGS.has(tag.trim().toLowerCase())
}

export function formatPromptTagCopyText(tags: string[]) {
  const seen = new Set<string>()
  const tokens: string[] = []

  for (const rawTag of tags) {
    const tag = rawTag.trim()
    const key = tag.toLowerCase()

    if (!tag || isRatingPromptTag(tag) || seen.has(key)) {
      continue
    }

    seen.add(key)
    tokens.push(tag)
  }

  return tokens.join(', ')
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
