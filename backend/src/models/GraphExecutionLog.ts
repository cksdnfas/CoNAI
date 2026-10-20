import { getUserSettingsDb } from '../database/userSettingsDb'
import { publishGraphExecutionProgressEvent } from '../services/runtime-events/runtimeEventPublishers'
import { GraphExecutionLogLevel, GraphExecutionLogRecord } from '../types/moduleGraph'
import { chunkSqliteValues, sqliteInPlaceholders } from '../utils/sqliteBatch'

/** Log events read by `findNodeProgress`; writing one tells open progress cards to refetch. */
const NODE_PROGRESS_EVENT_TYPES = new Set(['node_engine_start', 'node_engine_complete', 'node_failure'])
/** Node events of one execution coalesce into one hint per window so long or looping runs do not flood the replay buffer. */
const PROGRESS_EVENT_WINDOW_MS = 500
const pendingProgressExecutionIds = new Set<number>()
let progressFlushTimer: NodeJS.Timeout | null = null

function queueProgressEvent(executionId: number) {
  pendingProgressExecutionIds.add(executionId)
  if (progressFlushTimer) return
  progressFlushTimer = setTimeout(() => {
    progressFlushTimer = null
    const executionIds = [...pendingProgressExecutionIds]
    pendingProgressExecutionIds.clear()
    for (const execution_id of executionIds) publishGraphExecutionProgressEvent({ execution_id })
  }, PROGRESS_EVENT_WINDOW_MS)
  progressFlushTimer.unref()
}

export class GraphExecutionLogModel {
  /** Only the event flags used by node progress; log messages and payloads stay in the detail view. */
  static findNodeProgress(executionId: number): Array<{ node_id: string; event_type: string }> {
    return getUserSettingsDb().prepare(`
      SELECT DISTINCT node_id, event_type FROM graph_execution_logs
      WHERE execution_id = ? AND node_id IS NOT NULL
        AND event_type IN ('node_engine_start', 'node_engine_complete', 'node_failure')
    `).all(executionId) as Array<{ node_id: string; event_type: string }>
  }

  /** Delete execution logs for a specific execution id set. */
  static deleteByExecutionIds(executionIds: number[]) {
    if (executionIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    let deletedCount = 0
    for (const batch of chunkSqliteValues(executionIds)) {
      const placeholders = sqliteInPlaceholders(batch)
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

    if (data.node_id && NODE_PROGRESS_EVENT_TYPES.has(data.event_type)) {
      queueProgressEvent(data.execution_id)
    }
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
