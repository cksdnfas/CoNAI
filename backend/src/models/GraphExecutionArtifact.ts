import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionArtifactRecord } from '../types/moduleGraph'

export class GraphExecutionArtifactModel {
  static create(data: {
    execution_id: number
    node_id: string
    port_key: string
    artifact_type: GraphExecutionArtifactRecord['artifact_type']
    storage_path?: string | null
    metadata?: string | null
  }): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_execution_artifacts (
        execution_id, node_id, port_key, artifact_type, storage_path, metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.execution_id,
      data.node_id,
      data.port_key,
      data.artifact_type,
      data.storage_path ?? null,
      data.metadata ?? null,
    )

    return info.lastInsertRowid as number
  }

  static findByExecution(executionId: number): GraphExecutionArtifactRecord[] {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM graph_execution_artifacts
      WHERE execution_id = ?
      ORDER BY id ASC
    `).all(executionId) as GraphExecutionArtifactRecord[]
  }
}
