import { stripEchoedAddresses } from '@conai/shared'

/**
 * How an API LLM reply's text is put together while it streams: the address label a model echoes at the start is
 * held back and dropped, rounds are joined by one blank line, and a round that restates the text of the round before
 * it (models often rewrite their pre-tool text after the tool result) takes its place instead of following it.
 */

/** Longest first line held back while it might still be an address label. */
const MAX_HELD_LABEL = 400

/** Whether `text` (no newline yet) may still turn out to be an address label: `[…` after optional spaces and `**`. */
function mayBeLabel(text: string) {
  return text.length <= MAX_HELD_LABEL && /^[ \t]*(?:\*{1,2})?(?:\[[^\n]*)?$/.test(text)
}

/** Where the bracket that `text` opens (after spaces and `**`) closes, or -1 while it is still open. */
function labelEnd(text: string) {
  let depth = 0
  for (let index = text.indexOf('['); index >= 0 && index < text.length; index += 1) {
    if (text[index] === '[') depth += 1
    else if (text[index] === ']' && (depth -= 1) === 0) return index
  }
  return -1
}

/**
 * Passes streamed text on to `onText` without an address label (`[message_id=…; to=…]`) the model echoed at its
 * start: the first line is held until it is complete, or until it clearly is not such a label, and then passed on
 * without the label (see stripEchoedAddresses, which cleans the stored reply the same way). `flush` releases what is
 * still held when the stream ends.
 */
export function addressLabelFilter(onText: (text: string) => void) {
  let held: string | null = ''
  const release = (text: string) => {
    held = null
    if (text) onText(text)
  }
  return {
    push(text: string) {
      if (held === null) {
        if (text) onText(text)
        return
      }
      held += text
      const newline = held.indexOf('\n')
      if (newline >= 0) {
        release(stripEchoedAddresses(held.slice(0, newline + 1)) + held.slice(newline + 1))
        return
      }
      if (!mayBeLabel(held)) {
        release(held)
        return
      }
      const end = labelEnd(held)
      if (end < 0) return
      // The bracket closed: a label once the reply text after it starts, plain text when it names no message_id.
      if (!/message_id=\d/.test(held.slice(0, end))) release(held)
      else if (held.slice(end + 1).replace(/^\*{0,2}[ \t]*:?[ \t]*/, '')) release(stripEchoedAddresses(held))
    },
    flush() {
      if (held) release(stripEchoedAddresses(held))
      held = null
    },
  }
}

/** What goes between the text so far and a new round's text: one blank line, counting the newlines already there. */
export function roundSeparator(text: string) {
  if (!text || text.endsWith('\n\n')) return ''
  return text.endsWith('\n') ? '\n' : '\n\n'
}

function comparable(text: string) {
  return text.normalize('NFC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
}

function bigrams(text: string) {
  const counts = new Map<string, number>()
  for (let index = 0; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Share of character pairs two texts have in common (Dice coefficient), 0–1. */
function similarity(a: string, b: string) {
  const left = bigrams(a)
  const right = bigrams(b)
  let shared = 0
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0)
  const total = Math.max(0, a.length - 1) + Math.max(0, b.length - 1)
  return total > 0 ? (2 * shared) / total : 0
}

/** Pairs in common above which a round's text counts as the previous round's text written again. */
const RESTATED_SIMILARITY = 0.7

/**
 * How `next` (a round's text) relates to `previous` (the text of the round before it): `replaces` when it writes the
 * same again — all of it and maybe more, or nearly the same words — so it takes the previous text's place;
 * `repeats` when it only repeats part of what is already there, so it adds nothing; otherwise null.
 */
export function restatement(previous: string, next: string): 'replaces' | 'repeats' | null {
  const a = comparable(previous)
  const b = comparable(next)
  if (!a || !b) return null
  if (b.includes(a)) return 'replaces'
  if (a.includes(b)) return b.length >= 8 ? 'repeats' : null
  if (Math.min(a.length, b.length) < 8 || Math.max(a.length, b.length) > 2 * Math.min(a.length, b.length)) return null
  return similarity(a, b) >= RESTATED_SIMILARITY ? 'replaces' : null
}
