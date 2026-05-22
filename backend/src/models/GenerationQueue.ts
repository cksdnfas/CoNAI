import { getUserSettingsDb } from '../database/userSettingsDb'
import type {
  GenerationQueueDispatchCandidateRecord,
  GenerationQueueDurationSample,
  GenerationQueueJobCreateData,
  GenerationQueueJobListRecord,
  GenerationQueueJobRecord,
  GenerationQueueJobStatus,
  GenerationQueueJobUpdateData,
} from '../types/generationQueue'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyPayload(value: Record<string, unknown> | undefined) {
  if (value === undefined) {
    return undefined
  }

  return JSON.stringify(value)
}

function toPersistedQueueUpdates(data: GenerationQueueJobUpdateData) {
  return filterDefined({
    ...data,
    request_payload: stringifyPayload(data.request_payload),
    cancel_requested: data.cancel_requested === undefined ? undefined : (data.cancel_requested ? 1 : 0),
    updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
  })
}

type GenerationQueueFilters = {
  statuses?: GenerationQueueJobStatus[]
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number
}

type GenerationQueueFindAllInput = GenerationQueueJobStatus[] | GenerationQueueFilters
type GenerationQueueStatusCountFilters = Pick<GenerationQueueFilters, 'serviceType' | 'workflowId'>
type GenerationQueueRecentCompletedFilters = GenerationQueueStatusCountFilters & { limit?: number }

const GENERATION_QUEUE_LIST_COLUMNS = `
  id, service_type, status, priority,
  requested_by_account_id, requested_by_account_type,
  workflow_id, workflow_name,
  requested_group_id, requested_server_id, requested_server_tag,
  assigned_server_id, provider_job_id,
  request_summary, failure_code, failure_message,
  cancel_requested, queued_at, started_at, completed_at,
  created_date, updated_date
`

const GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS = `
  id, service_type, status, priority,
  workflow_id, requested_server_id, requested_server_tag,
  assigned_server_id, cancel_requested, queued_at
`

type QueueWhereOptions = {
  includeStatuses?: boolean
}

function normalizeFindAllInput(input?: GenerationQueueFindAllInput): GenerationQueueFilters {
  if (Array.isArray(input)) {
    return { statuses: input }
  }

  return input ?? {}
}

function appendQueueFilterClauses(
  clauses: string[],
  values: Array<string | number>,
  filters: GenerationQueueFilters,
  options: QueueWhereOptions = {},
) {
  if (options.includeStatuses !== false && filters.statuses && filters.statuses.length > 0) {
    clauses.push(`status IN (${filters.statuses.map(() => '?').join(', ')})`)
    values.push(...filters.statuses)
  }

  if (filters.serviceType) {
    clauses.push('service_type = ?')
    values.push(filters.serviceType)
  }

  if (filters.workflowId !== undefined) {
    clauses.push('workflow_id = ?')
    values.push(filters.workflowId)
  }
}

function buildQueueWhereClause(filters: GenerationQueueFilters, options: QueueWhereOptions = {}) {
  const clauses: string[] = []
  const values: Array<string | number> = []
  appendQueueFilterClauses(clauses, values, filters, options)

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  }
}

function emptyStatusCounts(): Record<GenerationQueueJobStatus, number> {
  return {
    queued: 0,
    dispatching: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }
}

function getQueueOrderSql(hasStatusFilter: boolean) {
  return hasStatusFilter
    ? 'ORDER BY priority ASC, queued_at ASC, id ASC'
    : `
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'dispatching' THEN 1
          WHEN 'queued' THEN 2
          ELSE 3
        END ASC,
        priority ASC,
        queued_at ASC,
        id ASC
    `
}

export class GenerationQueueModel {
  /** Create one persistent queue job row. */
  static create(data: GenerationQueueJobCreateData) {
    const db = getUserSettingsDb()
    const queuedAt = data.queued_at ?? new Date().toISOString()
    const info = db.prepare(`
      INSERT INTO generation_queue_jobs (
        service_type, status, priority,
        requested_by_account_id, requested_by_account_type,
        workflow_id, workflow_name,
        requested_group_id, requested_server_id, requested_server_tag, assigned_server_id,
        provider_job_id,
        request_payload, request_summary,
        failure_code, failure_message,
        cancel_requested, queued_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.service_type,
      data.status ?? 'queued',
      data.priority ?? 100,
      data.requested_by_account_id ?? null,
      data.requested_by_account_type ?? null,
      data.workflow_id ?? null,
      data.workflow_name ?? null,
      data.requested_group_id ?? null,
      data.requested_server_id ?? null,
      data.requested_server_tag ?? null,
      data.assigned_server_id ?? null,
      data.provider_job_id ?? null,
      JSON.stringify(data.request_payload),
      data.request_summary ?? null,
      data.failure_code ?? null,
      data.failure_message ?? null,
      data.cancel_requested ? 1 : 0,
      queuedAt,
      data.started_at ?? null,
      data.completed_at ?? null,
    )

    return info.lastInsertRowid as number
  }

  /** Find one queue job by id. */
  static findById(id: number) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM generation_queue_jobs WHERE id = ?').get(id) as GenerationQueueJobRecord | undefined
    return row ?? null
  }

  /** Find one queue job for API responses without hydrating heavyweight request payloads. */
  static findListRecordById(id: number) {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT ${GENERATION_QUEUE_LIST_COLUMNS}
      FROM generation_queue_jobs
      WHERE id = ?
    `).get(id) as GenerationQueueJobListRecord | undefined
    return row ?? null
  }

