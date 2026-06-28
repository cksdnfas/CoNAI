import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionRecord, GraphExecutionStatus, GraphExecutionTriggerType } from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'
import { chunkSqliteValues, compareNewestFirst, sqliteInPlaceholders } from '../utils/sqliteBatch'

export type GraphExecutionStatusCounts = {
  completed: number
  queued: number
  running: number
  failed: number
  cancelled: number
}

export type GraphWorkflowRuntimeExecutionSummary = {
  queued_count: number
  running_count: number
  manual_queued_count: number
  manual_running_count: number
  schedule_queued_count: number
  schedule_running_count: number
  completed_count: number
  failed_count: number
  cancelled_count: number
  oldest_queued_at?: string | null
  latest_completed_at?: string | null
  latest_failed_at?: string | null
  latest_error_message?: string | null
}

function createEmptyStatusCounts(): GraphExecutionStatusCounts {
  return {
    completed: 0,
    queued: 0,
    running: 0,
    failed: 0,
    cancelled: 0,
  }
}

export class GraphExecutionModel {
  /** Delete a specific execution id set. */
  static deleteByIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkSqliteValues(executionIds)) {
      const placeholders = sqliteInPlaceholders(batch)
      const result = db.prepare(`DELETE FROM graph_executions WHERE id IN (${placeholders})`).run(...batch)
      deletedCount += result.changes
    }
    return deletedCount
  }

  /** Find executions for a specific id set. */
  static findByIds(executionIds: number[]): GraphExecutionRecord[] {
    if (executionIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkSqliteValues(executionIds).flatMap((batch) => {
      const placeholders = sqliteInPlaceholders(batch)
      return db.prepare(`
        SELECT * FROM graph_executions
        WHERE id IN (${placeholders})
      `).all(...batch) as GraphExecutionRecord[]
    })
    return records.sort(compareNewestFirst)
  }

  /** List executions for a workflow id set, newest first. */
  static findByWorkflowIds(workflowIds: number[], limit = 200): GraphExecutionRecord[] {
    if (workflowIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = workflowIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM graph_executions
      WHERE graph_workflow_id IN (${placeholders})
      ORDER BY created_date DESC, id DESC
      LIMIT ?
    `).all(...workflowIds, limit) as GraphExecutionRecord[]
  }

  /** List every execution for a workflow id set, newest first. */
  static findAllByWorkflowIds(workflowIds: number[]): GraphExecutionRecord[] {
    if (workflowIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = workflowIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM graph_executions
      WHERE graph_workflow_id IN (${placeholders})
      ORDER BY created_date DESC, id DESC
    `).all(...workflowIds) as GraphExecutionRecord[]
  }

  /** Count executions by status for schedule id sets without hydrating execution rows. */
  static countStatusesByScheduleIds(scheduleIds: number[]) {
    const countsByScheduleId = new Map<number, GraphExecutionStatusCounts>()
    for (const scheduleId of scheduleIds) {
      countsByScheduleId.set(scheduleId, createEmptyStatusCounts())
    }

    if (scheduleIds.length === 0) {
      return countsByScheduleId
    }

    const db = getUserSettingsDb()
    const placeholders = scheduleIds.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT schedule_id, status, COUNT(*) as total
      FROM graph_executions
      WHERE schedule_id IN (${placeholders})
      GROUP BY schedule_id, status
    `).all(...scheduleIds) as Array<{ schedule_id: number; status: GraphExecutionStatus; total: number }>

    for (const row of rows) {
      const counts = countsByScheduleId.get(row.schedule_id) ?? createEmptyStatusCounts()
      if (row.status in counts) {
        counts[row.status as keyof GraphExecutionStatusCounts] = row.total
      }
      countsByScheduleId.set(row.schedule_id, counts)
    }

    return countsByScheduleId
  }

  /** Count reserved schedule runs without loading execution rows. */
  static countReservedByScheduleId(scheduleId: number) {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT COUNT(*) as total
      FROM graph_executions
      WHERE schedule_id = ?
        AND status IN ('completed', 'queued', 'running')
    `).get(scheduleId) as { total: number } | undefined

    return row?.total ?? 0
  }

  /** Create one execution row for manual or schedule-triggered workflow execution. */
  static create(data: {
    graph_workflow_id: number
    graph_version: number
    status?: GraphExecutionStatus
    trigger_type?: GraphExecutionTriggerType
    schedule_id?: number | null
    execution_plan?: string | null
    started_at?: string | null
  }): number {
    const db = getUserSettingsDb()
    const status = data.status ?? 'running'
    const triggerType = data.trigger_type ?? 'manual'
    const startedAt = data.started_at !== undefined
      ? data.started_at
      : status === 'running'
        ? new Date().toISOString()
        : null

    const info = db.prepare(`
      INSERT INTO graph_executions (
        graph_workflow_id, graph_version, status, trigger_type, schedule_id, execution_plan, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.graph_workflow_id,
      data.graph_version,
      status,
      triggerType,
      data.schedule_id ?? null,
      data.execution_plan ?? null,
      startedAt,
    )

    return info.lastInsertRowid as number
  }

  static findById(id: number): GraphExecutionRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM graph_executions WHERE id = ?').get(id) as GraphExecutionRecord | undefined
    return row || null
  }

  static findByWorkflow(workflowId: number, limit = 20): GraphExecutionRecord[] {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_executions
      WHERE graph_workflow_id = ?
      ORDER BY created_date DESC, id DESC
      LIMIT ?
    `).all(workflowId, limit) as GraphExecutionRecord[]
  }

  /** Summarize workflow runtime status without loading execution rows or artifact payloads. */
  static summarizeWorkflowRuntime(workflowId: number): GraphWorkflowRuntimeExecutionSummary {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) as queued_count,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running_count,
        COALESCE(SUM(CASE WHEN status = 'queued' AND trigger_type = 'manual' THEN 1 ELSE 0 END), 0) as manual_queued_count,
        COALESCE(SUM(CASE WHEN status = 'running' AND trigger_type = 'manual' THEN 1 ELSE 0 END), 0) as manual_running_count,
        COALESCE(SUM(CASE WHEN status = 'queued' AND trigger_type = 'schedule' THEN 1 ELSE 0 END), 0) as schedule_queued_count,
        COALESCE(SUM(CASE WHEN status = 'running' AND trigger_type = 'schedule' THEN 1 ELSE 0 END), 0) as schedule_running_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_count,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_count,
        COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
        MIN(CASE WHEN status = 'queued' THEN created_date ELSE NULL END) as oldest_queued_at,
        MAX(CASE WHEN status = 'completed' THEN completed_at ELSE NULL END) as latest_completed_at,
        MAX(CASE WHEN status = 'failed' THEN completed_at ELSE NULL END) as latest_failed_at
      FROM graph_executions
      WHERE graph_workflow_id = ?
    `).get(workflowId) as Omit<GraphWorkflowRuntimeExecutionSummary, 'latest_error_message'> | undefined
    const latestFailure = db.prepare(`
      SELECT error_message
      FROM graph_executions
      WHERE graph_workflow_id = ?
        AND status = 'failed'
        AND error_message IS NOT NULL
        AND TRIM(error_message) <> ''
      ORDER BY COALESCE(completed_at, updated_date, created_date) DESC, id DESC
      LIMIT 1
    `).get(workflowId) as { error_message?: string | null } | undefined

    return {
      queued_count: Number(row?.queued_count ?? 0),
      running_count: Number(row?.running_count ?? 0),
      manual_queued_count: Number(row?.manual_queued_count ?? 0),
      manual_running_count: Number(row?.manual_running_count ?? 0),
      schedule_queued_count: Number(row?.schedule_queued_count ?? 0),
      schedule_running_count: Number(row?.schedule_running_count ?? 0),
      completed_count: Number(row?.completed_count ?? 0),
      failed_count: Number(row?.failed_count ?? 0),
      cancelled_count: Number(row?.cancelled_count ?? 0),
      oldest_queued_at: row?.oldest_queued_at ?? null,
      latest_completed_at: row?.latest_completed_at ?? null,
      latest_failed_at: row?.latest_failed_at ?? null,
      latest_error_message: latestFailure?.error_message ?? null,
    }
  }

  /** Check whether queued graph execution work exists. */
  static hasQueued(triggerType?: GraphExecutionTriggerType) {
    const db = getUserSettingsDb()
    const row = triggerType
      ? db.prepare(`
        SELECT 1 FROM graph_executions
        WHERE status = 'queued'
          AND trigger_type = ?
        LIMIT 1
      `).get(triggerType) as { 1: number } | undefined
      : db.prepare(`
        SELECT 1 FROM graph_executions
        WHERE status = 'queued'
        LIMIT 1
      `).get() as { 1: number } | undefined

    return Boolean(row)
  }

  /** Atomically claim the next queued graph execution for a trigger class. */
  static claimNextQueued(triggerType: GraphExecutionTriggerType) {
    const nextQueued = this.findQueuedByTriggerType(triggerType, 1)[0]
    return nextQueued ? this.claimQueuedById(nextQueued.id) : null
  }

  /** Read a bounded ordered slice of queued executions for dispatch planning. */
  static findQueuedByTriggerType(triggerType: GraphExecutionTriggerType, limit = 24) {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200))
    return db.prepare(`
      SELECT *
      FROM graph_executions
      WHERE status = 'queued'
        AND trigger_type = ?
      ORDER BY created_date ASC, id ASC
      LIMIT ?
    `).all(triggerType, safeLimit) as GraphExecutionRecord[]
  }

  /** Atomically claim one queued graph execution by id. */
  static claimQueuedById(executionId: number) {
    const db = getUserSettingsDb()
    const claimTransaction = db.transaction(() => {
      const row = db.prepare(`
        SELECT id
        FROM graph_executions
        WHERE status = 'queued'
          AND id = ?
        ORDER BY created_date ASC, id ASC
        LIMIT 1
      `).get(executionId) as { id: number } | undefined

      if (!row) {
        return null
      }

      const update = db.prepare(`
        UPDATE graph_executions
        SET status = 'running',
            updated_date = CURRENT_TIMESTAMP,
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = ?
          AND status = 'queued'
      `).run(row.id)

      return update.changes > 0 ? GraphExecutionModel.findById(row.id) : null
    })

    return claimTransaction()
  }

  /** Cancel queued graph executions for schedule ids without loading the whole backlog. */
  static cancelQueuedByScheduleIds(scheduleIds: number[]) {
    if (scheduleIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let cancelledCount = 0
    for (const batch of chunkSqliteValues(scheduleIds)) {
      const placeholders = sqliteInPlaceholders(batch)
      const result = db.prepare(`
        UPDATE graph_executions
        SET status = 'cancelled',
            updated_date = CURRENT_TIMESTAMP,
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE status = 'queued'
          AND schedule_id IN (${placeholders})
      `).run(...batch)
      cancelledCount += result.changes
    }
    return cancelledCount
  }

  /** Resolve queued positions for a visible execution set without hydrating the full queue. */
  static findQueuedPositions(executionIds: number[]) {
    const positions = new Map<number, number>()
    if (executionIds.length === 0) {
      return positions
    }

    const db = getUserSettingsDb()
    for (const executionId of executionIds) {
      const row = db.prepare(`
        SELECT created_date, id
        FROM graph_executions
        WHERE id = ?
          AND status = 'queued'
      `).get(executionId) as { created_date: string; id: number } | undefined

      if (!row) {
        continue
      }

      const position = db.prepare(`
        SELECT COUNT(*) as total
        FROM graph_executions
        WHERE status = 'queued'
          AND (
            created_date < ?
            OR (created_date = ? AND id <= ?)
          )
      `).get(row.created_date, row.created_date, row.id) as { total: number } | undefined
      positions.set(executionId, position?.total ?? 1)
    }

    return positions
  }

  /** List executions linked to one schedule id set, newest first. */
  static findByScheduleIds(scheduleIds: number[], limit = 200): GraphExecutionRecord[] {
    if (scheduleIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = scheduleIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM graph_executions
      WHERE schedule_id IN (${placeholders})
      ORDER BY created_date DESC, id DESC
      LIMIT ?
    `).all(...scheduleIds, limit) as GraphExecutionRecord[]
  }

  static update(id: number, data: Partial<GraphExecutionRecord>) {
    const db = getUserSettingsDb()
    const updates = filterDefined({
      ...data,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    })

    if (Object.keys(updates).length === 0) {
      return false
    }

    const { sql, values } = buildUpdateQuery('graph_executions', updates, { id })
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  static updateStatus(id: number, status: GraphExecutionStatus, errorMessage?: string | null, failedNodeId?: string | null) {
    const db = getUserSettingsDb()
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'
    const info = db.prepare(`
      UPDATE graph_executions
      SET status = ?,
          error_message = ?,
          failed_node_id = ?,
          updated_date = CURRENT_TIMESTAMP,
          started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
          completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `).run(status, errorMessage ?? null, failedNodeId ?? null, status, isTerminal ? 1 : 0, id)

    return info.changes > 0
  }
}
