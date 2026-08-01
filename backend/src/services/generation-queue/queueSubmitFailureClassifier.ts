/**
 * 업스트림 제출 실패를 "상류에 작업이 생겼을 가능성" 기준으로 분류한다.
 *
 * - `not_sent`  : 서버가 요청을 못 봤음이 확실 (보상 취소 불필요)
 * - `rejected`  : 서버가 명시적으로 거절 (보상 취소 불필요)
 * - `ambiguous` : 나머지 전부. 이미 접수됐을 수 있으므로 **보상 취소를 돌린다**
 *
 * AbortController 로 끊은 요청(`ERR_CANCELED`)도 ambiguous 다.
 * abort 는 로컬 소켓만 끊을 뿐 상류 접수를 되돌리지 못한다는 점이 이 설계의 핵심이다.
 */
export type SubmitFailureClass = 'not_sent' | 'rejected' | 'ambiguous'

const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

const NOT_SENT_MESSAGE_PATTERN = /\b(ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID)\b/
const REJECTED_MESSAGE_PATTERN = /ComfyUI node errors:/

type ErrorLike = {
  code?: unknown
  message?: unknown
  cause?: unknown
  response?: { status?: unknown } | null
}

function asErrorLike(error: unknown): ErrorLike | null {
  return error && typeof error === 'object' ? error as ErrorLike : null
}

function resolveErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error
  }

  const errorLike = asErrorLike(error)
  return typeof errorLike?.message === 'string' ? errorLike.message : ''
}

/** Classify one upstream submit failure, following wrapped `cause` chains. */
export function classifySubmitFailure(error: unknown, depth = 0): SubmitFailureClass {
  const errorLike = asErrorLike(error)
  const message = resolveErrorMessage(error)

  if (REJECTED_MESSAGE_PATTERN.test(message)) {
    return 'rejected'
  }

  const status = errorLike?.response && typeof errorLike.response === 'object'
    ? (errorLike.response as { status?: unknown }).status
    : undefined
  if (typeof status === 'number' && status >= 400 && status <= 499) {
    return 'rejected'
  }

  const code = typeof errorLike?.code === 'string' ? errorLike.code : null
  if (code && NOT_SENT_CODES.has(code)) {
    return 'not_sent'
  }

  if (!code && NOT_SENT_MESSAGE_PATTERN.test(message)) {
    return 'not_sent'
  }

  // axios 래핑으로 code/response 가 지워졌을 수 있어 원인 체인을 한 번 더 본다.
  if (errorLike?.cause !== undefined && errorLike.cause !== null && depth < 4) {
    const causeClass = classifySubmitFailure(errorLike.cause, depth + 1)
    if (causeClass !== 'ambiguous') {
      return causeClass
    }
  }

  if (depth === 0 && NOT_SENT_MESSAGE_PATTERN.test(message)) {
    return 'not_sent'
  }

  return 'ambiguous'
}

/** True when a failure may have left work running upstream. */
export function requiresCompensatingCancel(failureClass: SubmitFailureClass) {
  return failureClass === 'ambiguous'
}
