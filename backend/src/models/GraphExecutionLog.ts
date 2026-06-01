import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionLogLevel, GraphExecutionLogRecord } from '../types/moduleGraph'

const SQLITE_BIND_BATCH_SIZE = 500

function chunkIds(ids: number[], chunkSize = SQLITE_BIND_BATCH_SIZE) {
  const chunks: number[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

export class GraphExecutionLogModel {
  /** Delete execution logs for a specific execution id set. */
  static deleteByExecutionIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkIds(executionIds)) {
      const placeholders = batch.map(() => '?').join(', ')
      const result = db.prepare(`DELETE FROM graph_execution_logs WHERE execution_id IN (${placeholders})`).run(...batch)
      deletedCount += result.changes
    }
    return deletedCount
  }

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
