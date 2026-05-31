export type ActivePromptTokenQuery = {
  start: number
  end: number
  query: string
}

const NORMAL_PROMPT_SEPARATOR_PATTERN = /[,\n\r]/
const TOKEN_START_BOUNDARY_PATTERN = /[\s,(]/

function isTokenStartBoundary(value: string, tokenStart: number) {
  if (tokenStart <= 0) {
    return true
  }
  return TOKEN_START_BOUNDARY_PATTERN.test(value[tokenStart - 1] ?? '')
}

function hasClosingTokenBeforeCaret(value: string, tokenStart: number, token: string, caretPosition: number) {
  const closingIndex = value.indexOf(token, tokenStart + token.length)
  return closingIndex >= 0 && caretPosition <= closingIndex + token.length
}

export function resolveActiveDanbooruGroupQuery(value: string, caretPosition: number): ActivePromptTokenQuery | null {
  const caret = Math.max(0, Math.min(caretPosition, value.length))
  const prefix = value.slice(0, caret)
  const tokenStart = prefix.lastIndexOf('__')

  if (tokenStart < 0 || !isTokenStartBoundary(value, tokenStart)) {
    return null
  }

  if (hasClosingTokenBeforeCaret(value, tokenStart, '__', caret)) {
    return null
  }

  const query = prefix.slice(tokenStart + 2)
  if (query.includes('__') || /[,\r\n]/.test(query)) {
    return null
  }

  const modifierIndex = query.search(/[\[<]/)
  if (modifierIndex >= 0) {
    return null
  }

  return {
    start: tokenStart,
    end: caret,
    query,
  }
}

export function resolveActivePromptTextQuery(value: string, caretPosition: number): ActivePromptTokenQuery | null {
  if (caretPosition < 0) {
    return null
  }

  const caret = Math.max(0, Math.min(caretPosition, value.length))
  let segmentStart = caret
  while (segmentStart > 0 && !NORMAL_PROMPT_SEPARATOR_PATTERN.test(value[segmentStart - 1] ?? '')) {
    segmentStart -= 1
  }

  let segmentEnd = caret
  while (segmentEnd < value.length && !NORMAL_PROMPT_SEPARATOR_PATTERN.test(value[segmentEnd] ?? '')) {
    segmentEnd += 1
  }

  while (segmentStart < segmentEnd && /\s/.test(value[segmentStart] ?? '')) {
    segmentStart += 1
  }
  while (segmentEnd > segmentStart && /\s/.test(value[segmentEnd - 1] ?? '')) {
    segmentEnd -= 1
  }

  if (segmentStart >= segmentEnd || caret <= segmentStart) {
    return null
  }

  if (segmentEnd > caret && NORMAL_PROMPT_SEPARATOR_PATTERN.test(value[segmentEnd] ?? '')) {
    return null
  }

  const segment = value.slice(segmentStart, segmentEnd)
  const query = value.slice(segmentStart, caret).trim()
  if (
    query.length === 0
    || segment.includes('++')
    || segment.includes('__')
    || /[()[\]{}<>]/.test(segment)
  ) {
    return null
  }

  return {
    start: segmentStart,
    end: segmentEnd,
    query,
  }
}
