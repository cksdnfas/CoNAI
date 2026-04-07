import { getUserSettingsDb } from '../database/userSettingsDb'
import {
  GraphWorkflowRecord,
  GraphWorkflowCreateData,
  GraphWorkflowUpdateData,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyGraph(value: unknown) {
  return JSON.stringify(value ?? { nodes: [], edges: [] })
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

  static update(id: number, workflowData: GraphWorkflowUpdateData): boolean {
    const db = getUserSettingsDb()
    const current = this.findById(id)
    if (!current) {
      return false
    }

    const cleanData: Record<string, unknown> = {
      name: workflowData.name,
      description: workflowData.description,
      version: workflowData.version,
      graph_json: workflowData.graph !== undefined ? stringifyGraph(workflowData.graph) : undefined,
      folder_id: workflowData.folder_id,
      is_active: workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : undefined,
    }

    const updates = filterDefined(cleanData)
    if (Object.keys(updates).length === 0) {
      return false
    }

    const nextVersion = workflowData.graph ? (workflowData.version ?? current.version + 1) : (workflowData.version ?? current.version)
    const finalUpdates = {
      ...updates,
      version: nextVersion,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    }

    const { sql, values } = buildUpdateQuery('graph_workflows', finalUpdates, { id })
    const info = db.prepare(sql).run(...values)

    if (info.changes > 0 && workflowData.graph) {
      this.createVersionSnapshot(id, nextVersion, workflowData.graph, 'Workflow updated')
    }

    return info.changes > 0
  }

  static delete(id: number): boolean {
    const db = getUserSettingsDb()
    const info = db.prepare('DELETE FROM graph_workflows WHERE id = ?').run(id)
    return info.changes > 0
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
  }
}
