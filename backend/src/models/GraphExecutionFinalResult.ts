import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionFinalResultRecord } from '../types/moduleGraph'

export class GraphExecutionFinalResultModel {
  /** List final results for an execution id set. */
  static findByExecutionIds(executionIds: number[]): GraphExecutionFinalResultRecord[] {
    if (executionIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = executionIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT
        fr.id,
        fr.execution_id,
        fr.final_node_id,
        fr.source_artifact_id,
        ga.execution_id AS source_execution_id,
        fr.source_node_id,
        fr.source_port_key,
        fr.artifact_type,
        ga.storage_path AS source_storage_path,
        ga.metadata AS source_metadata,
        fr.created_date
      FROM graph_execution_final_results fr
      INNER JOIN graph_execution_artifacts ga
        ON ga.id = fr.source_artifact_id
      WHERE fr.execution_id IN (${placeholders})
      ORDER BY fr.created_date DESC, fr.id DESC
    `).all(...executionIds) as GraphExecutionFinalResultRecord[]
  }

  static create(data: {
    execution_id: number
    final_node_id: string
    source_artifact_id: number
    source_node_id: string
    source_port_key: string
    artifact_type: GraphExecutionFinalResultRecord['artifact_type']
  }): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_execution_final_results (
        execution_id, final_node_id, source_artifact_id, source_node_id, source_port_key, artifact_type
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.execution_id,
      data.final_node_id,
      data.source_artifact_id,
      data.source_node_id,
      data.source_port_key,
      data.artifact_type,
    )

    return info.lastInsertRowid as number
  }

  static findByExecution(executionId: number): GraphExecutionFinalResultRecord[] {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT
        fr.id,
        fr.execution_id,
        fr.final_node_id,
        fr.source_artifact_id,
        ga.execution_id AS source_execution_id,
        fr.source_node_id,
        fr.source_port_key,
        fr.artifact_type,
        ga.storage_path AS source_storage_path,
        ga.metadata AS source_metadata,
        fr.created_date
      FROM graph_execution_final_results fr
      INNER JOIN graph_execution_artifacts ga
        ON ga.id = fr.source_artifact_id
      WHERE fr.execution_id = ?
      ORDER BY fr.id ASC
    `).all(executionId) as GraphExecutionFinalResultRecord[]
  }

  /** Delete final-result rows that reference one source artifact id set. */
  static deleteBySourceArtifactIds(sourceArtifactIds: number[]) {
    if (sourceArtifactIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    const placeholders = sourceArtifactIds.map(() => '?').join(', ')
    const result = db.prepare(`DELETE FROM graph_execution_final_results WHERE source_artifact_id IN (${placeholders})`).run(...sourceArtifactIds)
    return result.changes
  }
}
