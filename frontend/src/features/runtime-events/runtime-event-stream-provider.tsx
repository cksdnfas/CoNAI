import { createContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { createRuntimeEventStream, getRuntimeEventStreamStatus } from '@/lib/runtime-event-stream'
import { RUNTIME_EVENT_STREAM_PERMISSION_KEY } from '@/lib/runtime-events-types'
import type { RuntimeStreamStatus } from './runtime-event-fallback'
import { useRuntimeEventQueryBridge } from './use-runtime-event-query-bridge'

export type RuntimeEventStreamContextValue = {
  status: RuntimeStreamStatus
  /** 스트림이 살아 있는 동안에는 폴링을 끈다. */
  isLive: boolean
  /** 폴백 폴링이 필요한 상태(연결 중/열화/미지원). */
  isDegraded: boolean
  lastEventAt: number | null
}

export const RuntimeEventStreamContext = createContext<RuntimeEventStreamContextValue>({
  status: 'unsupported',
  isLive: false,
  isDegraded: true,
  lastEventAt: null,
})

/**
 * 탭당 단일 런타임 이벤트 스트림 provider.
 *
 * 브리지가 `useQueryClient` 를 쓰므로 `QueryClientProvider` **안쪽**에 마운트되어야 한다.
 */
export function RuntimeEventStreamProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<RuntimeStreamStatus>(() => getRuntimeEventStreamStatus())
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const bridge = useRuntimeEventQueryBridge()
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge
  const authStatusQuery = useAuthStatusQuery()
  // 권한이 없으면 서버가 403 을 주므로 연결을 시도하지 않는다. 익명 열람 페이지에서
  // 30초 간격 재접속 루프가 도는 것을 막고, 해당 표면은 기존 폴링 폴백으로 남는다.
  const hasStreamPermission = (authStatusQuery.data?.permissionKeys ?? []).includes(RUNTIME_EVENT_STREAM_PERMISSION_KEY)

  useEffect(() => {
    if (!hasStreamPermission) {
      setStatus('unsupported')
      return
    }

    // 핸들러는 ref 를 통해 최신 브리지를 읽으므로 구독은 마운트당 한 번만 만들어진다.
    return createRuntimeEventStream({
      onEnvelope: (envelope) => {
        setLastEventAt(Date.now())
        bridgeRef.current.applyEnvelope(envelope)
      },
      onStatusChange: setStatus,
      onResync: () => {
        bridgeRef.current.resyncAll()
      },
      onSessionExpired: () => {
        bridgeRef.current.invalidateAuthStatus()
      },
    })
  }, [hasStreamPermission])

  const value = useMemo<RuntimeEventStreamContextValue>(() => ({
    status,
    isLive: status === 'live',
    isDegraded: status !== 'live',
    lastEventAt,
  }), [lastEventAt, status])

  return (
    <RuntimeEventStreamContext.Provider value={value}>
      {children}
    </RuntimeEventStreamContext.Provider>
  )
}
