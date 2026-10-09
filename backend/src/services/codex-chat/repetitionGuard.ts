/**
 * A model stuck in a loop (`wuwxwuwxwuwx…`, one line over and over) keeps writing the same unit until the output cap.
 * The stream stops as soon as its tail turns into such a run, and the run is cut off, so the loop never reaches the
 * reader, the translation, or the next request's history.
 */

/** Only the latest stretch is searched: a run is caught long before it outgrows it. */
const WINDOW = 4096
/** Longest repeating unit looked for (a short line). */
const MAX_PERIOD = 200
/** A run counts once it is this long and repeats its unit this often; shorter ones (ㅋㅋㅋ, ……) are left alone. */
const MIN_RUN = 300
const MIN_REPEATS = 5
/** Text checked again only after this many new characters. */
const CHECK_EVERY = 64
/** Loose debris of a tiny unit's letters right before the run (`wxwuxwux` before `wuwxwuwx…`) goes with it. */
const DEBRIS_MAX = 64
const DEBRIS_UNIT_LETTERS = 4

/** Where the looping tail of `text` starts, or null when it does not end in one. */
export function repetitionCut(text: string): number | null {
  const end = text.length
  const floor = Math.max(0, end - WINDOW)
  let best: { start: number; period: number } | null = null
  for (let period = 1; period <= MAX_PERIOD && end - floor >= Math.max(MIN_RUN, period * MIN_REPEATS); period += 1) {
    let index = end - 1 - period
    while (index >= floor && text[index] === text[index + period]) index -= 1
    const start = index + 1
    const length = end - start
    if (length >= Math.max(MIN_RUN, period * MIN_REPEATS) && (!best || start < best.start)) best = { start, period }
  }
  if (!best) return null
  let cut = best.start
  const letters = new Set(text.slice(best.start, best.start + best.period))
  if (letters.size <= DEBRIS_UNIT_LETTERS && ![...letters].some((letter) => /\s/.test(letter))) {
    const limit = Math.max(0, cut - DEBRIS_MAX)
    while (cut > limit && letters.has(text[cut - 1])) cut -= 1
  }
  // Never split a surrogate pair.
  if (cut > 0 && cut < end && /[\uDC00-\uDFFF]/.test(text[cut]) && /[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1
  return cut
}

/** `text` without its looping tail (and the whitespace before it). */
export function withoutRepetition(text: string) {
  const cut = repetitionCut(text)
  return cut === null ? text : text.slice(0, cut).trimEnd()
}

/** Watches a growing text; `looping` is true once its tail has turned into a run. */
export function createRepetitionWatch() {
  let checkedAt = 0
  return {
    looping(text: string) {
      if (text.length - checkedAt < CHECK_EVERY) return false
      checkedAt = text.length
      return repetitionCut(text) !== null
    },
  }
}
