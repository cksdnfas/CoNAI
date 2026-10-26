import { STATUS_CODES } from 'node:http'
import type { PluginLlmMeasurement } from '@conai/shared'
import { classifyRequestFailure } from '../codex-chat/connectionHealthState'
import { LlmRequestError } from '../llmRequestRetry'
import { LlmJsonTruncatedError } from '../llmProviderService'
import { TypesafeError } from '../judge/typesafeClient'
import { PluginError } from './pluginStore'

// Provider prose may echo arbitrary prompts/keys. Only recognized diagnostic phrases survive;
// redacting key-looking substrings alone cannot safely publish an arbitrary provider response.
function diagnostic(text: string) {
  const phrases = [
    'invalid request', 'unsupported parameter', 'invalid parameter', 'invalid model',
    'model not found', 'insufficient quota', 'rate limit exceeded', 'service unavailable',
    'internal server error', 'bad gateway', 'permission denied', 'connection refused',
    'authentication failed', 'unauthorized', 'invalid api key',
  ]
  return phrases.find(phrase => text.toLowerCase().includes(phrase)) ?? null
}

/** Bounded, credential/body-free plugin errors using the native connection failure taxonomy. */
export function pluginLlmFailure(error: unknown, options: { measurement?: PluginLlmMeasurement; deadline?: 'plugin' | 'judge'; timeoutMs?: number } = {}): PluginError {
  if (error instanceof PluginError) return error
  const text = error instanceof Error ? error.message.slice(0, 8000) : ''
  const name = error instanceof Error ? error.name : ''
  const nativeStatus = error instanceof LlmRequestError || error instanceof TypesafeError ? error.status : null
  // Native judgeTurn aggregates messages, losing the exception but retaining this host prefix.
  const status = nativeStatus ?? (Number(/(?:^| \/ )(?:LLM|판단 모델) 요청 실패 \((\d{3})\):/.exec(text)?.[1]) || undefined)
  const classified = classifyRequestFailure(status === undefined ? error : new LlmRequestError('', status))
  if (text.startsWith('Research source access changed:')) return new PluginError('조사 자료 접근 권한이 바뀌었어. 지정 자료의 공개 상태와 권한을 확인해줘.', 403)
  if (error instanceof LlmJsonTruncatedError) return new PluginError('출력 토큰 한도에서 답변이 잘렸어. JSON을 완성하지 못했어. 출력 한도를 늘리거나 요청 범위를 줄여줘.', 422)
  if (/context.{0,60}(?:exceed|length|window|limit|size)|maximum context|too many tokens|max_tokens_exceeded|컨텍스트.*(?:초과|한도)|문맥.*한도/i.test(text)) {
    const budget = options.measurement
    const numbers = budget?.contextTokens !== null && budget?.contextTokens !== undefined
      ? ` (입력 약 ${budget.inputTokens}, 출력 예약 ${budget.outputReserve}, 설정 한도 ${budget.contextTokens} 토큰)` : ''
    return new PluginError(`문맥이 모델 한도를 넘었어${numbers}. 입력을 줄여줘.`, 413)
  }
  if (name === 'TimeoutError' || /timed? ?out|timeout|제한 시간을 (?:넘|초과)|시간 초과|LLM 응답이 너무 오래 멈춰/i.test(text)) {
    const deadline = options.deadline === 'plugin' ? '플러그인 답변' : options.deadline === 'judge' ? '플러그인 판단'
      : /Claude Code/.test(text) ? 'Claude CLI' : /Codex/i.test(text) ? 'Codex CLI' : /응답.*(?:없|멈춰)|idle/i.test(text) ? '모델 응답 유휴' : '모델 연결/요청'
    return new PluginError(`요청 제한 시간을 넘었어 (${deadline}${options.timeoutMs === undefined ? '' : ` ${options.timeoutMs}ms`}).`, 408)
  }
  if (name === 'AbortError' || text === '__CODEX_MESSAGE_CANCELLED__') return new PluginError('요청이 취소됐어.', 499)
  if (classified === 'auth') return new PluginError(`모델 인증·권한이 거부됐어 (HTTP ${status}). 연결의 인증과 권한을 확인해줘.`, status)
  if (classified === 'quota') return new PluginError(`모델 요청 한도에 걸렸어 (HTTP ${status}). 제공자의 사용량·요청 한도를 확인해줘.`, status)
  if (classified === 'model_missing' || /모델이 (?:정해지지|없어)|모델을 찾을 수 없어|LLM 연결(?:을 찾을 수 없어|이 꺼져|에 주소가 없어)/.test(text)) {
    return new PluginError(`모델·연결을 사용할 수 없어${status ? ` (HTTP ${status})` : ''}. 모델 이름과 연결 활성화를 확인해줘.`, status ?? 503)
  }
  if (status !== undefined && status >= 400 && status <= 599) {
    return new PluginError(`모델 제공자 요청이 실패했어 (HTTP ${status}): ${diagnostic(text) ?? STATUS_CODES[status] ?? 'provider error'}.`, status)
  }
  if (classified === 'not_installed' || /codex exec|Claude Code.*(?:실패|CLI)|Failed to (?:launch codex|send codex)/i.test(text)) {
    const engine = /claude/i.test(text) ? 'Claude' : /codex/i.test(text) ? 'Codex' : 'CLI'
    const exit = /exit code (-?\d+)/i.exec(text)?.[1]
    const stderr = /^stderr:\s*(.*)$/m.exec(text)?.[1]
    return new PluginError(`모델 실행기가 실패했어 (${engine}${exit ? ` exit ${exit}` : ''})${stderr && diagnostic(stderr) ? `: ${diagnostic(stderr)}` : ''}. 설치·로그인 상태를 확인해줘.`, 502)
  }
  if (classified === 'unreachable' || /LLM 서버에 연결/.test(text)) return new PluginError('모델 서버에 연결하지 못했어. 연결 주소와 서버 실행 상태를 확인해줘.', 503)
  if (text.includes('판단 모델이 일부 질문에 답하지 않았어.')) return new PluginError('판단 답변이 불완전해. 일부 질문에 답하지 않았어.', 502)
  return new PluginError('모델 응답을 처리하지 못했어. 제공자 응답 형식과 서버 로그를 확인해줘.', 502)
}
