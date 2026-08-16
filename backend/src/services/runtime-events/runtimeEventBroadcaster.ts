import crypto from 'crypto'
import type { Response } from 'express'
import { getRuntimeEventCursor, subscribeToRuntimeEvents } from './runtimeEventBus'
import { resolveRuntimeSideEffectRole } from '../../startup/runtimeRole'
import {
  RUNTIME_EVENT_TOPICS,
  type RuntimeEventEnvelope,
  type RuntimeEventRecord,
  type RuntimeEventTopic,
} from '../../types/runtimeEvents'

/** 하트비트 주기. 클라이언트 워치독은 이 값의 2배 이상을 쓴다. */
export const RUNTIME_EVENT_HEARTBEAT_INTERVAL_MS = 20_000
/** 하트비트마다 확인하는 접근 재검증 최소 간격. */
const RUNTIME_EVENT_ACCESS_REVALIDATE_MS = 30_000
/** 재연결(Last-Event-ID) 재생 버퍼 상한. */
const RUNTIME_EVENT_REPLAY_BUFFER_LIMIT = 500
const RUNTIME_EVENT_REPLAY_BUFFER_MAX_AGE_MS = 10 * 60 * 1000

export type RuntimeEventAccessRevalidation =
  | { ok: true }
  | { ok: false; reason: 'unauthenticated' | 'permission-revoked' }

export interface RuntimeEventSubscriberInput {
  res: Response
  accountId: number | null
  isAdmin: boolean
  topics: RuntimeEventTopic[]
  resumeCursor: number | null
  /** 라우트가 주입하는 read-only 접근 재검증. 브로드캐스터는 세션을 알지 못한다. */
  revalidateAccess: () => RuntimeEventAccessRevalidation
}

interface RuntimeEventSubscriber extends RuntimeEventSubscriberInput {
  id: string
  topicSet: Set<RuntimeEventTopic>
  lastAccessCheckAt: number
}

const serverBootId = crypto.randomUUID()

/**
 * SSE 구독자 레지스트리 + fan-out.
 *
 * 인메모리 버스만 구독하므로 DB 폴링 루프가 없다. 타이머는 하트비트 하나뿐이고,
 * 구독자가 0명이면 그 타이머조차 뜨지 않는다.
 */
export class RuntimeEventBroadcaster {
  private static subscribers = new Map<string, RuntimeEventSubscriber>()
  private static unsubscribeFromBus: (() => void) | null = null
  private static heartbeatHandle: ReturnType<typeof setInterval> | null = null
  private static replayBuffer: RuntimeEventRecord[] = []
  private static isShuttingDown = false

  /** Attach the broadcaster to the in-process event bus. */
  static start() {
    this.isShuttingDown = false
    this.ensureBusSubscription()
    return true
  }

  private static ensureBusSubscription() {
    if (this.unsubscribeFromBus) {
      return
    }

    this.unsubscribeFromBus = subscribeToRuntimeEvents((record) => {
      this.rememberForReplay(record)
      this.fanOut(record)
    })
  }

  private static rememberForReplay(record: RuntimeEventRecord) {
    this.replayBuffer.push(record)

    if (this.replayBuffer.length > RUNTIME_EVENT_REPLAY_BUFFER_LIMIT) {
      this.replayBuffer.splice(0, this.replayBuffer.length - RUNTIME_EVENT_REPLAY_BUFFER_LIMIT)
    }

    const oldestAllowedMs = Date.now() - RUNTIME_EVENT_REPLAY_BUFFER_MAX_AGE_MS
    while (this.replayBuffer.length > 0 && Date.parse(this.replayBuffer[0].at) < oldestAllowedMs) {
      this.replayBuffer.shift()
    }
  }

  private static isVisibleTo(record: RuntimeEventRecord, subscriber: RuntimeEventSubscriber) {
    if (!subscriber.topicSet.has(record.topic)) {
      return false
    }

    if (record.visibility === 'all' || subscriber.isAdmin) {
      return true
    }

    return record.accountId !== null && record.accountId === subscriber.accountId
  }

  /**
   * Fan one event out to every eligible subscriber.
   *
   * 직렬화는 **이벤트당 1회**다. 구독자 수만큼 `JSON.stringify` 를 반복하면 30명 접속 시
   * 같은 payload 를 30번 직렬화하며 이벤트 루프를 잡는다.
   */
  private static fanOut(record: RuntimeEventRecord) {
    if (this.subscribers.size === 0) {
      return
    }

    let frame: string | null | undefined

    for (const subscriber of this.subscribers.values()) {
      if (!this.isVisibleTo(record, subscriber)) {
        continue
      }

      if (frame === undefined) {
        frame = this.buildDataFrame(record)
      }

      if (frame === null) {
        return
      }

      this.write(subscriber, frame)
    }
  }

  /** Serialize one event into its SSE data frame, or null when the payload cannot be serialized. */
  private static buildDataFrame(record: RuntimeEventRecord): string | null {
    const envelope: RuntimeEventEnvelope = {
      id: record.id,
      name: record.name,
      topic: record.topic,
      at: record.at,
      payload: record.payload,
    }

    try {
      return `id: ${record.id}\nevent: ${record.name}\ndata: ${JSON.stringify(envelope)}\n\n`
    } catch (error) {
      // 직렬화 불가능한 payload 하나가 다른 구독자의 fan-out 까지 끊어서는 안 된다.
      console.warn(`⚠️ Skipping unserializable runtime event ${record.name}:`, error instanceof Error ? error.message : error)
      return null
    }
  }

