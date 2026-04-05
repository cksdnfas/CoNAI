import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphWorkflowFolderRecord } from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

export type GraphWorkflowFolderCreateData = {
  name: string
  description?: string | null
  parent_id?: number | null
}

export type GraphWorkflowFolderUpdateData = {
  name?: string
  description?: string | null
  parent_id?: number | null
}

/** Manage workflow explorer folders for graph workflows. */
export class GraphWorkflowFolderModel {
  static create(folderData: GraphWorkflowFolderCreateData): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO graph_workflow_folders (
        name, description, parent_id
      ) VALUES (?, ?, ?)
    `).run(
      folderData.name,
      folderData.description ?? null,
      folderData.parent_id ?? null,
    )

    return info.lastInsertRowid as number
  }

  static findById(id: number): GraphWorkflowFolderRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM graph_workflow_folders WHERE id = ?').get(id) as GraphWorkflowFolderRecord | undefined
    return row || null
  }

  static findAll(): GraphWorkflowFolderRecord[] {
    const db = getUserSettingsDb()
    return db.prepare('SELECT * FROM graph_workflow_folders ORDER BY name COLLATE NOCASE ASC, id ASC').all() as GraphWorkflowFolderRecord[]
  }

  static update(id: number, folderData: GraphWorkflowFolderUpdateData): boolean {
    const db = getUserSettingsDb()
    const updates = filterDefined({
      name: folderData.name,
      description: folderData.description,
      parent_id: folderData.parent_id,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    })

    if (Object.keys(updates).filter((key) => key !== 'updated_date').length === 0) {
      return false
    }

    const { sql, values } = buildUpdateQuery('graph_workflow_folders', updates, { id })
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  static delete(id: number): boolean {
    const db = getUserSettingsDb()
    const info = db.prepare('DELETE FROM graph_workflow_folders WHERE id = ?').run(id)
    return info.changes > 0
  }
}
