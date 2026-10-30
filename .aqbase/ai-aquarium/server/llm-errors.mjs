// Host-sanitized category prefixes, not HTTP 429 or arbitrary provider "busy"
// prose. Keep the original reason and context-overflow prefix intact.
export const PAYLOAD_LOST = '저장된 AI 요청 원문이 없거나 손상됐어. 이 요청은 종료했어. 새 요청으로 다시 만들어줘.'
export const payloadLost = error => String(error?.message ?? error ?? '').startsWith('저장된 AI 요청 원문이 없거나 손상됐어')
const CATEGORIES = [
  ['payload_lost', '요청 원문 복구 필요', /^저장된 AI 요청 원문이 없거나 손상됐어/],
  ['queue_full', '접수 대기열', /^플러그인 답변 대기열이 가득 찼어/],
  ['admission_busy', '실행 접수 대기', /^플러그인 (?:답변|판단) 4개가 실행 중이야/],
  ['context', '모델 문맥', /^문맥이 모델 한도를 넘었어/],
  ['transport', '호스트 본문 전송 한도', /^요청 본문이 호스트 전송 한도/],
  ['json_truncated', 'JSON 출력 중단', /^출력 토큰 한도에서 답변이 잘렸어/],
  ['timeout', '요청 시간 초과', /^요청 제한 시간을 넘었어/],
  ['cancelled', '요청 취소', /^요청이 취소됐어/],
  ['auth', '모델 인증·권한', /^모델 인증·권한이 거부됐어/],
  ['quota', '제공자 사용량·요청 한도', /^모델 요청 한도에 걸렸어/],
  ['model_unavailable', '모델·연결 설정', /^모델·연결을 사용할 수 없어/],
  ['provider', '모델 제공자', /^모델 제공자 요청이 실패했어/],
  ['runtime', '모델 실행기', /^모델 실행기가 실패했어/],
  ['unreachable', '모델 서버 연결', /^모델 서버에 연결하지 못했어/],
  ['incomplete', '불완전한 판단', /^판단 답변이 불완전해/],
  ['source_access', '조사 자료 권한', /^조사 자료 접근 권한이 바뀌었어/],
  ['response', '모델 응답 형식', /^모델 응답을 처리하지 못했어/],
]
export function llmFailure(error) {
  const message = String(error?.message ?? error ?? '모델 요청 오류')
  const match = CATEGORIES.find(([, , pattern]) => pattern.test(message))
  return { category: match?.[0] ?? 'unknown', label: match?.[1] ?? '', message }
}
export const hostStatus = error => Number.isInteger(error?.status) ? error.status : null
export const requestReplaced = error => hostStatus(error) === 409
export const ADMISSION_RETRY_MS = 1000
export const admissionBusy = error => hostStatus(error) === 429
export const contentFailure = error => ['context', 'transport', 'json_truncated', 'response', 'format'].includes(error?.category ?? llmFailure(error).category)
export const backoffMs = failures => Math.min(30 * 60_000, 5000 * 2 ** Math.min(9, Math.max(0, failures - 1)))
/** Only start/measure callers use this: a recognized synchronous host rejection
 * did not admit a model job. Unknown transport loss may have admitted one. */
export const admissionRejected = error => error?.noModelCall === true || payloadLost(error) ||
  [400, 403, 404, 409, 413, 429].includes(hostStatus(error))
export function llmErrorText(error) {
  const { message, label } = llmFailure(error)
  return label && !message.includes(` [${label}]`) ? `${message} [${label}]` : message
}
