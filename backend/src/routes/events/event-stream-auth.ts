import type { Request } from 'express'
import { AuthAccount } from '../../models/AuthAccount'
import { AuthAccessControlService } from '../../services/authAccessControlService'
import { hasConfiguredAuth } from '../auth-route-helpers'
import { RUNTIME_EVENT_TOPIC_PERMISSION_KEY, type RuntimeEventTopic } from '../../types/runtimeEvents'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'

/**
 * SSE 전용 read-only 접근 가드.
 *
 * **이 파일과 event-stream.routes.ts 는 `req.session` 에 어떤 필드도 쓰지 않는다.**
 * `express-session` 은 응답 종료 시점에 세션 행을 저장한다. SSE 응답은 수십 분 열려 있으므로,
 * 그 사이 다른 탭에서 로그아웃/권한 회수가 일어나도 스트림이 끊기는 순간 오래된 스냅샷이
 * 세션 행을 덮어써 로그아웃을 되돌린다. 따라서 `requirePermission`/`optionalAuth`/
 * `setTrustedBootstrapSession` 같은 세션 변조 미들웨어는 이 경로에서 절대 쓰지 않고,
 * 권한은 매번 `AuthAccessControlService` 로 직접 해석한다.
 */

export type EventStreamAccess =
  | { ok: true; accountId: number | null; isAdmin: boolean; permissionKeys: string[] }
  | { ok: false; status: 401 | 403 }

/**
 * 인증 세션만으로 구독할 수 있는 토픽.
 *
 * 큐 목록 REST(`GET /api/generation-queue`)가 인증만 요구하는 permission-neutral 표면이므로,
 * 같은 데이터를 나르는 SSE 토픽도 같은 기준을 쓴다. 나머지 토픽은 생성 페이지 권한이 필요하다.
 */
const SESSION_ONLY_TOPICS: ReadonlySet<RuntimeEventTopic> = new Set(['generation-queue'])

/** Filter the requested topics down to what this permission set may subscribe to. */
export function resolvePermittedEventStreamTopics(
  permissionKeys: string[],
  requestedTopics: RuntimeEventTopic[],
): RuntimeEventTopic[] {
  if (permissionKeys.includes(RUNTIME_EVENT_TOPIC_PERMISSION_KEY)) {
    return requestedTopics
  }

  return requestedTopics.filter((topic) => SESSION_ONLY_TOPICS.has(topic))
}

/** 구독이 세션 전용 토픽 밖으로 나가는지 — 나가면 재검증이 페이지 권한을 계속 요구해야 한다. */
export function eventStreamTopicsRequirePagePermission(topics: RuntimeEventTopic[]): boolean {
  return topics.some((topic) => !SESSION_ONLY_TOPICS.has(topic))
}

/** Resolve stream access for one request without mutating the session. */
export function resolveEventStreamAccess(req: Request): EventStreamAccess {
  if (!hasConfiguredAuth()) {
    if (!isDirectLoopbackRequest(req)) {
      return { ok: false, status: 401 }
    }

    // 부트스트랩(개인) 모드. 신뢰 세션을 "쓰지 않고" 권한만 해석한다.
    // 판정 기준은 생성 라우트의 권한 가드와 동일하게 맞춘다.
    const resolvedAccess = AuthAccessControlService.resolveBootstrapAccess()
    return {
      ok: true,
      accountId: null,
      isAdmin: true,
      permissionKeys: resolvedAccess.permissionKeys,
    }
  }

  if (req.session?.authenticated !== true) {
    return { ok: false, status: 401 }
  }

  const accountId = req.session.accountId
  if (typeof accountId !== 'number') {
    // 계정 없는 인증 세션(구 부트스트랩 잔여). refreshSessionAccess 의 비수치 분기와 같은 판단을 하되 읽기만 한다.
    const cachedPermissionKeys = Array.isArray(req.session.permissionKeys) ? req.session.permissionKeys : []
    return {
      ok: true,
      accountId: null,
      isAdmin: req.session.accountType === 'admin',
      permissionKeys: cachedPermissionKeys,
    }
  }

  const account = AuthAccount.findById(accountId)
  if (!account || account.status !== 'active') {
    return { ok: false, status: 401 }
  }

  const resolvedAccess = AuthAccessControlService.resolveForAccountId(accountId)
  return {
    ok: true,
    accountId,
    isAdmin: account.account_type === 'admin',
    permissionKeys: resolvedAccess.permissionKeys,
  }
}

/**
 * Build the periodic revalidation closure used by the broadcaster heartbeat.
 * 요청 객체에서 계정 식별자만 캡처하므로 스트림이 살아 있는 동안에도 세션 객체를 만지지 않는다.
 *
 * `requiresPagePermission` 은 구독이 세션 전용 토픽(큐) 밖을 포함할 때만 true 다.
 * 큐 전용 구독은 페이지 권한이 회수되어도 계속 살아 있어야 한다 — 애초에 권한 없이 열 수 있으므로.
 */
export function createEventStreamAccessRevalidator(accountId: number | null, requiresPagePermission: boolean) {
  return (): { ok: true } | { ok: false; reason: 'unauthenticated' | 'permission-revoked' } => {
    if (!hasConfiguredAuth()) {
      return { ok: true }
    }

    if (accountId === null) {
      return { ok: true }
    }

    const account = AuthAccount.findById(accountId)
    if (!account || account.status !== 'active') {
      return { ok: false, reason: 'unauthenticated' }
    }

    if (requiresPagePermission) {
      const resolvedAccess = AuthAccessControlService.resolveForAccountId(accountId)
      if (!resolvedAccess.permissionKeys.includes(RUNTIME_EVENT_TOPIC_PERMISSION_KEY)) {
        return { ok: false, reason: 'permission-revoked' }
      }
    }

    return { ok: true }
  }
}