  /** List full queue jobs, newest queue entries last within status groups. */
  static findAll(input?: GenerationQueueFindAllInput) {
    const db = getUserSettingsDb()
    const filters = normalizeFindAllInput(input)
    const { whereSql, values } = buildQueueWhereClause(filters)
    const orderSql = getQueueOrderSql(Boolean(filters.statuses && filters.statuses.length > 0))

    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      ${whereSql}
      ${orderSql}
    `).all(...values) as GenerationQueueJobRecord[]
  }

  /** List queue jobs for polling/UI without hydrating heavyweight request payloads. */
  static findAllListRecords(input?: GenerationQueueFindAllInput) {
    const db = getUserSettingsDb()
    const filters = normalizeFindAllInput(input)
    const { whereSql, values } = buildQueueWhereClause(filters)
    const orderSql = getQueueOrderSql(Boolean(filters.statuses && filters.statuses.length > 0))

    return db.prepare(`
      SELECT ${GENERATION_QUEUE_LIST_COLUMNS}
      FROM generation_queue_jobs
      ${whereSql}
      ${orderSql}
    `).all(...values) as GenerationQueueJobListRecord[]
  }

  /** Check whether a queued ComfyUI job exists without hydrating queue rows. */
  static hasQueuedComfyJob() {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT 1 FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      LIMIT 1
    `).get() as { 1: number } | undefined
    return Boolean(row)
  }

  /** List queued ComfyUI jobs ordered by dispatch priority. */
  static findQueuedComfyJobs() {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      ORDER BY priority ASC, queued_at ASC, id ASC
    `).all() as GenerationQueueJobRecord[]
  }

  /** List queued ComfyUI dispatch candidates without hydrating heavyweight request payloads. */
  static findQueuedComfyDispatchCandidates() {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT ${GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS}
      FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      ORDER BY priority ASC, queued_at ASC, id ASC
    `).all() as GenerationQueueDispatchCandidateRecord[]
  }

  /** List lean recent completed queue jobs for ETA sampling without scanning or hydrating whole history. */
  static findRecentCompleted(input: number | GenerationQueueRecentCompletedFilters = 240) {
    const db = getUserSettingsDb()
    const filters: GenerationQueueRecentCompletedFilters = typeof input === 'number'
      ? { limit: input }
      : input
    const limit = Math.max(1, Math.floor(filters.limit ?? 240))
    const clauses = ['status = ?']
    const values: Array<string | number> = ['completed']
    appendQueueFilterClauses(clauses, values, filters, { includeStatuses: false })

    return db.prepare(`
      SELECT
        id, service_type, workflow_id, requested_server_id,
        assigned_server_id, started_at, completed_at
      FROM generation_queue_jobs
      WHERE ${clauses.join(' AND ')}
      ORDER BY completed_at DESC, id DESC
      LIMIT ?
    `).all(...values, limit) as GenerationQueueDurationSample[]
  }

  /** Update one queue job row. */
  static update(id: number, data: GenerationQueueJobUpdateData) {
    const db = getUserSettingsDb()
    const updates = toPersistedQueueUpdates(data)

    if (Object.keys(updates).length === 0) {
      return false
    }

    const { sql, values } = buildUpdateQuery('generation_queue_jobs', updates, { id })
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  /** Update one queue job only if its current status still matches one expected status. */
  static updateIfCurrentStatus(id: number, expectedStatuses: GenerationQueueJobStatus[], data: GenerationQueueJobUpdateData) {
    const db = getUserSettingsDb()
    const updates = toPersistedQueueUpdates(data)

    if (expectedStatuses.length === 0 || Object.keys(updates).length === 0) {
      return false
    }

    const setClauses: string[] = []
    const values: any[] = []
    for (const [key, value] of Object.entries(updates)) {
      if (value && typeof value === 'object' && '__sqlLiteral' in value && value.__sqlLiteral === true) {
        setClauses.push(`${key} = ${value.value}`)
      } else {
        setClauses.push(`${key} = ?`)
        values.push(value)
      }
    }

    const statusPlaceholders = expectedStatuses.map(() => '?').join(', ')
    const sql = `
      UPDATE generation_queue_jobs
      SET ${setClauses.join(', ')}
      WHERE id = ?
        AND status IN (${statusPlaceholders})
    `

    values.push(id, ...expectedStatuses)
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  /** Mark a queued or running job as cancellation-requested. */
  static requestCancel(id: number) {
    return this.update(id, { cancel_requested: true })
  }

  /** Mark a queue job as cancellation-requested only if its status still matches. */
  static requestCancelIfCurrentStatus(id: number, expectedStatuses: GenerationQueueJobStatus[]) {
    return this.updateIfCurrentStatus(id, expectedStatuses, { cancel_requested: true })
  }

  /** Check whether a user-submitted generation queue job is waiting or running. */
  static hasActiveUserSubmittedJobs() {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT 1 AS present
      FROM generation_queue_jobs
      WHERE status IN ('queued', 'dispatching', 'running')
        AND requested_by_account_id IS NOT NULL
        AND cancel_requested = 0
      LIMIT 1
    `).get() as { present: number } | undefined

    return Boolean(row)
  }

  /** Summarize queue totals by status. */
  static getStatusCounts(filters: GenerationQueueStatusCountFilters = {}) {
    const db = getUserSettingsDb()
    const { whereSql, values } = buildQueueWhereClause(filters)
    const rows = db.prepare(`
      SELECT status, COUNT(*) as total
      FROM generation_queue_jobs
      ${whereSql}
      GROUP BY status
    `).all(...values) as Array<{ status: GenerationQueueJobStatus; total: number }>

    const counts = emptyStatusCounts()

    for (const row of rows) {
      counts[row.status] = row.total
    }

    return counts
  }

  /** List jobs visible for one requester. */
  static findByRequester(accountId: number) {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      WHERE requested_by_account_id = ?
      ORDER BY queued_at DESC, id DESC
    `).all(accountId) as GenerationQueueJobRecord[]
  }
}
