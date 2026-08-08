import type { Request } from 'express'
import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import type { GenerationQueueJobListRecord, GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import { computeQueueEtas, computeQueuePositions } from './queue-eta'
import { buildQueueListSnapshotCacheKey, readQueueListSnapshot } from './queue-list-snapshot-cache'
import { getGenerationQueueLiveProgress } from '../../services/generation-queue/queueProgressRegistry'
import {
  ACTIVE_QUEUE_STATUSES,
  buildQueueRequesterUsernameMap,
  getRequesterAccountId,
  parsePositiveIntegerQuery,
  parseServiceType,
  parseStatusList,
} from './queue-route-helpers'

const DEFAULT_QUEUE_LIST_LIMIT = 200
const MAX_QUEUE_LIST_LIMIT = 500
const QUEUE_ETA_WINDOW_LIMIT = 300

type QueueListFilters = {
  statuses?: GenerationQueueJobStatus[]
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number
  requesterAccountId?: number
}

function matchesActiveQueueStatusFilter(statuses: GenerationQueueJobStatus[] | undefined) {
  if (!statuses || statuses.length !== ACTIVE_QUEUE_STATUSES.length) {
    return false
  }

  const statusSet = new Set(statuses)
  return ACTIVE_QUEUE_STATUSES.every((status) => statusSet.has(status))
}

function parseQueueListLimit(value: unknown) {
  const parsed = parsePositiveIntegerQuery(value, 'limit')
  return Math.min(parsed ?? DEFAULT_QUEUE_LIST_LIMIT, MAX_QUEUE_LIST_LIMIT)
}

function parseQueueListOffset(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('offset must be a non-negative integer')
  }

  return parsed
}

function buildQueueListFilters(req: Request) {
  const statuses = parseStatusList(req.query.status)
  const serviceType = parseServiceType(req.query.service_type)
  const workflowId = parsePositiveIntegerQuery(req.query.workflow_id, 'workflow_id')
  const limit = parseQueueListLimit(req.query.limit)
  const offset = parseQueueListOffset(req.query.offset)
  const mineOnly = req.query.mine === 'true'
  const requesterAccountId = getRequesterAccountId(req)

  return {
    requesterAccountId,
    limit,
    offset,
    filters: {
      statuses,
      serviceType,
      workflowId,
      requesterAccountId: mineOnly ? requesterAccountId ?? -1 : undefined,
    } satisfies QueueListFilters,
  }
}

function readActiveEtaWindowRecords(filters: QueueListFilters, records: GenerationQueueJobListRecord[]) {
  return matchesActiveQueueStatusFilter(filters.statuses)
    ? records
    : GenerationQueueModel.findAllListRecords({
      statuses: ACTIVE_QUEUE_STATUSES,
      serviceType: filters.serviceType,
      workflowId: filters.workflowId,
      requesterAccountId: filters.requesterAccountId,
      limit: QUEUE_ETA_WINDOW_LIMIT,
    })
}

/**
 * Compute one permission-neutral queue list snapshot.
 *
 * 요청자에 따라 달라지는 값은 여기에 **절대** 들어가지 않는다. `is_mine` 은
 * `buildGenerationQueueListResponse` 가 스냅샷을 읽은 뒤에만 얹는다.
 */
function buildQueueListSnapshot(filters: QueueListFilters, limit: number, offset: number) {
  const total = GenerationQueueModel.countListRecords(filters)
  const records = total === 0
    ? []
    : GenerationQueueModel.findAllListRecords({
      ...filters,
      limit,
      offset,
    })

  const activeRelevantRecords = readActiveEtaWindowRecords(filters, records)
  const hasActiveRelevantRecords = activeRelevantRecords.length > 0
  const completedRelevantRecords = hasActiveRelevantRecords
    ? GenerationQueueModel.findRecentCompleted({
      serviceType: filters.serviceType,
      workflowId: filters.workflowId,
    })
    : []
  const activeComfyServers = hasActiveRelevantRecords ? ComfyUIServerModel.findActiveServers() : []
  const queuePositions = computeQueuePositions(activeRelevantRecords, activeComfyServers)
  const queueEtas = computeQueueEtas(activeRelevantRecords, queuePositions, completedRelevantRecords, activeComfyServers)
  const requesterUsernames = buildQueueRequesterUsernameMap(records)

  return {
    records: records.map((record) => {
      const queuePosition = queuePositions.get(record.id)
      const queueEta = queueEtas.get(record.id)

      return {
        ...record,
        requested_by_username: record.requested_by_account_id != null ? (requesterUsernames.get(record.requested_by_account_id) ?? null) : null,
        queue_position: queuePosition?.position ?? null,
        queue_position_scope: queuePosition?.scope ?? null,
        queue_position_server_id: queuePosition?.serverId ?? null,
        queue_position_server_tag: queuePosition?.serverTag ?? null,
        estimated_start_at: queueEta?.startAt ?? null,
        estimated_wait_seconds: queueEta?.waitSeconds ?? null,
        estimated_total_seconds: queueEta?.totalSeconds ?? null,
        estimated_duration_seconds: queueEta?.durationSeconds ?? null,
      }
    }),
    total,
    limit,
    offset,
  }
}

export type GenerationQueueListSnapshot = ReturnType<typeof buildQueueListSnapshot>

/**
 * Read the shared queue list snapshot and decorate it for this requester.
 *
 * N 명이 동시에 폴링해도 스냅샷 계산은 TTL 당 1회다. 요청자별 필드(`is_mine`)만
 * 캐시 **밖에서** 계산되므로 다른 사용자의 소유 표시가 새어 나갈 수 없다.
 */
export function buildGenerationQueueListResponse(req: Request) {
  const { requesterAccountId, limit, offset, filters } = buildQueueListFilters(req)
  const snapshot = readQueueListSnapshot(
    buildQueueListSnapshotCacheKey({
      statuses: filters.statuses,
      serviceType: filters.serviceType,
      workflowId: filters.workflowId,
      requesterAccountId: filters.requesterAccountId,
      limit,
      offset,
    }),
    () => buildQueueListSnapshot(filters, limit, offset),
  )

  return {
    success: true,
    records: snapshot.records.map((record) => ({
      ...record,
      // Progress is process-local and high frequency, so decorate it outside the shared TTL snapshot.
      live_progress: record.status === 'running' ? getGenerationQueueLiveProgress(record.id) : null,
      is_mine: requesterAccountId !== null && record.requested_by_account_id === requesterAccountId,
    })),
    total: snapshot.total,
    limit: snapshot.limit,
    offset: snapshot.offset,
  }
}
