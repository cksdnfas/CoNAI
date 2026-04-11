import { getUserSettingsDb } from '../database/userSettingsDb'
import {
  GraphWorkflowScheduleCreateData,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleUpdateData,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyInputValues(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) {
    return undefined
  }

  return value === null ? null : JSON.stringify(value)
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
        interval_minutes, daily_time, max_run_count, input_values,
        confirmed_graph_version, confirmed_input_signature,
        stop_reason_code, stop_reason_message,
        last_execution_id, next_run_at, last_enqueued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      stringifyInputValues(data.input_values) ?? null,
      data.confirmed_graph_version ?? null,
      data.confirmed_input_signature ?? null,
      data.stop_reason_code ?? null,
      data.stop_reason_message ?? null,
      data.last_execution_id ?? null,
      data.next_run_at ?? null,
      data.last_enqueued_at ?? null,
    )

    return info.lastInsertRowid as number
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
