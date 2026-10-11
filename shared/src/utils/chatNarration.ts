/**
 * Narration lines in a user's chat message: a line that starts with `$` is scene narration written by the user as the
 * narrator ("$그때 문이 벌컥 열렸다"), and it ends at the line break. A line that starts with `$$` is a literal `$`.
 */

export type ChatNarrationPart = { narration: boolean; text: string }

export const NARRATION_TAG = '[나레이션]'

export function isNarrationLine(line: string) {
  return line.startsWith('$') && !line.startsWith('$$')
}

export function hasNarration(text: string) {
  return text.split('\n').some((line) => isNarrationLine(line) && line.slice(1).trim() !== '')
}

/** The message in order: each narration line on its own, the lines between them joined. Empty parts are left out. */
export function splitNarration(text: string): ChatNarrationPart[] {
  const parts: ChatNarrationPart[] = []
  let speech: string[] = []
  const flush = () => {
    const joined = speech.join('\n').replace(/^\n+|\n+$/g, '')
    if (joined.trim()) parts.push({ narration: false, text: joined })
    speech = []
  }
  for (const line of text.split('\n')) {
    if (isNarrationLine(line)) {
      flush()
      const body = line.slice(1).trim()
      if (body) parts.push({ narration: true, text: body })
    } else {
      speech.push(line.startsWith('$$') ? line.slice(1) : line)
    }
  }
  flush()
  return parts
}

/** What the model reads: narration lines tagged, `$$` unescaped. Text without narration comes back unchanged. */
export function narrationForModel(text: string) {
  if (!text.split('\n').some((line) => line.startsWith('$'))) return text
  return text.split('\n').map((line) => {
    if (!isNarrationLine(line)) return line.startsWith('$$') ? line.slice(1) : line
    const body = line.slice(1).trim()
    return body ? `${NARRATION_TAG} ${body}` : ''
  }).join('\n')
}

/** The text as plain words, without the `$` marks (a chat title made from the first message). */
export function withoutNarrationMarks(text: string) {
  return splitNarration(text).map((part) => part.text).join('\n')
}

/** How many narration lines a text holds (a translation must keep them). */
export function narrationLineCount(text: string) {
  return text.split('\n').filter((line) => isNarrationLine(line) && line.slice(1).trim() !== '').length
}
