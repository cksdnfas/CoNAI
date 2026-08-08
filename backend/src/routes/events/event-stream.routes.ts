import express, { type Request, type Response } from 'express'
import { RuntimeEventBroadcaster } from '../../services/runtime-events/runtimeEventBroadcaster'
import { RUNTIME_EVENT_TOPICS, type RuntimeEventTopic } from '../../types/runtimeEvents'
import {
  createEventStreamAccessRevalidator,
  eventStreamTopicsRequirePagePermission,
  resolveEventStreamAccess,
  resolvePermittedEventStreamTopics,
} from './event-stream-auth'

/** SSE 재연결 권고 간격. 브라우저 EventSource 가 이 값을 그대로 쓴다. */
const RUNTIME_EVENT_STREAM_RETRY_MS = 3000

/** Check the server-side kill switch. `CONAI_RUNTIME_EVENTS=off` makes the route disappear. */
export function isRuntimeEventStreamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CONAI_RUNTIME_EVENTS?.trim().toLowerCase()
  return raw !== 'off' && raw !== 'false' && raw !== '0'
}

/** Parse the requested topic list, silently dropping unknown topics. */
function parseRequestedTopics(rawTopics: unknown): RuntimeEventTopic[] {
  if (typeof rawTopics !== 'string' || rawTopics.trim().length === 0) {
    return [...RUNTIME_EVENT_TOPICS]
  }

  const requested = new Set(rawTopics.split(',').map((topic) => topic.trim()))
  return RUNTIME_EVENT_TOPICS.filter((topic) => requested.has(topic))
}

/** Resolve the resume cursor from the browser `Last-Event-ID` header or an explicit query. */
function parseResumeCursor(req: Request): number | null {
  const rawCursor = req.header('Last-Event-ID') ?? (typeof req.query.cursor === 'string' ? req.query.cursor : null)
  if (!rawCursor) {
    return null
  }

  const parsed = Number(rawCursor)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function createRuntimeEventStreamRoutes() {
  const router = express.Router()

  /** GET /api/events/stream */
  router.get('/stream', (req: Request, res: Response) => {
    if (!isRuntimeEventStreamEnabled()) {
      res.status(404).json({ error: 'Not Found' })
      return
    }

    const access = resolveEventStreamAccess(req)
    if (!access.ok) {
      res.status(access.status).json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' })
      return
    }

    // 큐 토픽은 인증만으로 구독 가능, 나머지 토픽은 생성 페이지 권한이 필요하다.
    // 허용 집합은 hello 프레임의 topics 로 클라이언트에 그대로 알려진다.
    const grantedTopics = resolvePermittedEventStreamTopics(access.permissionKeys, parseRequestedTopics(req.query.topics))
    if (grantedTopics.length === 0) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    // compression 은 첫 write 시점에 Content-Type 을 보고 event-stream 을 건너뛴다(index.ts filter).
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    // 역프록시(nginx 등) 버퍼링 차단. 이게 없으면 프레임이 모였다가 한 번에 나간다.
    res.setHeader('X-Accel-Buffering', 'no')

    // index.ts 의 `server.setTimeout(60000)` 은 리스너가 없으면 소켓을 파괴한다.
    // 명시적으로 무제한으로 두지 않으면 SSE 연결이 60초마다 끊긴다.
    res.socket?.setTimeout(0)
    res.socket?.setNoDelay(true)
    res.socket?.setKeepAlive(true)

    res.flushHeaders()
    res.write(`retry: ${RUNTIME_EVENT_STREAM_RETRY_MS}\n\n`)

    const subscription = RuntimeEventBroadcaster.register({
      res,
      accountId: access.accountId,
      isAdmin: access.isAdmin,
      topics: grantedTopics,
      resumeCursor: parseResumeCursor(req),
      revalidateAccess: createEventStreamAccessRevalidator(
        access.accountId,
        eventStreamTopicsRequirePagePermission(grantedTopics),
      ),
    })

    req.on('close', () => {
      RuntimeEventBroadcaster.unregister(subscription.id)
    })
  })

  /** GET /api/events/status — 진단용 경량 스냅샷. */
  router.get('/status', (req: Request, res: Response) => {
    if (!isRuntimeEventStreamEnabled()) {
      res.status(404).json({ error: 'Not Found' })
      return
    }

    const access = resolveEventStreamAccess(req)
    if (!access.ok) {
      res.status(access.status).json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' })
      return
    }

    res.json({
      success: true,
      data: RuntimeEventBroadcaster.getStatus(),
    })
  })

  return router
}

export const runtimeEventStreamRoutes = createRuntimeEventStreamRoutes()
