/**
 * Random prompt token syntax shared by the prompt editor (chips, palette) and the backend resolver.
 *
 * - `__name__`                  wildcard; when no wildcard has that name the backend reads it as a Danbooru tag group
 * - `__name|2__`                wildcard: 2 different items (usage options do not apply to wildcards)
 * - `__tag:group|1-2|1k+__`     Danbooru tag group: pick 1-2 tags with at least 1000 uses (`100-` = at most 100)
 * - `__my:group|2__`            the user's own prompt group
 * Legacy forms still read: `++name++`, `__group [1~2] <1k>__` (`<-100>` = at most 100).
 */

export type PromptRandomTokenSource = 'wildcard' | 'tag' | 'my'
export type PromptRandomPick = { min: number; max: number }
export type PromptRandomUsage = { min?: number; max?: number }

export type PromptRandomTokenSpec = {
  source: PromptRandomTokenSource
  name: string
  pick: PromptRandomPick
  usage: PromptRandomUsage
}

export type ParsedPromptRandomTokenBody = PromptRandomTokenSpec & {
  /** No `tag:`/`my:` prefix. */
  unprefixed: boolean
  /** Uses legacy `[a~b]` / `<n>` modifiers. */
  legacy: boolean
  /** Any pick/usage option was written (pipe or legacy form). */
  hasOptions: boolean
}

export type PromptRandomToken = ParsedPromptRandomTokenBody & {
  key: string
  start: number
  end: number
  raw: string
}

export const PROMPT_RANDOM_MAX_PICK = 50
/**
 * `__body__` opening at the start, after whitespace, a comma or `(`; the body cannot start with `_`/whitespace or hold a
 * comma, so `a__b` style text and spans across prompt segments are left alone.
 */
export const PROMPT_RANDOM_TOKEN_PATTERN = /(?<![^\s,(])__([^_\s,\r\n][^,\r\n]*?)__/g
export const PROMPT_LEGACY_WILDCARD_PATTERN = /\+\+([^+\r\n]+?)\+\+/g

const DEFAULT_PICK: PromptRandomPick = { min: 1, max: 1 }

function parseCompactCount(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^([+-]?)(\d+(?:\.\d+)?)([km]?)$/)
  if (!match) {
    return null
  }
  const multiplier = match[3] === 'm' ? 1_000_000 : match[3] === 'k' ? 1_000 : 1
  const magnitude = Math.trunc(Number(match[2]) * multiplier)
  return match[1] === '-' ? -magnitude : magnitude
}

/** 1000 → `1k`, 1500 → `1.5k`, 2000000 → `2m`. */
export function formatPromptCompactCount(value: number) {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}m`
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}k`
  }
  return String(value)
}

function clampPick(first: number, second: number): PromptRandomPick {
  return {
    min: Math.min(PROMPT_RANDOM_MAX_PICK, Math.max(0, Math.min(first, second))),
    max: Math.min(PROMPT_RANDOM_MAX_PICK, Math.max(0, Math.max(first, second))),
  }
}

/** Parse the text between `__` and `__`; null when the options are malformed or the name is empty. */
export function parsePromptRandomTokenBody(rawBody: string): ParsedPromptRandomTokenBody | null {
  let body = rawBody.trim()
  const prefixMatch = body.match(/^(tag|my):\s*/i)
  const source: PromptRandomTokenSource = prefixMatch ? (prefixMatch[1].toLowerCase() as 'tag' | 'my') : 'wildcard'
  if (prefixMatch) {
    body = body.slice(prefixMatch[0].length)
  }

  let pick = DEFAULT_PICK
  const usage: PromptRandomUsage = {}
  let legacy = false
  let hasOptions = false

  if (body.includes('|')) {
    const [rawName, ...options] = body.split('|')
    body = rawName
    for (const rawOption of options) {
      const option = rawOption.trim().toLowerCase()
      if (!option) {
        continue
      }
      hasOptions = true
      const pickMatch = option.match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/)
      if (pickMatch) {
        pick = clampPick(Number(pickMatch[1]), Number(pickMatch[2] ?? pickMatch[1]))
        continue
      }
      const usageMatch = option.match(/^(\d+(?:\.\d+)?[km]?)([+-])$/)
      const parsedUsage = usageMatch ? parseCompactCount(usageMatch[1]) : null
      if (!usageMatch || parsedUsage === null) {
        return null
      }
      usage[usageMatch[2] === '+' ? 'min' : 'max'] = parsedUsage
    }
  } else {
    const usageMatch = body.match(/<\s*([+-]?\d+(?:\.\d+)?[kKmM]?)\s*>/)
    if (usageMatch) {
      const parsedUsage = parseCompactCount(usageMatch[1])
      if (parsedUsage === null) {
        return null
      }
      usage[parsedUsage < 0 ? 'max' : 'min'] = Math.abs(parsedUsage)
      body = body.replace(usageMatch[0], '')
      legacy = true
    }
    const pickMatch = body.match(/\[\s*(\d+)(?:\s*~\s*(\d+))?\s*\]/)
    if (pickMatch) {
      pick = clampPick(Number(pickMatch[1]), Number(pickMatch[2] ?? pickMatch[1]))
      body = body.replace(pickMatch[0], '')
      legacy = true
    }
    hasOptions = legacy
  }

  const name = body.trim()
  if (!name) {
    return null
  }

  return { source, name, pick, usage, unprefixed: !prefixMatch, legacy, hasOptions }
}

