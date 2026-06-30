import { getUserSettingsDb } from '../database/userSettingsDb'
import type { GraphExecutionNodeIoRecord } from '../types/moduleGraph'
import { chunkSqliteValues, sqliteInPlaceholders } from '../utils/sqliteBatch'

export class GraphExecutionNodeIoModel {
  static replaceForExecution(executionId: number, rows: Array<{
    node_id: string
    direction: GraphExecutionNodeIoRecord['direction']
    port_key: string
    source_node_id?: string | null
    source_port_key?: string | null
    output_index?: number
    artifact_type?: GraphExecutionNodeIoRecord['artifact_type']
    ref_kind?: string | null
    ref_value?: string | null
    summary?: string | null
  }>) {
    const db = getUserSettingsDb()
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM graph_execution_node_io WHERE execution_id = ?').run(executionId)
      if (rows.length === 0) {
        return
      }

      const statement = db.prepare(`
        INSERT INTO graph_execution_node_io (
          execution_id,
          node_id,
          direction,
          port_key,
          source_node_id,
          source_port_key,
          output_index,
          artifact_type,
          ref_kind,
          ref_value,
          summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const row of rows) {
        statement.run(
          executionId,
          row.node_id,
          row.direction,
          row.port_key,
          row.source_node_id ?? null,
          row.source_port_key ?? null,
          row.output_index ?? 1,
          row.artifact_type ?? null,
          row.ref_kind ?? null,
          row.ref_value ?? null,
          row.summary ?? null,
        )
      }
    })

    transaction()
  }

  static findByExecution(executionId: number): GraphExecutionNodeIoRecord[] {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT *
      FROM graph_execution_node_io
      WHERE execution_id = ?
      ORDER BY id ASC
    `).all(executionId) as GraphExecutionNodeIoRecord[]
  }

  static deleteByExecutionIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkSqliteValues(executionIds)) {
      const placeholders = sqliteInPlaceholders(batch)
      const result = db.prepare(`DELETE FROM graph_execution_node_io WHERE execution_id IN (${placeholders})`).run(...batch)
      deletedCount += result.changes
    }
    return deletedCount
  }
}
