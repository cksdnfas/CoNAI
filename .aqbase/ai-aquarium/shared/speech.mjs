/* Resident lines as profiles write them: code/status blocks, *narration* between asterisks, quoted speech. */
export const cleanSpeech = text => String(text ?? '').replace(/```[\s\S]*?(```|$)/g, '').replace(/\n{3,}/g, '\n\n').trim()
/** Legacy call signature retained for consumers; canonical model prose is never
 * shortened. Transport/context admission and page projections own resource limits. */
export const clipProse = value => typeof value === 'string' ? value.trim() : ''
export const NARRATION = /\*([^*\n]+)\*/g
const unquote = text => text.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()

/** The spoken part only, for bubbles and quotes; a line that is all narration keeps its narration. */
export function spokenText(text) {
  const clean = cleanSpeech(text)
  const spoken = unquote(clean.replace(NARRATION, ' ').replace(/\s+/g, ' ').trim())
  return spoken || unquote(clean.replace(/\*/g, '').replace(/\s+/g, ' ').trim())
}


// Older saves logged every tool run with its raw output; feeds only keep speech and short news.
export const OLD_TOOL_LINE = / · \S+ · (완료|실패|실행 중|생성 진행 중|생성 실패|검토 결과 확인)/
