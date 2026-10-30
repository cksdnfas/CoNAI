import { cleanSpeech, NARRATION } from '../../shared/speech.mjs'

/** The whole line for chat logs: narration as muted italics, speech as plain text. */
export function speechNodes(text) {
  const clean = cleanSpeech(text), out = []
  let at = 0
  for (const m of clean.matchAll(NARRATION)) {
    if (m.index > at) out.push(document.createTextNode(clean.slice(at, m.index)))
    out.push(Object.assign(document.createElement('em'), { className: 'speech-narration', textContent: m[1].trim() }))
    at = m.index + m[0].length
  }
  if (at < clean.length) out.push(document.createTextNode(clean.slice(at)))
  return out
}
