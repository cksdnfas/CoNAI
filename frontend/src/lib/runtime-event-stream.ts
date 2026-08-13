import { buildApiUrl } from './api-client'
import {
  RUNTIME_STREAM_DEGRADE_FAILURE_COUNT,
  RUNTIME_STREAM_HIDDEN_RELEASE_MS,
  RUNTIME_STREAM_WATCHDOG_MS,
  isRuntimeEventStreamEnabled,
  resolveStreamReconnectDelayMs,
  type RuntimeStreamStatus,
} from '@/features/runtime-events/runtime-event-fallback'
import {
  RUNTIME_EVENT_TOPICS,
  type RuntimeEventEnvelope,
  type RuntimeEventHello,
  type RuntimeEventName,
} from './runtime-events-types'

/**
 * 탭당 단일 EventSource 래퍼.
 *
 * HTTP/1.1 오리진당 커넥션 상한이 6이므로 스트림은 **탭 전체에서 정확히 1개**여야 한다.
 * 이 파일이 앱 전체에서 유일하게 `new EventSource(...)` 를 호출하는 곳이며,
 * 그 사실을 `verify:runtime-event-stream-ui-contracts` 가 강제한다.
 */

const RUNTIME_EVENT_STREAM_PATH = '/api/events/stream'

const RUNTIME_EVENT_NAMES: readonly RuntimeEventName[] = [
  'queue.job.created',
  'queue.job.status',
  'queue.job.cancel-requested',
  'queue.job.progress',
  'history.record.created',
  'history.record.status',
  'job.status',
  'graph.schedule.changed',
  'graph.execution.status',
]

export interface RuntimeEventStreamHandlers {
  onEnvelope: (envelope: RuntimeEventEnvelope) => void
  onStatusChange: (status: RuntimeStreamStatus) => void
  /** 스트림 공백 구간 보정용. 재연결/reset 직후 관련 쿼리를 1회 무효화한다. */
  onResync: (reason: 'reconnected' | 'reset') => void
  onSessionExpired: () => void
}

const handlerSets = new Set<RuntimeEventStreamHandlers>()

let eventSource: EventSource | null = null
let streamStatus: RuntimeStreamStatus = 'connecting'
let consecutiveFailureCount = 0
let cursor = 0
let serverBootId: string | null = null
let hasCompletedFirstConnection = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let watchdogTimer: ReturnType<typeof setTimeout> | null = null
let hiddenReleaseTimer: ReturnType<typeof setTimeout> | null = null
let isVisibilityListenerBound = false

function isEventSourceSupported() {
  return typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
}

function setStatus(nextStatus: RuntimeStreamStatus) {
  if (streamStatus === nextStatus) {
    return
  }

  streamStatus = nextStatus
  handlerSets.forEach((handlers) => handlers.onStatusChange(nextStatus))
}

function notifyResync(reason: 'reconnected' | 'reset') {
  handlerSets.forEach((handlers) => handlers.onResync(reason))
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) {
    clearTimeout(timer)
  }

  return null
}

function armWatchdog() {
  watchdogTimer = clearTimer(watchdogTimer)
  watchdogTimer = setTimeout(() => {
    // 하트비트가 두 번 이상 끊겼다. 소켓은 살아 있는 듯 보여도 실제로는 죽은 연결이다.
    consecutiveFailureCount += 1
    setStatus('degraded')
    reconnectWithBackoff()
  }, RUNTIME_STREAM_WATCHDOG_MS)
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  watchdogTimer = clearTimer(watchdogTimer)
}

function reconnectWithBackoff() {
  closeEventSource()
  reconnectTimer = clearTimer(reconnectTimer)

  if (handlerSets.size === 0) {
    return
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    openEventSource()
  }, resolveStreamReconnectDelayMs(consecutiveFailureCount))
}

function handleHello(rawData: string) {
  consecutiveFailureCount = 0
  armWatchdog()

  try {
    const hello = JSON.parse(rawData) as RuntimeEventHello
    // 서버가 재시작했으면 프로세스 로컬 시퀀스도 초기화되었으므로 커서를 버린다.
    if (serverBootId !== null && serverBootId !== hello.server_boot_id) {
      cursor = 0
    }

    serverBootId = hello.server_boot_id
  } catch {
    // hello 파싱 실패는 치명적이지 않다. 커서만 유지한 채 계속 진행한다.
  }

  setStatus('live')

  if (hasCompletedFirstConnection) {
    notifyResync('reconnected')
  }

  hasCompletedFirstConnection = true
}

function handleEnvelope(rawData: string) {
  armWatchdog()

  let envelope: RuntimeEventEnvelope
  try {
    envelope = JSON.parse(rawData) as RuntimeEventEnvelope
  } catch {
    return
  }

  if (typeof envelope.id === 'number' && envelope.id > cursor) {
    cursor = envelope.id
  }

  handlerSets.forEach((handlers) => handlers.onEnvelope(envelope))
}

