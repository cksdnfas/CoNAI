import { EventEmitter } from 'node:events'
import type {
  RuntimeEventName,
  RuntimeEventRecord,
  RuntimeEventTopic,
  RuntimeEventVisibility,
} from '../../types/runtimeEvents'

/**
 * 프로세스 내부 런타임 이벤트 버스.
 *
 * 발행자(큐/히스토리/그래프 서비스)와 구독자(SSE 브로드캐스터)를 잇는 유일한 경로다.
 * DB 테이블도, 폴링 루프도 쓰지 않는다 — 폴링을 없애는 것이 이 채널의 목적이기 때문이다.
 *
 * **split 런타임 제약:** `CONAI_ALLOW_SPLIT_RUNTIME=true` 로 명시 옵트인한 api/worker 분리
 * 구성에서는 worker 프로세스가 발행한 이벤트가 api 프로세스의 SSE 구독자에게 **도달하지 않는다**
 * (프로세스 간 IPC 채널이 없다). 그 구성에서 클라이언트는 하트비트만 받다가 기존 폴링 폴백으로
 * 동작한다. 기본값이자 모든 배포 구성인 단일 프로세스 `all` 역할에서는 지연 ≈ 0ms 다.
 */

const RUNTIME_EVENT_CHANNEL = 'runtime-event'

const emitter = new EventEmitter()
// 구독자는 브로드캐스터 1개가 정상이지만, 계약 스크립트/스모크가 함께 붙을 수 있다.
emitter.setMaxListeners(32)

let sequence = 0

export type RuntimeEventListener = (record: RuntimeEventRecord) => void

export interface PublishRuntimeEventInput {
  name: RuntimeEventName
  topic: RuntimeEventTopic
  visibility?: RuntimeEventVisibility
  accountId?: number | null
  payload: unknown
}

/** Read the latest published sequence id without publishing. */
export function getRuntimeEventCursor(): number {
  return sequence
}

/**
 * Publish one runtime event to every in-process subscriber.
 *
 * 절대 throw 하지 않는다. 이벤트 발행 실패가 큐 전이나 실행 상태 쓰기를 깨뜨려서는 안 된다.
 */
export function publishRuntimeEvent(input: PublishRuntimeEventInput): number {
  try {
    sequence += 1
    const record: RuntimeEventRecord = {
      id: sequence,
      name: input.name,
      topic: input.topic,
      at: new Date().toISOString(),
      payload: input.payload,
      visibility: input.visibility ?? 'all',
      accountId: input.accountId ?? null,
    }

    emitter.emit(RUNTIME_EVENT_CHANNEL, record)
    return record.id
  } catch (error) {
    console.warn('⚠️ Failed to publish runtime event:', error instanceof Error ? error.message : error)
    return sequence
  }
}

/** Subscribe to in-process runtime events. Returns the unsubscribe handle. */
export function subscribeToRuntimeEvents(listener: RuntimeEventListener): () => void {
  emitter.on(RUNTIME_EVENT_CHANNEL, listener)
  return () => {
    emitter.off(RUNTIME_EVENT_CHANNEL, listener)
  }
}

/** Reset bus state for contract smoke runs. Production code never calls this. */
export function resetRuntimeEventBusForTests(): void {
  emitter.removeAllListeners(RUNTIME_EVENT_CHANNEL)
  sequence = 0
}
