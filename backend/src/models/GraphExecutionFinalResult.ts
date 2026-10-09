import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionFinalResultRecord } from '../types/moduleGraph'
import { chunkSqliteValues, compareNewestFirst, sqliteInPlaceholders } from '../utils/sqliteBatch'

let coverCache: { newestId: number; covers: Record<number, string> } | null = null

/** The library image an artifact's metadata points at (the keys the executor and older rows use). */
function readCompositeHash(metadata: string | null) {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown> | null
    for (const key of ['actualCompositeHash', 'actual_composite_hash', 'compositeHash', 'composite_hash']) {
      const value = parsed?.[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    // Not JSON: no library image.
  }
  return null
}

export class GraphExecutionFinalResultModel {
  /** List final results for an execution id set. */
  static findByExecutionIds(executionIds: number[]): GraphExecutionFinalResultRecord[] {
    if (executionIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkSqliteValues(executionIds).flatMap((batch) => {
      const placeholders = sqliteInPlaceholders(batch)
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
      `).all(...batch) as GraphExecutionFinalResultRecord[]
    })
    return records.sort(compareNewestFirst)
  }

  /** Count final-result rows by execution id without joining heavy artifact metadata. */
  static countByExecutionIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return new Map<number, number>()
    }

    const db = getUserSettingsDb()
    const rows = chunkSqliteValues(executionIds).flatMap((batch) => {
      const placeholders = sqliteInPlaceholders(batch)
      return db.prepare(`
        SELECT execution_id, COUNT(*) as count
        FROM graph_execution_final_results
        WHERE execution_id IN (${placeholders})
        GROUP BY execution_id
      `).all(...batch) as Array<{ execution_id: number; count: number }>
    })

    return new Map(rows.map((row) => [row.execution_id, row.count]))
  }

  /** List final results for every execution belonging to one workflow id set. */
  static findByWorkflowIds(workflowIds: number[]): GraphExecutionFinalResultRecord[] {
    if (workflowIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const records = chunkSqliteValues(workflowIds).flatMap((batch) => {
      const placeholders = sqliteInPlaceholders(batch)
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
        INNER JOIN graph_executions ge
          ON ge.id = fr.execution_id
        WHERE ge.graph_workflow_id IN (${placeholders})
      `).all(...batch) as GraphExecutionFinalResultRecord[]
    })
    return records.sort(compareNewestFirst)
  }

  /** Scan final results for one workflow in newest-first pages without hydrating the whole workflow. */
  static findByWorkflowIdPage(workflowId: number, limit = 1000, cursor?: { created_date: string; id: number }): GraphExecutionFinalResultRecord[] {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.floor(limit))
    const cursorClause = cursor
      ? `AND (
          fr.created_date < ?
          OR (fr.created_date = ? AND fr.id < ?)
        )`
      : ''
    const params = cursor
      ? [workflowId, cursor.created_date, cursor.created_date, cursor.id, safeLimit]
      : [workflowId, safeLimit]

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
      INNER JOIN graph_executions ge
        ON ge.id = fr.execution_id
      WHERE ge.graph_workflow_id = ?
      ${cursorClause}
      ORDER BY fr.created_date DESC, fr.id DESC
      LIMIT ?
    `).all(...params) as GraphExecutionFinalResultRecord[]
  }

  /**
   * Each workflow's newest image result that is in the library (a composite hash), keyed by workflow id: the face the
   * workflow pickers and autorun lists show. Rebuilt only when a final result was added since the last call.
   */
  static findLatestImageCovers(): Record<number, string> {
    const db = getUserSettingsDb()
    const newestId = (db.prepare('SELECT MAX(id) AS id FROM graph_execution_final_results').get() as { id: number | null }).id ?? 0
    if (coverCache && coverCache.newestId === newestId) return coverCache.covers

    // A few candidates per workflow: the newest result may be a file that never reached the library.
    const rows = db.prepare(`
      SELECT workflow_id, metadata FROM (
        SELECT ge.graph_workflow_id AS workflow_id, ga.metadata,
          ROW_NUMBER() OVER (PARTITION BY ge.graph_workflow_id ORDER BY fr.id DESC) AS rank
        FROM graph_execution_final_results fr
        INNER JOIN graph_execution_artifacts ga ON ga.id = fr.source_artifact_id
        INNER JOIN graph_executions ge ON ge.id = fr.execution_id
        WHERE fr.artifact_type = 'image'
      )
      WHERE rank <= 5
      ORDER BY workflow_id, rank
    `).all() as Array<{ workflow_id: number; metadata: string | null }>

    const covers: Record<number, string> = {}
    for (const row of rows) {
      if (covers[row.workflow_id]) continue
      const hash = readCompositeHash(row.metadata)
      if (hash) covers[row.workflow_id] = hash
    }
    coverCache = { newestId, covers }
    return covers
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
      ORDER BY fr.created_date DESC, fr.id DESC
    `).all(executionId) as GraphExecutionFinalResultRecord[]
  }

  /** Delete final-result rows that reference one source artifact id set. */
  static deleteBySourceArtifactIds(sourceArtifactIds: number[]) {
    if (sourceArtifactIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkSqliteValues(sourceArtifactIds)) {
      const placeholders = sqliteInPlaceholders(batch)
      const result = db.prepare(`DELETE FROM graph_execution_final_results WHERE source_artifact_id IN (${placeholders})`).run(...batch)
      deletedCount += result.changes
    }
    return deletedCount
  }
}
