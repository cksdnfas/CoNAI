/**
 * Loose text search for pickers, tuned for Korean: case, spaces, `_`, `-` and `·` are ignored; a lone consonant
 * matches any syllable it starts (초성 search: "ㄹㅇ" finds "로어"); and the syllable still being typed matches the
 * syllables it can still become ("저" while typing "저장", "엊" while typing "어저").
 */

const SYLLABLE_FIRST = 0xac00
const SYLLABLE_LAST = 0xd7a3
/** Compatibility jamo (what a keyboard types) of the 19 initial consonants, in syllable order. */
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
/** Compatibility jamo of the 27 final consonants (index 1..27; 0 is none); a cluster never starts the next syllable. */
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

function syllableParts(char: string) {
  const code = char.charCodeAt(0) - SYLLABLE_FIRST
  if (char.length !== 1 || code < 0 || code > SYLLABLE_LAST - SYLLABLE_FIRST) return null
  return { initial: Math.floor(code / 588), medial: Math.floor((code % 588) / 28), final: code % 28 }
}

/** Lower-cased, NFC, without the separators people type or skip at will. */
export function normalizeSearchText(text: string) {
  return text.normalize('NFC').toLowerCase().replace(/[\s_\-·]+/g, '')
}

/** Whether a typed char stands for a text char; `last` lets an unfinished syllable match what it can become. */
function charMatches(typed: string, text: string, last: boolean, initials: boolean) {
  if (typed === text) return true
  const initial = INITIALS.indexOf(typed)
  if (initial >= 0) return initials && syllableParts(text)?.initial === initial
  if (!last) return false
  const want = syllableParts(typed)
  const have = syllableParts(text)
  return Boolean(want && have && want.final === 0 && want.initial === have.initial && want.medial === have.medial)
}

/** Whether `query` (already normalized) occurs in `text` (already normalized) at `at`. */
function matchesAt(text: string, query: string, at: number, initials: boolean) {
  for (let index = 0; index < query.length; index += 1) {
    const last = index === query.length - 1
    // In prose a lone consonant only counts as the start of the syllable being typed after a whole one ("이미ㅈ").
    if (!charMatches(query[index], text[at + index], last, initials || (last && index > 0))) return false
  }
  return true
}

function matchesNormalized(text: string, query: string, initials: boolean): boolean {
  for (let at = 0; at + query.length <= text.length; at += 1) {
    if (matchesAt(text, query, at, initials)) return true
  }
  // The last syllable typed so far may hold the next syllable's initial as its final ("로엊" on the way to "로어저").
  const tail = syllableParts(query[query.length - 1] ?? '')
  const carried = tail && tail.final > 0 ? INITIALS.indexOf(FINALS[tail.final]) : -1
  if (carried < 0 || !tail) return false
  const open = String.fromCharCode(SYLLABLE_FIRST + tail.initial * 588 + tail.medial * 28)
  return matchesNormalized(text, query.slice(0, -1) + open + INITIALS[carried], initials)
}

/**
 * Whether any of `texts` holds `query`; an empty query matches everything. Pass `initials: false` for long prose
 * (descriptions), where lone consonants would match almost anything.
 */
export function matchesSearch(texts: string | readonly string[], query: string, { initials = true }: { initials?: boolean } = {}) {
  const needle = normalizeSearchText(query)
  if (!needle) return true
  return (typeof texts === 'string' ? [texts] : texts).some((text) => matchesNormalized(normalizeSearchText(text), needle, initials))
}