/** Every random token in a prompt value (new syntax and legacy `++name++`), in text order. */
export function findPromptRandomTokens(value: string): PromptRandomToken[] {
  const tokens: PromptRandomToken[] = []

  for (const match of value.matchAll(PROMPT_RANDOM_TOKEN_PATTERN)) {
    const parsed = parsePromptRandomTokenBody(match[1])
    const start = match.index ?? 0
    if (parsed) {
      tokens.push({ ...parsed, key: `${start}:${match[0]}`, start, end: start + match[0].length, raw: match[0] })
    }
  }

  for (const match of value.matchAll(PROMPT_LEGACY_WILDCARD_PATTERN)) {
    const name = match[1].trim()
    const start = match.index ?? 0
    const end = start + match[0].length
    if (name && !tokens.some((token) => start < token.end && end > token.start)) {
      tokens.push({ source: 'wildcard', name, pick: DEFAULT_PICK, usage: {}, unprefixed: true, legacy: true, hasOptions: false, key: `${start}:${match[0]}`, start, end, raw: match[0] })
    }
  }

  return tokens.sort((left, right) => left.start - right.start)
}

/** Canonical token text for one spec (wildcards carry only the pick count). */
export function serializePromptRandomToken(spec: PromptRandomTokenSpec) {
  const prefix = spec.source === 'wildcard' ? '' : `${spec.source}:`
  const options: string[] = []
  if (spec.pick.min !== 1 || spec.pick.max !== 1) {
    options.push(spec.pick.min === spec.pick.max ? String(spec.pick.min) : `${spec.pick.min}-${spec.pick.max}`)
  }
  if (spec.source !== 'wildcard') {
    if (spec.usage.min !== undefined) {
      options.push(`${formatPromptCompactCount(spec.usage.min)}+`)
    }
    if (spec.usage.max !== undefined) {
      options.push(`${formatPromptCompactCount(spec.usage.max)}-`)
    }
  }
  return `__${prefix}${spec.name}${options.map((option) => `|${option}`).join('')}__`
}

/** Replace `[start, end)` of a prompt with new text. */
export function replacePromptRange(value: string, start: number, end: number, insert: string) {
  return `${value.slice(0, start)}${insert}${value.slice(end)}`
}

/**
 * Rewrite legacy tokens to the new syntax with the same meaning: `++name++` → `__name__`; an unprefixed `__group__`
 * the backend would read as a tag group (not a wildcard, or written with legacy modifiers) → `__tag:group__`.
 */
export function convertLegacyPromptSyntax(value: string, isWildcardName: (name: string) => boolean) {
  let nextValue = value
  let count = 0

  for (const token of findPromptRandomTokens(value).reverse()) {
    const isLegacyPlus = token.raw.startsWith('++')
    const readsAsTagGroup = token.unprefixed && !isLegacyPlus && (token.legacy || !isWildcardName(token.name))
    if (!isLegacyPlus && !readsAsTagGroup && !token.legacy) {
      continue
    }
    nextValue = replacePromptRange(nextValue, token.start, token.end, serializePromptRandomToken({ ...token, source: readsAsTagGroup ? 'tag' : token.source }))
    count += 1
  }

  return { value: nextValue, count }
}
