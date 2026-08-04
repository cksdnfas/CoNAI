import type { Request, Response } from 'express'
import { AuthAccount } from '../../models/AuthAccount'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { normalizeGenerationQueueRoutingTag } from '../../services/generationQueueRouting'
import { AuthAccessControlService } from '../../services/authAccessControlService'
import { readQueueDebugMeta } from '../../services/generation-queue/queueDebugMeta'
import type { GenerationQueueJobListRecord, GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import { getRequesterAccountId, isAdminRequest } from '../requester-session-helpers'
import { parsePositiveInteger, sendRouteBadRequest } from '../routeValidation'

export { getRequesterAccountId } from '../requester-session-helpers'

export const ACTIVE_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']
export const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
const ALL_QUEUE_STATUSES: GenerationQueueJobStatus[] = [...ACTIVE_QUEUE_STATUSES, ...TERMINAL_QUEUE_STATUSES]
const ALL_QUEUE_STATUS_SET = new Set<GenerationQueueJobStatus>(ALL_QUEUE_STATUSES)

/**
 * PAYLOAD-2: 디버그 메타는 `debug_meta` 컬럼에서 읽는다.
 * 029 이전 행만 모델의 SQL 폴백이 인라인 `request_payload._debug` 를 대신 꺼내 준다.
 */
export function parseQueueDebugMeta(job: Pick<GenerationQueueJobRecord, 'id'>) {
  return readQueueDebugMeta(job.id)
}

export function parseStatusList(value: unknown): GenerationQueueJobStatus[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  const invalid = entries.filter((entry) => !ALL_QUEUE_STATUS_SET.has(entry as GenerationQueueJobStatus))
  if (invalid.length > 0) {
    throw new Error(`Invalid queue status filter: ${invalid.join(', ')}`)
  }

  return entries.length > 0 ? entries as GenerationQueueJobStatus[] : undefined
}

export function parseServiceType(value: unknown): GenerationQueueJobRecord['service_type'] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  if (value !== 'comfyui' && value !== 'novelai' && value !== 'codex') {
    throw new Error(`Invalid service_type filter: ${String(value)}`)
  }

  return value
}

export function parsePositiveIntegerQuery(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = parsePositiveInteger(value)
  if (parsed === null) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

export function parseRequestedServerTag(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('requested_server_tag must be a string')
  }

  const normalized = normalizeGenerationQueueRoutingTag(value)
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
    throw new Error('requested_server_tag must match /^[a-z0-9][a-z0-9._-]{0,63}$/')
  }

  return normalized
}

function canAccessJob(req: Request, job: Pick<GenerationQueueJobRecord, 'requested_by_account_id'>) {
  if (isAdminRequest(req)) {
    return true
  }

  const accountId = getRequesterAccountId(req)
  return accountId !== null && job.requested_by_account_id === accountId
}

/**
 * Resolve one queue job the requester may act on.
 *
 * PAYLOAD-1: 접근 판정과 라우트 응답 모두 페이로드를 쓰지 않으므로 경량 조회로 읽는다.
 * 페이로드가 필요한 유일한 액션(재시도)은 서비스 계층이 따로 하이드레이트한다.
 */
export function resolveAccessibleQueueJob(req: Request, res: Response): { jobId: number; job: GenerationQueueJobListRecord } | null {
  const jobId = parsePositiveInteger(req.params.id)
  if (jobId === null) {
    sendRouteBadRequest(res, 'Invalid queue job id')
    return null
  }

  const job = GenerationQueueModel.findListRecordById(jobId)
  if (!job) {
    res.status(404).json({ success: false, error: 'Generation queue job not found' })
    return null
  }

  if (!canAccessJob(req, job)) {
    res.status(403).json({ success: false, error: 'You do not have access to this queue job' })
    return null
  }

  return { jobId, job }
}

export function hasGenerationPageAccess(req: Request) {
  const accountId = getRequesterAccountId(req)
  return AuthAccessControlService.hasPermission(accountId, 'page.generation.view')
}

export function buildQueueRequesterUsernameMap(records: Array<Pick<GenerationQueueJobRecord, 'requested_by_account_id'>>) {
  const usernameByAccountId = new Map<number, string>()
  const accountIds = Array.from(new Set(
    records
      .map((record) => record.requested_by_account_id)
      .filter((accountId): accountId is number => typeof accountId === 'number' && accountId > 0),
  ))

  for (const account of AuthAccount.findByIds(accountIds)) {
    if (account.username) {
      usernameByAccountId.set(account.id, account.username)
    }
  }

  return usernameByAccountId
}
