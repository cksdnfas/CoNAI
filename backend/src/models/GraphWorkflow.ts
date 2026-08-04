import { getUserSettingsDb } from '../database/userSettingsDb'
import {
  GraphWorkflowRecord,
  GraphWorkflowCreateData,
  GraphWorkflowNameRecord,
  GraphWorkflowSummaryRecord,
  GraphWorkflowUpdateData,
  GraphWorkflowVersionSummaryRecord,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

const MAX_VERSION_SNAPSHOTS_PER_WORKFLOW = 50

/**
 * Summary projection columns for saved workflow lists (WF-1).
 *
 * `graph_json` 은 절대 선택하지 않는다. 노드/엣지 개수는 SQLite JSON1 이 C 레벨에서 세므로
 * 요청 경로에서 멀티 MB JSON.parse 가 발생하지 않는다. 손상된 행이 라우트를 500 으로 떨어뜨리지
 * 않도록 `json_valid` 로 감싼다.
 */
const GRAPH_WORKFLOW_SUMMARY_COLUMNS = `
      id,
      name,
      description,
      folder_id,
      version,
      is_active,
      created_date,
      updated_date,
      CASE WHEN json_valid(graph_json) THEN COALESCE(json_array_length(graph_json, '$.nodes'), 0) ELSE 0 END AS node_count,
      CASE WHEN json_valid(graph_json) THEN COALESCE(json_array_length(graph_json, '$.edges'), 0) ELSE 0 END AS edge_count`

/** Version snapshot summary columns computed in SQL instead of double `JSON.parse` per row (WF-5). */
const GRAPH_WORKFLOW_VERSION_SUMMARY_COLUMNS = `
      id,
      workflow_id,
      version,
      changelog,
      created_date,
      CASE WHEN json_valid(graph_json) THEN COALESCE(json_array_length(graph_json, '$.nodes'), 0) ELSE 0 END AS node_count,
      CASE WHEN json_valid(graph_json) THEN COALESCE(json_array_length(graph_json, '$.edges'), 0) ELSE 0 END AS edge_count,
      CASE WHEN json_valid(graph_json) THEN COALESCE(json_array_length(graph_json, '$.metadata.exposed_inputs'), 0) ELSE 0 END AS exposed_input_count,
      CASE WHEN json_valid(graph_json) AND json_extract(graph_json, '$.metadata.debug_mode') IN (1, 'true') THEN 1 ELSE 0 END AS debug_mode`

/**
 * Module ids that mark an explicit final-result node.
 * 프론트 `isFinalResultModule` (engine_type='system' + operation_key='system.final_result') 과 같은 의미다.
 */
const FINAL_RESULT_MODULE_ID_SUBQUERY = `
      SELECT id FROM module_definitions
      WHERE engine_type = 'system'
        AND (
          (json_valid(internal_fixed_values) AND json_extract(internal_fixed_values, '$.operation_key') = 'system.final_result')
          OR (
            (internal_fixed_values IS NULL OR NOT json_valid(internal_fixed_values) OR json_extract(internal_fixed_values, '$.operation_key') IS NULL)
            AND json_valid(template_defaults)
            AND json_extract(template_defaults, '$.operation_key') = 'system.final_result'
          )
        )`

type GraphWorkflowVersionSummaryRow = {
  id: number
  workflow_id: number
  version: number
  changelog: string | null
  created_date: string
  node_count: number
  edge_count: number
  exposed_input_count: number
  debug_mode: number
}

// 그래프에서 파생된 캐시(예: 예약 실행 레인)가 저장 편집을 놓치지 않도록 쓰기마다 올리는 리비전 값.
let graphWorkflowRevision = 0

/** Revision counter that changes whenever a stored graph workflow row is written. */
export function getGraphWorkflowRevision() {
  return graphWorkflowRevision
}

function stringifyGraph(value: unknown) {
  return JSON.stringify(value ?? { nodes: [], edges: [] })
}

/**
 * Turn one SQL-computed snapshot row into the response summary.
 * 카운트는 이미 SQL 이 계산했으므로 여기서는 이전 스냅샷과의 델타만 뺀다(WF-5).
 */
function summarizeVersionRow(
  row: GraphWorkflowVersionSummaryRow,
  previousRow?: GraphWorkflowVersionSummaryRow,
): GraphWorkflowVersionSummaryRecord {
  const nodeCount = row.node_count
  const edgeCount = row.edge_count
  const exposedInputCount = row.exposed_input_count
  const previousNodeCount = previousRow?.node_count ?? 0
  const previousEdgeCount = previousRow?.edge_count ?? 0
  const previousExposedInputCount = previousRow?.exposed_input_count ?? 0
  const previousRecord = previousRow

  return {
    id: row.id,
    workflow_id: row.workflow_id,
    version: row.version,
    changelog: row.changelog,
    created_date: row.created_date,
    node_count: nodeCount,
    edge_count: edgeCount,
    exposed_input_count: exposedInputCount,
    debug_mode: row.debug_mode === 1,
    previous_version: previousRecord?.version ?? null,
    node_delta: previousRecord ? nodeCount - previousNodeCount : 0,
    edge_delta: previousRecord ? edgeCount - previousEdgeCount : 0,
    exposed_input_delta: previousRecord ? exposedInputCount - previousExposedInputCount : 0,
  }
}

export class GraphWorkflowModel {
  /** List workflows that belong to any folder within the provided folder id set. */
  static findByFolderIds(folderIds: number[], activeOnly = false): GraphWorkflowRecord[] {
    if (folderIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = folderIds.map(() => '?').join(', ')
    const params: Array<number> = [...folderIds]
    let query = `SELECT * FROM graph_workflows WHERE folder_id IN (${placeholders})`
    if (activeOnly) {
      query += ' AND is_active = 1'
    }
    query += ' ORDER BY updated_date DESC, id DESC'

    return db.prepare(query).all(...params) as GraphWorkflowRecord[]
  }

  static create(workflowData: GraphWorkflowCreateData): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_workflows (
        name, description, graph_json, folder_id, version, is_active
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      workflowData.name,
      workflowData.description || null,
      stringifyGraph(workflowData.graph),
      workflowData.folder_id ?? null,
      workflowData.version ?? 1,
      workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : 1,
    )

    const workflowId = info.lastInsertRowid as number
    graphWorkflowRevision += 1
    this.createVersionSnapshot(workflowId, workflowData.version ?? 1, workflowData.graph, 'Initial version')
    return workflowId
  }

  static findById(id: number): GraphWorkflowRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM graph_workflows WHERE id = ?').get(id) as GraphWorkflowRecord | undefined
    return row || null
  }

  static findAll(activeOnly = false): GraphWorkflowRecord[] {
    const db = getUserSettingsDb()
    let query = 'SELECT * FROM graph_workflows'
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    query += ' ORDER BY updated_date DESC, id DESC'

    return db.prepare(query).all() as GraphWorkflowRecord[]
  }

  static findVersionSummaries(workflowId: number, limit = 12): GraphWorkflowVersionSummaryRecord[] {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50))
    const records = db.prepare(`
      SELECT ${GRAPH_WORKFLOW_VERSION_SUMMARY_COLUMNS}
      FROM graph_workflow_versions
      WHERE workflow_id = ?
      ORDER BY version DESC, id DESC
      LIMIT ?
    `).all(workflowId, safeLimit + 1) as GraphWorkflowVersionSummaryRow[]

    return records
      .slice(0, safeLimit)
      .map((record, index) => summarizeVersionRow(record, records[index + 1]))
  }

  /**
   * List saved workflows as list summaries (no graph document).
   * WF-1 수용 기준 ①: 44개 기준 목록 응답 < 50KB.
   */
  static findAllSummaries(activeOnly = false): GraphWorkflowSummaryRecord[] {
    const db = getUserSettingsDb()
    let query = `SELECT ${GRAPH_WORKFLOW_SUMMARY_COLUMNS} FROM graph_workflows`
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    query += ' ORDER BY updated_date DESC, id DESC'

    const rows = db.prepare(query).all() as GraphWorkflowSummaryRecord[]
    return this.withFinalResultNodeCounts(rows)
  }

  /** List folder-scoped saved workflows as list summaries (no graph document). */
  static findSummariesByFolderIds(folderIds: number[], activeOnly = false): GraphWorkflowSummaryRecord[] {
    if (folderIds.length === 0) {
      return []
    }

    const db = getUserSettingsDb()
    const placeholders = folderIds.map(() => '?').join(', ')
    let query = `SELECT ${GRAPH_WORKFLOW_SUMMARY_COLUMNS} FROM graph_workflows WHERE folder_id IN (${placeholders})`
    if (activeOnly) {
      query += ' AND is_active = 1'
    }
    query += ' ORDER BY updated_date DESC, id DESC'

    const rows = db.prepare(query).all(...folderIds) as GraphWorkflowSummaryRecord[]
    return this.withFinalResultNodeCounts(rows)
  }

  /** List `{ id, name }` entries only, for reservation/header label maps (WF-2). */
  static findNameEntries(activeOnly = false): GraphWorkflowNameRecord[] {
    const db = getUserSettingsDb()
    let query = 'SELECT id, name FROM graph_workflows'
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    query += ' ORDER BY updated_date DESC, id DESC'

    return db.prepare(query).all() as GraphWorkflowNameRecord[]
  }

  /**
   * Count explicit final-result nodes per workflow without leaving SQLite.
   * `json_each` 는 C 레벨 파서라 40여 개 그래프 전체를 훑어도 1ms 미만이다.
   */
  static countFinalResultNodesByWorkflowIds(workflowIds: number[]): Map<number, number> {
    const counts = new Map<number, number>()
    if (workflowIds.length === 0) {
      return counts
    }

    const db = getUserSettingsDb()
    const placeholders = workflowIds.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT w.id AS workflow_id, COUNT(*) AS final_result_node_count
      FROM graph_workflows w, json_each(CASE WHEN json_valid(w.graph_json) THEN w.graph_json ELSE '{}' END, '$.nodes') node
      WHERE w.id IN (${placeholders})
        AND CAST(json_extract(node.value, '$.module_id') AS INTEGER) IN (${FINAL_RESULT_MODULE_ID_SUBQUERY})
      GROUP BY w.id
    `).all(...workflowIds) as Array<{ workflow_id: number; final_result_node_count: number }>

    for (const row of rows) {
      counts.set(row.workflow_id, row.final_result_node_count)
    }

    return counts
  }

  private static withFinalResultNodeCounts(rows: GraphWorkflowSummaryRecord[]): GraphWorkflowSummaryRecord[] {
    const counts = this.countFinalResultNodesByWorkflowIds(rows.map((row) => row.id))
    return rows.map((row) => ({ ...row, final_result_node_count: counts.get(row.id) ?? 0 }))
  }

  static update(id: number, workflowData: GraphWorkflowUpdateData): { updated: boolean; versionChanged: boolean } {
    const db = getUserSettingsDb()
    const current = this.findById(id)
    if (!current) {
      return { updated: false, versionChanged: false }
    }

    // Byte-identical graph saves (editor auto-saves) must not bump the version or write a snapshot,
    // otherwise partial-run reuse caches are invalidated and schedules get paused for review.
    const incomingGraphJson = workflowData.graph !== undefined ? stringifyGraph(workflowData.graph) : undefined
    const graphChanged = incomingGraphJson !== undefined && incomingGraphJson !== current.graph_json

    const cleanData: Record<string, unknown> = {
      name: workflowData.name,
      description: workflowData.description,
      version: workflowData.version,
      graph_json: graphChanged ? incomingGraphJson : undefined,
      folder_id: workflowData.folder_id,
      is_active: workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : undefined,
    }

    const updates = filterDefined(cleanData)
    if (Object.keys(updates).length === 0) {
      return { updated: false, versionChanged: false }
    }

    const nextVersion = graphChanged ? (workflowData.version ?? current.version + 1) : (workflowData.version ?? current.version)
    const finalUpdates = {
      ...updates,
      version: nextVersion,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    }

    const { sql, values } = buildUpdateQuery('graph_workflows', finalUpdates, { id })
    const info = db.prepare(sql).run(...values)
    const updated = info.changes > 0
    if (updated) {
      graphWorkflowRevision += 1
    }

    if (updated && graphChanged && workflowData.graph !== undefined) {
      this.createVersionSnapshot(id, nextVersion, workflowData.graph, 'Workflow updated')
    }

    return { updated, versionChanged: updated && nextVersion !== current.version }
  }

  static delete(id: number): boolean {
    const db = getUserSettingsDb()
    const info = db.prepare('DELETE FROM graph_workflows WHERE id = ?').run(id)
    const deleted = info.changes > 0
    if (deleted) {
      graphWorkflowRevision += 1
    }
    return deleted
  }

  static createVersionSnapshot(workflowId: number, version: number, graph: unknown, changelog?: string) {
    const db = getUserSettingsDb()
    db.prepare(`
      INSERT OR REPLACE INTO graph_workflow_versions (
        workflow_id, version, graph_json, changelog
      ) VALUES (?, ?, ?, ?)
    `).run(
      workflowId,
      version,
      stringifyGraph(graph),
      changelog || null,
    )

    db.prepare(`
      DELETE FROM graph_workflow_versions
      WHERE workflow_id = ?
        AND id NOT IN (
          SELECT id FROM graph_workflow_versions
          WHERE workflow_id = ?
          ORDER BY version DESC, id DESC
          LIMIT ?
        )
    `).run(workflowId, workflowId, MAX_VERSION_SNAPSHOTS_PER_WORKFLOW)
  }
}
