import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionLogLevel, GraphExecutionLogRecord } from '../types/moduleGraph'

export class GraphExecutionLogModel {
  static create(data: {
    execution_id: number
    node_id?: string | null
    level?: GraphExecutionLogLevel
    event_type: string
    message: string
    details?: string | null
  }): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_execution_logs (
        execution_id, node_id, level, event_type, message, details
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.execution_id,
      data.node_id ?? null,
      data.level ?? 'info',
      data.event_type,
      data.message,
      data.details ?? null,
    )

    return info.lastInsertRowid as number
  }

  static findByExecution(executionId: number): GraphExecutionLogRecord[] {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_execution_logs
      WHERE execution_id = ?
      ORDER BY id ASC
    `).all(executionId) as GraphExecutionLogRecord[]
  }
}
