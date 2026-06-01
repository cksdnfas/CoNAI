import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionArtifactRecord } from '../types/moduleGraph'

const SQLITE_BIND_BATCH_SIZE = 500

function chunkIds(ids: number[], chunkSize = SQLITE_BIND_BATCH_SIZE) {
  const chunks: number[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

export class GraphExecutionArtifactModel {
  /** Find artifacts for a specific id set. */
  static findByIds(artifactIds: number[]): GraphExecutionArtifactRecord[] {
    if (artifactIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkIds(artifactIds).flatMap((batch) => {
      const placeholders = batch.map(() => '?').join(', ')
      return db.prepare(`
        SELECT * FROM graph_execution_artifacts
        WHERE id IN (${placeholders})
      `).all(...batch) as GraphExecutionArtifactRecord[]
    })
    return records.sort((left, right) => {
      const dateOrder = String(right.created_date ?? '').localeCompare(String(left.created_date ?? ''))
      return dateOrder !== 0 ? dateOrder : right.id - left.id
    })
  }

  /** List artifacts for an execution id set. */
  static findByExecutionIds(executionIds: number[]): GraphExecutionArtifactRecord[] {
    if (executionIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkIds(executionIds).flatMap((batch) => {
      const placeholders = batch.map(() => '?').join(', ')
      return db.prepare(`
        SELECT * FROM graph_execution_artifacts
        WHERE execution_id IN (${placeholders})
      `).all(...batch) as GraphExecutionArtifactRecord[]
    })
    return records.sort((left, right) => {
      const dateOrder = String(right.created_date ?? '').localeCompare(String(left.created_date ?? ''))
      return dateOrder !== 0 ? dateOrder : right.id - left.id
    })
  }

  /** Count artifacts by execution id without loading heavy metadata payloads. */
  static countByExecutionIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return new Map<number, number>()
    }

    const db = getUserSettingsDb()
    const rows = chunkIds(executionIds).flatMap((batch) => {
      const placeholders = batch.map(() => '?').join(', ')
      return db.prepare(`
        SELECT execution_id, COUNT(*) as count
        FROM graph_execution_artifacts
        WHERE execution_id IN (${placeholders})
        GROUP BY execution_id
      `).all(...batch) as Array<{ execution_id: number; count: number }>
    })

    return new Map(rows.map((row) => [row.execution_id, row.count]))
  }

  /** List artifacts for every execution belonging to one workflow id set. */
  static findByWorkflowIds(workflowIds: number[]): GraphExecutionArtifactRecord[] {
    if (workflowIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkIds(workflowIds).flatMap((batch) => {
      const placeholders = batch.map(() => '?').join(', ')
      return db.prepare(`
        SELECT ga.*
        FROM graph_execution_artifacts ga
        INNER JOIN graph_executions ge
          ON ge.id = ga.execution_id
        WHERE ge.graph_workflow_id IN (${placeholders})
      `).all(...batch) as GraphExecutionArtifactRecord[]
    })
    return records.sort((left, right) => {
      const dateOrder = String(right.created_date ?? '').localeCompare(String(left.created_date ?? ''))
      return dateOrder !== 0 ? dateOrder : right.id - left.id
    })
  }

  /** Scan artifacts for one workflow in newest-first pages without hydrating the whole workflow. */
  static findByWorkflowIdPage(workflowId: number, limit = 1000, cursor?: { created_date: string; id: number }): GraphExecutionArtifactRecord[] {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.floor(limit))
    const cursorClause = cursor
      ? `AND (
          ga.created_date < ?
          OR (ga.created_date = ? AND ga.id < ?)
        )`
      : ''
    const params = cursor
      ? [workflowId, cursor.created_date, cursor.created_date, cursor.id, safeLimit]
      : [workflowId, safeLimit]

    return db.prepare(`
      SELECT ga.*
      FROM graph_execution_artifacts ga
      INNER JOIN graph_executions ge
        ON ge.id = ga.execution_id
      WHERE ge.graph_workflow_id = ?
      ${cursorClause}
      ORDER BY ga.created_date DESC, ga.id DESC
      LIMIT ?
    `).all(...params) as GraphExecutionArtifactRecord[]
  }

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
      ORDER BY created_date DESC, id DESC
    `).all(executionId) as GraphExecutionArtifactRecord[]
  }

  /** Delete artifacts for a specific id set. */
  static deleteByIds(artifactIds: number[]) {
    if (artifactIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkIds(artifactIds)) {
      const placeholders = batch.map(() => '?').join(', ')
      const result = db.prepare(`DELETE FROM graph_execution_artifacts WHERE id IN (${placeholders})`).run(...batch)
      deletedCount += result.changes
    }
    return deletedCount
  }
}
