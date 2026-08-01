import { getUserSettingsDb } from '../database/userSettingsDb'
import {
  GraphWorkflowScheduleCreateData,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleUpdateData,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'
import { publishGraphScheduleEvent } from '../services/runtime-events/runtimeEventPublishers'

/**
 * Publish one schedule change event for the stored row.
 *
 * 스케줄 쓰기 호출부가 서비스/라우트 11곳에 흩어져 있어 모델 레이어에서 발행한다.
 */
function publishScheduleChangedById(id: number) {
  try {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT id, graph_workflow_id, status, next_run_at, last_execution_id, stop_reason_code
      FROM graph_workflow_schedules
      WHERE id = ?
    `).get(id) as {
      id: number
      graph_workflow_id: number
      status: string
      next_run_at: string | null
      last_execution_id: number | null
      stop_reason_code: string | null
    } | undefined

    if (!row) {
      return
    }

    publishGraphScheduleEvent({
      schedule_id: row.id,
      graph_workflow_id: row.graph_workflow_id,
      status: row.status,
      next_run_at: row.next_run_at ?? null,
      last_execution_id: row.last_execution_id ?? null,
      stop_reason_code: row.stop_reason_code ?? null,
    })
  } catch (error) {
    console.warn(`⚠️ Failed to publish workflow schedule event for schedule ${id}:`, error instanceof Error ? error.message : error)
  }
}

function stringifyInputValues(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) {
    return undefined
  }

  return value === null ? null : JSON.stringify(value)
}

export type GraphWorkflowScheduleRuntimePolicySummary = {
  schedule_count: number
  active_schedule_count: number
  stop_on_failure_count: number
  continue_on_failure_count: number
  paused_for_review_count: number
  stopped_after_error_count: number
  overlap_stopped_count: number
}

export class GraphWorkflowScheduleModel {
  /** List all schedules, newest next-run first. */
  static findAll() {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_workflow_schedules
      ORDER BY COALESCE(next_run_at, created_date) ASC, id ASC
    `).all() as GraphWorkflowScheduleRecord[]
  }

  /** List schedules that belong to one workflow. */
  static findByWorkflowId(workflowId: number) {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_workflow_schedules
      WHERE graph_workflow_id = ?
      ORDER BY COALESCE(next_run_at, created_date) ASC, id ASC
    `).all(workflowId) as GraphWorkflowScheduleRecord[]
  }

  /** Summarize autorun retry and stop policy state for a workflow runtime health card. */
  static summarizeRuntimePolicyByWorkflowId(workflowId: number): GraphWorkflowScheduleRuntimePolicySummary {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT
        COUNT(*) as schedule_count,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_schedule_count,
        COALESCE(SUM(CASE WHEN COALESCE(failure_policy, 'stop') = 'stop' THEN 1 ELSE 0 END), 0) as stop_on_failure_count,
        COALESCE(SUM(CASE WHEN failure_policy = 'continue' THEN 1 ELSE 0 END), 0) as continue_on_failure_count,
        COALESCE(SUM(CASE WHEN stop_reason_code = 'workflow_changed' THEN 1 ELSE 0 END), 0) as paused_for_review_count,
        COALESCE(SUM(CASE WHEN status = 'error_stopped' THEN 1 ELSE 0 END), 0) as stopped_after_error_count,
        COALESCE(SUM(CASE WHEN status = 'overlap_stopped' THEN 1 ELSE 0 END), 0) as overlap_stopped_count
      FROM graph_workflow_schedules
      WHERE graph_workflow_id = ?
    `).get(workflowId) as GraphWorkflowScheduleRuntimePolicySummary | undefined

    return {
      schedule_count: Number(row?.schedule_count ?? 0),
      active_schedule_count: Number(row?.active_schedule_count ?? 0),
      stop_on_failure_count: Number(row?.stop_on_failure_count ?? 0),
      continue_on_failure_count: Number(row?.continue_on_failure_count ?? 0),
      paused_for_review_count: Number(row?.paused_for_review_count ?? 0),
      stopped_after_error_count: Number(row?.stopped_after_error_count ?? 0),
      overlap_stopped_count: Number(row?.overlap_stopped_count ?? 0),
    }
  }

  /** List schedules that belong to any workflow in one id set. */
  static findByWorkflowIds(workflowIds: number[]) {
    if (workflowIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = workflowIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM graph_workflow_schedules
      WHERE graph_workflow_id IN (${placeholders})
      ORDER BY COALESCE(next_run_at, created_date) ASC, id ASC
    `).all(...workflowIds) as GraphWorkflowScheduleRecord[]
  }

  /** Find one schedule by id. */
  static findById(id: number) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM graph_workflow_schedules WHERE id = ?').get(id) as GraphWorkflowScheduleRecord | undefined
    return row ?? null
  }

  /** List active schedules whose next run time is due. */
  static findDueSchedules(nowIso: string) {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_workflow_schedules
      WHERE status = 'active'
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC, id ASC
    `).all(nowIso) as GraphWorkflowScheduleRecord[]
  }

  /** Create one persisted workflow schedule. */
  static create(data: GraphWorkflowScheduleCreateData) {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_workflow_schedules (
        graph_workflow_id, name, schedule_type, status, timezone, run_at,
        interval_minutes, daily_time, max_run_count, run_enqueue_count, failure_policy, input_values,
        confirmed_graph_version, confirmed_input_signature,
        stop_reason_code, stop_reason_message,
        last_execution_id, next_run_at, last_enqueued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.graph_workflow_id,
      data.name,
      data.schedule_type,
      data.status ?? 'paused',
      data.timezone ?? null,
      data.run_at ?? null,
      data.interval_minutes ?? null,
      data.daily_time ?? null,
      data.max_run_count ?? null,
      data.run_enqueue_count ?? 1,
      data.failure_policy ?? 'stop',
      stringifyInputValues(data.input_values) ?? null,
      data.confirmed_graph_version ?? null,
      data.confirmed_input_signature ?? null,
      data.stop_reason_code ?? null,
      data.stop_reason_message ?? null,
      data.last_execution_id ?? null,
      data.next_run_at ?? null,
      data.last_enqueued_at ?? null,
    )

    const scheduleId = info.lastInsertRowid as number
    // E15: 신규 예약
    publishScheduleChangedById(scheduleId)
    return scheduleId
  }

  /** Update one schedule row. */
  static update(id: number, data: GraphWorkflowScheduleUpdateData) {
    const db = getUserSettingsDb()
    const updates = filterDefined({
      ...data,
      input_values: stringifyInputValues(data.input_values),
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    })

    if (Object.keys(updates).length === 0) {
      return false
    }

    const { sql, values } = buildUpdateQuery('graph_workflow_schedules', updates, { id })
    const info = db.prepare(sql).run(...values)
    if (info.changes > 0) {
      // E14: status / next_run_at / stop_reason 변경
      publishScheduleChangedById(id)
    }

    return info.changes > 0
  }

  /** Delete one schedule row. */
  static delete(id: number) {
    const db = getUserSettingsDb()
    const info = db.prepare('DELETE FROM graph_workflow_schedules WHERE id = ?').run(id)
    return info.changes > 0
  }

  /** Delete every schedule that belongs to one workflow id set. */
  static deleteByWorkflowIds(workflowIds: number[]) {
    if (workflowIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    const placeholders = workflowIds.map(() => '?').join(', ')
    const info = db.prepare(`DELETE FROM graph_workflow_schedules WHERE graph_workflow_id IN (${placeholders})`).run(...workflowIds)
    return info.changes
  }
}
