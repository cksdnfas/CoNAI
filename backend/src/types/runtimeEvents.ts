/**
 * 런타임 이벤트 스트림(SSE) 계약은 `@conai/shared` 의 `types/runtimeEvents` 에 있다.
 * 여기에는 와이어로 나가지 않는 버스 내부 타입만 둔다.
 */
import type { RuntimeEventEnvelope } from '@conai/shared'

export { RUNTIME_EVENT_TOPICS, RUNTIME_EVENT_TOPIC_PERMISSIONS } from '@conai/shared'
export type {
  ChatGenerationFinishedEventPayload,
  ChatGenerationUpdatedEventPayload,
  ChatMessageCreatedEventPayload,
  ChatMessageUpdatedEventPayload,
  ChatReactionCreatedEventPayload,
  GraphExecutionEventPayload,
  GraphExecutionProgressEventPayload,
  GraphScheduleEventPayload,
  HistoryRecordEventPayload,
  QueueJobEventPayload,
  QueueJobEventStatus,
  QueueJobProgressEventPayload,
  RuntimeEventControlName,
  RuntimeEventEnvelope,
  RuntimeEventHeartbeat,
  RuntimeEventHello,
  RuntimeEventName,
  RuntimeEventReset,
  RuntimeEventSessionExpired,
  RuntimeEventTopic,
  RuntimeJobHintPayload,
} from '@conai/shared'

/** 'account' includes admins; 'owner' stays strictly within the owning account (including bootstrap null). */
export type RuntimeEventVisibility = 'all' | 'account' | 'owner'

/** 버스 내부 레코드. 라우팅 메타데이터는 와이어로 나가지 않는다. */
export interface RuntimeEventRecord<TPayload = unknown> extends RuntimeEventEnvelope<TPayload> {
  visibility: RuntimeEventVisibility
  accountId: number | null
}
