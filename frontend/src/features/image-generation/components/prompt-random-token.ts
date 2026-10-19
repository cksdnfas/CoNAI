/**
 * Editor-side helpers for random prompt tokens. Parsing and serializing live in `@conai/shared` (promptRandomToken),
 * which the backend resolver uses too, so chips and generation always read the syntax the same way.
 */
import { formatPromptCompactCount, type PromptRandomToken, type PromptRandomTokenSpec } from '@conai/shared'

export {
  convertLegacyPromptSyntax,
  findPromptRandomTokens,
  replacePromptRange,
  serializePromptRandomToken,
  type PromptRandomPick,
  type PromptRandomToken,
  type PromptRandomTokenSource,
  type PromptRandomTokenSpec,
  type PromptRandomUsage,
} from '@conai/shared'

/** Short chip text: `hair_color · 1~2개 · 1K+`. */
export function formatPromptRandomTokenLabel(spec: PromptRandomTokenSpec) {
  const parts = [spec.name]
  if (spec.source !== 'wildcard') {
    if (spec.pick.min !== 1 || spec.pick.max !== 1) {
      parts.push(spec.pick.min === spec.pick.max ? `${spec.pick.min}개` : `${spec.pick.min}~${spec.pick.max}개`)
    }
    if (spec.usage.min !== undefined) {
      parts.push(`${formatPromptCompactCount(spec.usage.min).toUpperCase()}+`)
    }
    if (spec.usage.max !== undefined) {
      parts.push(`≤${formatPromptCompactCount(spec.usage.max).toUpperCase()}`)
    }
  }
  return parts.join(' · ')
}

/** Remove one token and the comma separator that followed (or preceded) it. */
export function removePromptRandomToken(value: string, token: Pick<PromptRandomToken, 'start' | 'end'>) {
  const after = value.slice(token.end)
  const trailing = after.match(/^\s*,\s*/)
  if (trailing) {
    return `${value.slice(0, token.start)}${after.slice(trailing[0].length)}`
  }
  const before = value.slice(0, token.start)
  const leading = before.match(/\s*,\s*$/)
  return `${leading ? before.slice(0, before.length - leading[0].length) : before}${after}`
}

/**
 * The palette query before the caret, opened by `@query` or by an unfinished `__query` / `__tag:query` / `__my:query`
 * (the `__` forms preselect the matching palette tab).
 */
export function resolveActivePaletteQuery(value: string, caretPosition: number): { start: number; end: number; query: string; tab: 'all' | 'wildcard' | 'tag' | 'my' } | null {
  const caret = Math.max(0, Math.min(caretPosition, value.length))
  const prefix = value.slice(0, caret)
  const isBoundary = (index: number) => index <= 0 || /[\s,(]/.test(prefix[index - 1] ?? '')

  const atIndex = prefix.lastIndexOf('@')
  const underscoreIndex = prefix.lastIndexOf('__')

  if (underscoreIndex > atIndex && isBoundary(underscoreIndex)) {
    const closingIndex = value.indexOf('__', underscoreIndex + 2)
    if (closingIndex >= 0 && caret <= closingIndex + 2) {
      return null
    }
    const body = prefix.slice(underscoreIndex + 2)
    const prefixMatch = body.match(/^(tag|my):/i)
    const query = prefixMatch ? body.slice(prefixMatch[0].length) : body
    if (/[,\r\n|]/.test(query) || (!prefixMatch && /\s/.test(query))) {
      return null
    }
    return { start: underscoreIndex, end: caret, query, tab: prefixMatch ? (prefixMatch[1].toLowerCase() as 'tag' | 'my') : 'wildcard' }
  }

  if (atIndex < 0 || !isBoundary(atIndex)) {
    return null
  }
  const query = prefix.slice(atIndex + 1)
  if (/[\s,()@]/.test(query)) {
    return null
  }
  return { start: atIndex, end: caret, query, tab: 'all' }
}

/** Closest candidate by edit distance, for "did you mean" hints; null when nothing is reasonably close. */
export function findClosestName(name: string, candidates: string[]) {
  const target = name.toLowerCase()
  let best: { name: string; distance: number } | null = null
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase())
    if (!best || distance < best.distance) {
      best = { name: candidate, distance }
    }
  }
  return best && best.distance <= Math.max(2, Math.floor(target.length / 3)) ? best.name : null
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[right.length]
}
