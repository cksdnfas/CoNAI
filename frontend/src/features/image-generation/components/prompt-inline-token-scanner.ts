export type ActivePromptTokenQuery = {
  start: number
  end: number
  query: string
}

const NORMAL_PROMPT_SEPARATOR_PATTERN = /[,\n\r]/

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
