import type { Request, Response } from 'express'
import { AuthAccount } from '../../models/AuthAccount'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { normalizeGenerationQueueRoutingTag } from '../../services/generationQueueRouting'
import { AuthAccessControlService } from '../../services/authAccessControlService'
import type { GenerationQueueJobListRecord, GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import { getRequesterAccountId, isAdminRequest } from '../requester-session-helpers'
import { parsePositiveInteger, sendRouteBadRequest } from '../routeValidation'

export { getRequesterAccountId } from '../requester-session-helpers'

export const ACTIVE_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']
export const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
const ALL_QUEUE_STATUSES: GenerationQueueJobStatus[] = [...ACTIVE_QUEUE_STATUSES, ...TERMINAL_QUEUE_STATUSES]
const ALL_QUEUE_STATUS_SET = new Set<GenerationQueueJobStatus>(ALL_QUEUE_STATUSES)

export function parseQueueDebugMeta(job: GenerationQueueJobRecord) {
  try {
    const parsed = JSON.parse(job.request_payload) as { _debug?: Record<string, unknown> }
    return parsed?._debug && typeof parsed._debug === 'object' && !Array.isArray(parsed._debug)
      ? parsed._debug
      : null
  } catch {
    return null
  }
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

function canAccessJob(req: Request, job: GenerationQueueJobRecord) {
  if (isAdminRequest(req)) {
    return true
  }

  const accountId = getRequesterAccountId(req)
  return accountId !== null && job.requested_by_account_id === accountId
}

export function resolveAccessibleQueueJob(req: Request, res: Response) {
  const jobId = parsePositiveInteger(req.params.id)
  if (jobId === null) {
    sendRouteBadRequest(res, 'Invalid queue job id')
    return null
  }

  const job = GenerationQueueModel.findById(jobId)
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

  for (const accountId of accountIds) {
    const account = AuthAccount.findById(accountId)
    if (account?.username) {
      usernameByAccountId.set(accountId, account.username)
    }
  }

  return usernameByAccountId
}

export function filterQueueRecords(records: GenerationQueueJobListRecord[], filters: {
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number
}) {
  return records.filter((record) => {
    if (filters.serviceType && record.service_type !== filters.serviceType) {
      return false
    }

    if (filters.workflowId !== undefined && record.workflow_id !== filters.workflowId) {
      return false
    }

    return true
  })
}
