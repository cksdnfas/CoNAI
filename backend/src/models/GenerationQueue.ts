import { getUserSettingsDb } from '../database/userSettingsDb'
import type {
  GenerationQueueJobCreateData,
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

  /** List queue jobs, newest queue entries last within status groups. */
  static findAll(statuses?: GenerationQueueJobStatus[]) {
    const db = getUserSettingsDb()

    if (!statuses || statuses.length === 0) {
      return db.prepare(`
        SELECT * FROM generation_queue_jobs
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
      `).all() as GenerationQueueJobRecord[]
    }

    const placeholders = statuses.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      WHERE status IN (${placeholders})
      ORDER BY priority ASC, queued_at ASC, id ASC
    `).all(...statuses) as GenerationQueueJobRecord[]
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

  /** Summarize queue totals by status. */
  static getStatusCounts() {
    const db = getUserSettingsDb()
    const rows = db.prepare(`
      SELECT status, COUNT(*) as total
      FROM generation_queue_jobs
      GROUP BY status
    `).all() as Array<{ status: GenerationQueueJobStatus; total: number }>

    const counts: Record<GenerationQueueJobStatus, number> = {
      queued: 0,
      dispatching: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    }

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