  private static writeDataFrame(subscriber: RuntimeEventSubscriber, record: RuntimeEventRecord) {
    const frame = this.buildDataFrame(record)
    if (frame === null) {
      return
    }

    this.write(subscriber, frame)
  }

  private static writeControlFrame(subscriber: RuntimeEventSubscriber, event: string, payload: unknown) {
    this.write(subscriber, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  private static write(subscriber: RuntimeEventSubscriber, chunk: string) {
    try {
      if (subscriber.res.writableEnded) {
        this.unregister(subscriber.id)
        return
      }

      subscriber.res.write(chunk)
    } catch (error) {
      console.warn('⚠️ Failed to write runtime event frame, dropping subscriber:', error instanceof Error ? error.message : error)
      this.unregister(subscriber.id)
    }
  }

  /** Register one SSE response as a subscriber and send the opening frames. */
  static register(input: RuntimeEventSubscriberInput): { id: string; close: () => void } {
    this.ensureBusSubscription()

    const subscriber: RuntimeEventSubscriber = {
      ...input,
      id: crypto.randomUUID(),
      topicSet: new Set(input.topics),
      lastAccessCheckAt: Date.now(),
    }

    this.subscribers.set(subscriber.id, subscriber)
    this.ensureHeartbeatTimer()

    this.writeControlFrame(subscriber, 'hello', {
      cursor: getRuntimeEventCursor(),
      server_boot_id: serverBootId,
      runtime_role: resolveRuntimeSideEffectRole(),
      topics: input.topics,
      heartbeat_interval_ms: RUNTIME_EVENT_HEARTBEAT_INTERVAL_MS,
    })

    this.replayMissedEvents(subscriber)

    return {
      id: subscriber.id,
      close: () => this.unregister(subscriber.id),
    }
  }

  /**
   * Replay events the client missed while reconnecting.
   * 재생 버퍼 밖의 커서는 되돌릴 수 없으므로 `reset` 으로 전체 무효화를 요청한다.
   */
  private static replayMissedEvents(subscriber: RuntimeEventSubscriber) {
    const cursor = subscriber.resumeCursor
    if (cursor === null || cursor >= getRuntimeEventCursor()) {
      return
    }

    const oldestBufferedId = this.replayBuffer[0]?.id ?? null
    if (oldestBufferedId === null || cursor + 1 < oldestBufferedId) {
      this.writeControlFrame(subscriber, 'reset', { reason: 'cursor-expired' })
      return
    }

    for (const record of this.replayBuffer) {
      if (record.id > cursor && this.isVisibleTo(record, subscriber)) {
        this.writeDataFrame(subscriber, record)
      }
    }
  }

  /** Drop one subscriber and end its response. */
  static unregister(subscriberId: string) {
    const subscriber = this.subscribers.get(subscriberId)
    if (!subscriber) {
      return false
    }

    this.subscribers.delete(subscriberId)
    this.clearHeartbeatTimerWhenIdle()

    try {
      if (!subscriber.res.writableEnded) {
        subscriber.res.end()
      }
    } catch {
      // Socket already gone; nothing left to clean up.
    }

    return true
  }

  private static ensureHeartbeatTimer() {
    if (this.heartbeatHandle || this.subscribers.size === 0) {
      return
    }

    this.heartbeatHandle = setInterval(() => {
      this.runHeartbeatTick()
    }, RUNTIME_EVENT_HEARTBEAT_INTERVAL_MS)
    this.heartbeatHandle.unref?.()
  }

  private static clearHeartbeatTimerWhenIdle() {
    if (this.subscribers.size > 0 || !this.heartbeatHandle) {
      return
    }

    clearInterval(this.heartbeatHandle)
    this.heartbeatHandle = null
  }

  private static runHeartbeatTick() {
    const now = Date.now()
    const cursor = getRuntimeEventCursor()

    for (const subscriber of [...this.subscribers.values()]) {
      if (now - subscriber.lastAccessCheckAt >= RUNTIME_EVENT_ACCESS_REVALIDATE_MS) {
        subscriber.lastAccessCheckAt = now
        const revalidation = subscriber.revalidateAccess()
        if (!revalidation.ok) {
          this.writeControlFrame(subscriber, 'session-expired', { reason: revalidation.reason })
          this.unregister(subscriber.id)
          continue
        }
      }

      this.writeControlFrame(subscriber, 'heartbeat', { cursor, at: new Date(now).toISOString() })
    }
  }

  /**
   * Close every stream before the HTTP server stops accepting connections.
   *
   * `server.close()` 는 활성 SSE 소켓이 남아 있으면 resolve 되지 않는다. index.ts 의
   * `activeServer.close()` **앞**에서 반드시 호출되어야 드레인이 제때 끝난다.
   */
  static shutdown() {
    this.isShuttingDown = true
    const closedCount = this.subscribers.size

    for (const subscriber of [...this.subscribers.values()]) {
      this.writeControlFrame(subscriber, 'reset', { reason: 'server-restart' })
      this.unregister(subscriber.id)
    }

    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle)
      this.heartbeatHandle = null
    }

    if (this.unsubscribeFromBus) {
      this.unsubscribeFromBus()
      this.unsubscribeFromBus = null
    }

    this.replayBuffer = []
    return closedCount
  }

  /** Report live stream state to the status endpoint. */
  static getStatus() {
    return {
      subscriber_count: this.subscribers.size,
      cursor: getRuntimeEventCursor(),
      server_boot_id: serverBootId,
      topics: [...RUNTIME_EVENT_TOPICS],
      is_shutting_down: this.isShuttingDown,
    }
  }
}
