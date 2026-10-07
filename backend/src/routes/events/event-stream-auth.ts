import type { Request } from 'express'
import { AuthAccount } from '../../models/AuthAccount'
import { AuthAccessControlService } from '../../services/authAccessControlService'
import { hasConfiguredAuth } from '../auth-route-helpers'
import { RUNTIME_EVENT_TOPIC_PERMISSIONS, type RuntimeEventTopic } from '../../types/runtimeEvents'
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

/** Topic authorization is independent of page visibility. */
export function resolvePermittedEventStreamTopics(permissionKeys: string[], requestedTopics: RuntimeEventTopic[]): RuntimeEventTopic[] {
  return requestedTopics.filter((topic) => {
    const permission = RUNTIME_EVENT_TOPIC_PERMISSIONS[topic]
    return permission === null || permissionKeys.includes(permission)
  })
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
    return { ok: false, status: 401 }
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

/** Capture current grants; a long-lived stream must never mutate its session. */
export function createEventStreamAccessRevalidator(accountId: number | null, topics: RuntimeEventTopic[], initiallyAdmin = false, initialPermissionKeys?: string[]) {
  const initialKeys = new Set(initialPermissionKeys ?? AuthAccessControlService.resolveForAccountId(accountId).permissionKeys)
  return (): { ok: true } | { ok: false; reason: 'unauthenticated' | 'permission-revoked' } => {
    if (!hasConfiguredAuth()) return { ok: true }
    if (accountId === null) return { ok: false, reason: 'unauthenticated' }
    const account = AuthAccount.findById(accountId)
    if (!account || account.status !== 'active') return { ok: false, reason: 'unauthenticated' }
    // Reconnect on any role or grant change so the client refreshes its shared auth state.
    if (initiallyAdmin !== (account.account_type === 'admin')) return { ok: false, reason: 'permission-revoked' }
    const keys = AuthAccessControlService.resolveForAccountId(accountId).permissionKeys
    if (keys.length !== initialKeys.size || keys.some((key) => !initialKeys.has(key))) return { ok: false, reason: 'permission-revoked' }
    if (resolvePermittedEventStreamTopics(keys, topics).length !== topics.length) return { ok: false, reason: 'permission-revoked' }
    return { ok: true }
  }
}
