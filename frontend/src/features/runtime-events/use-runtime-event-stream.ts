import { useContext } from 'react'
import { RuntimeEventStreamContext, type RuntimeEventStreamContextValue } from './runtime-event-stream-provider'
import { resolveStreamFallbackInterval } from './runtime-event-fallback'

/** Read the shared runtime event stream state. */
export function useRuntimeEventStream(): RuntimeEventStreamContextValue {
  return useContext(RuntimeEventStreamContext)
}

/**
 * Wrap one legacy polling interval with the stream fallback policy.
 *
 * 기존 interval 계산 로직은 그대로 두고 결과만 감싼다. 스트림이 살아 있으면 `false`,
 * 아니면 원래 값이 그대로 나가므로 SSE 를 꺼도 현행 폴링 동작으로 완전히 복귀한다.
 */
export function useStreamFallbackInterval(legacyInterval: number | false): number | false {
  const { status } = useRuntimeEventStream()
  return resolveStreamFallbackInterval(status, legacyInterval)
}
