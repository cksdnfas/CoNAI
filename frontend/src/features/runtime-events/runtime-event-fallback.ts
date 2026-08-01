/**
 * 스트림 상태 → 폴링 폴백 정책.
 *
 * 기존 `refetchInterval` 콜백 로직은 **한 줄도 지우지 않고** 이 함수로 감싼다.
 * 스트림이 죽거나 꺼져 있으면 원래 간격이 그대로 반환되므로, SSE 를 완전히 끄면
 * 현행 폴링 동작으로 100% 복귀한다.
 */

export type RuntimeStreamStatus = 'connecting' | 'live' | 'degraded' | 'unsupported'

/** 하트비트(20초) 대비 워치독. 2회 이상 놓치면 degraded 로 내린다. */
export const RUNTIME_STREAM_WATCHDOG_MS = 45_000
/** 연속 재연결 실패가 이 횟수를 넘으면 degraded 로 내린다. */
export const RUNTIME_STREAM_DEGRADE_FAILURE_COUNT = 3
export const RUNTIME_STREAM_RECONNECT_BASE_MS = 1_000
export const RUNTIME_STREAM_RECONNECT_MAX_MS = 30_000
/** 탭이 이 시간 이상 숨겨져 있으면 연결을 반납한다(오리진당 6 커넥션 상한 완화). */
export const RUNTIME_STREAM_HIDDEN_RELEASE_MS = 60_000

/** 스트림이 살아 있으면 폴링을 끄고, 아니면 기존 interval 을 그대로 돌려준다. */
export function resolveStreamFallbackInterval(
  status: RuntimeStreamStatus,
  legacyInterval: number | false,
): number | false {
  return status === 'live' ? false : legacyInterval
}

/** 지수 백오프(1s→2s→4s→…→30s cap). */
export function resolveStreamReconnectDelayMs(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1)
  return Math.min(RUNTIME_STREAM_RECONNECT_BASE_MS * 2 ** exponent, RUNTIME_STREAM_RECONNECT_MAX_MS)
}

/** 킬 스위치: `VITE_CONAI_RUNTIME_EVENTS=off` 이면 스트림을 아예 열지 않는다. */
export function isRuntimeEventStreamEnabled(rawSetting: string | undefined): boolean {
  const normalized = rawSetting?.trim().toLowerCase()
  return normalized !== 'off' && normalized !== 'false' && normalized !== '0'
}