function openEventSource() {
  if (eventSource || handlerSets.size === 0) {
    return
  }

  if (!isEventSourceSupported() || !isRuntimeEventStreamEnabled(import.meta.env?.VITE_CONAI_RUNTIME_EVENTS)) {
    setStatus('unsupported')
    return
  }

  const query = new URLSearchParams({ topics: RUNTIME_EVENT_TOPICS.join(',') })
  if (cursor > 0) {
    query.set('cursor', String(cursor))
  }

  const source = new EventSource(buildApiUrl(`${RUNTIME_EVENT_STREAM_PATH}?${query.toString()}`), {
    withCredentials: true,
  })
  eventSource = source

  if (streamStatus !== 'degraded') {
    setStatus('connecting')
  }

  source.addEventListener('hello', (event) => handleHello((event as MessageEvent<string>).data))
  source.addEventListener('heartbeat', () => armWatchdog())
  source.addEventListener('reset', () => {
    armWatchdog()
    cursor = 0
    notifyResync('reset')
  })
  source.addEventListener('session-expired', () => {
    // 계정이 비활성화되었거나 권한이 회수됐다. 스트림을 접고 폴링 폴백으로 내려간다.
    consecutiveFailureCount = RUNTIME_STREAM_DEGRADE_FAILURE_COUNT
    setStatus('degraded')
    handlerSets.forEach((handlers) => handlers.onSessionExpired())
    reconnectWithBackoff()
  })

  RUNTIME_EVENT_NAMES.forEach((eventName) => {
    source.addEventListener(eventName, (event) => handleEnvelope((event as MessageEvent<string>).data))
  })

  source.onerror = () => {
    if (eventSource !== source) {
      return
    }

    consecutiveFailureCount += 1
    if (consecutiveFailureCount >= RUNTIME_STREAM_DEGRADE_FAILURE_COUNT) {
      setStatus('degraded')
    }

    reconnectWithBackoff()
  }

  armWatchdog()
}

function handleVisibilityChange() {
  if (typeof document === 'undefined') {
    return
  }

  if (document.visibilityState === 'hidden') {
    hiddenReleaseTimer = clearTimer(hiddenReleaseTimer)
    hiddenReleaseTimer = setTimeout(() => {
      hiddenReleaseTimer = null
      // 백그라운드 탭이 커넥션 슬롯을 붙잡고 있으면 일반 API/썸네일 요청이 굶는다.
      closeEventSource()
      reconnectTimer = clearTimer(reconnectTimer)
      setStatus('degraded')
    }, RUNTIME_STREAM_HIDDEN_RELEASE_MS)
    return
  }

  hiddenReleaseTimer = clearTimer(hiddenReleaseTimer)
  if (!eventSource && handlerSets.size > 0) {
    consecutiveFailureCount = 0
    openEventSource()
  }
}

function bindVisibilityListener() {
  if (isVisibilityListenerBound || typeof document === 'undefined') {
    return
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  isVisibilityListenerBound = true
}

function unbindVisibilityListener() {
  if (!isVisibilityListenerBound || typeof document === 'undefined') {
    return
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange)
  isVisibilityListenerBound = false
}

/** Read the current stream status without subscribing. */
export function getRuntimeEventStreamStatus(): RuntimeStreamStatus {
  if (!isEventSourceSupported() || !isRuntimeEventStreamEnabled(import.meta.env?.VITE_CONAI_RUNTIME_EVENTS)) {
    return 'unsupported'
  }

  return streamStatus
}

/**
 * Subscribe to the shared runtime event stream.
 * 참조 카운트로 관리하므로 StrictMode 이중 마운트에서도 연결은 1개만 열린다.
 */
export function createRuntimeEventStream(handlers: RuntimeEventStreamHandlers): () => void {
  if (!isEventSourceSupported() || !isRuntimeEventStreamEnabled(import.meta.env?.VITE_CONAI_RUNTIME_EVENTS)) {
    streamStatus = 'unsupported'
    handlers.onStatusChange('unsupported')
    return () => {}
  }

  handlerSets.add(handlers)
  bindVisibilityListener()
  handlers.onStatusChange(streamStatus)
  openEventSource()

  return () => {
    handlerSets.delete(handlers)
    if (handlerSets.size > 0) {
      return
    }

    closeEventSource()
    reconnectTimer = clearTimer(reconnectTimer)
    hiddenReleaseTimer = clearTimer(hiddenReleaseTimer)
    unbindVisibilityListener()
    streamStatus = 'connecting'
    hasCompletedFirstConnection = false
    consecutiveFailureCount = 0
  }
}
