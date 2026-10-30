// Latin names read as Korean loanwords: only a final l/m/n (Ran, Bill, Tom) leaves a 받침; Aqua, Mouri, Peter do not.
// Digits go by their Korean reading (일, 삼, 육, 칠, 팔, 영).
const hasBatchim = word => {
  const last = word.trim().replace(/[^\p{L}\p{N}]+$/u, '').slice(-1)
  const c = last.charCodeAt(0) - 0xac00
  if (c >= 0 && c <= 11171) return c % 28 !== 0
  if (/[a-z]/i.test(last)) return /[lmn]/i.test(last)
  if (/[0-9]/.test(last)) return '013678'.includes(last)
  return null
}
export const josa = (word, withBatchim, without) => { const b = hasBatchim(word); return word + (b === null ? `${withBatchim}(${without})` : b ? withBatchim : without) }
/** Keep canonical speech for storage/memory. Page speech helpers handle display. */
export const cleanSpeech = text => String(text ?? '').trim()
/** Profile appearance tags of the people a picture may show, so the profile's own image tools draw them as they look. */
export function looksLine(profiles, residents) {
  const looks = residents.filter(Boolean).map(r => [r.name, profiles.find(p => p.id === r.profileId)?.appearance?.trim()]).filter(([, look]) => look)
  return looks.length ? `등장인물 외형 태그(그림에 인물을 넣을 때 그대로 써): ${looks.map(([name, look]) => `${name}: ${look}`).join(' / ')}` : ''
}
export const dayOf = now =>{ const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }

/** Native profile replies (including follow-ups) are speech, never aquarium JSON commands. */
export function readTurn(result) {
  return { say: cleanSpeech(result?.text) }
}
