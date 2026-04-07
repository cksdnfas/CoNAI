import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionRecord, GraphExecutionStatus } from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

export class GraphExecutionModel {
  /** Delete a specific execution id set. */
  static deleteByIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    const placeholders = executionIds.map(() => '?').join(', ')
    const result = db.prepare(`DELETE FROM graph_executions WHERE id IN (${placeholders})`).run(...executionIds)
    return result.changes
  }

  /** Find executions for a specific id set. */
  static findByIds(executionIds: number[]): GraphExecutionRecord[] {
    if (executionIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = executionIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT * FROM graph_executions
      WHERE id IN (${placeholders})
      ORDER BY created_date DESC, id DESC
    `).all(...executionIds) as GraphExecutionRecord[]
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

  static create(data: {
    graph_workflow_id: number
    graph_version: number
    status?: GraphExecutionStatus
    execution_plan?: string | null
    started_at?: string | null
  }): number {
    const db = getUserSettingsDb()
    const status = data.status ?? 'running'
    const startedAt = data.started_at !== undefined
      ? data.started_at
      : status === 'running'
        ? new Date().toISOString()
        : null

    const info = db.prepare(`
      INSERT INTO graph_executions (
        graph_workflow_id, graph_version, status, execution_plan, started_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      data.graph_workflow_id,
      data.graph_version,
      status,
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
      ORDER BY created_date DESC
      LIMIT ?
    `).all(workflowId, limit) as GraphExecutionRecord[]
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
