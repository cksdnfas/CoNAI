import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphWorkflowModel } from './GraphWorkflow'
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

export type GraphWorkflowFolderDeleteMode = 'move_children' | 'delete_tree'

const subtree = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM graph_workflow_folders WHERE id = ?
  UNION SELECT f.id FROM graph_workflow_folders f JOIN subtree s ON f.parent_id = s.id
)`

export class GraphFolderWriteError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message) }
}

/** Manage workflow explorer folders for graph workflows. */
export class GraphWorkflowFolderModel {
  /** Resolve one folder subtree including the selected folder id itself. */
  static getSubtreeFolderIds(folderId: number): number[] {
    return getUserSettingsDb().prepare(`${subtree} SELECT id FROM subtree`).pluck().all(folderId) as number[]
  }

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

  static createAndAssign(data: GraphWorkflowFolderCreateData, workflowId: number, expectedRevision: number) {
    return getUserSettingsDb().transaction(() => {
      const id = this.create(data)
      const moved = GraphWorkflowModel.update(workflowId, { folder_id: id }, expectedRevision)
      if (moved.missing) throw new GraphFolderWriteError(404, 'Graph workflow not found')
      if (moved.conflict) throw new GraphFolderWriteError(409, '워크플로가 바뀌었어. 새로 불러와줘.')
      return { id, workflow_revision: moved.revision }
    }).immediate()
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
    return db.transaction(() => {
      if (folderData.parent_id != null && db.prepare(`${subtree} SELECT 1 FROM subtree WHERE id = ?`).get(id, folderData.parent_id)) {
        throw new GraphFolderWriteError(400, 'Folder cannot be moved inside its own subtree')
      }
      return db.prepare(sql).run(...values).changes > 0
    }).immediate()
  }

  static delete(id: number, mode: GraphWorkflowFolderDeleteMode = 'move_children'): boolean {
    return this.deleteWithWorkflows(id, mode).deleted
  }

  static deleteWithWorkflows(id: number, mode: GraphWorkflowFolderDeleteMode) {
    const db = getUserSettingsDb()
    const transaction = db.transaction(() => {
      const targetFolder = this.findById(id)
      let workflowIds: number[] = []
      if (!targetFolder) return { deleted: false, workflowIds }
      if (mode === 'delete_tree') {
        workflowIds = db.prepare(`${subtree} DELETE FROM graph_workflows WHERE folder_id IN (SELECT id FROM subtree) RETURNING id`).pluck().all(id) as number[]
      } else {
        db.prepare('UPDATE graph_workflow_folders SET parent_id = ?, updated_date = CURRENT_TIMESTAMP WHERE parent_id = ?').run(targetFolder.parent_id ?? null, id)
        db.prepare('UPDATE graph_workflows SET folder_id = ?, updated_date = CURRENT_TIMESTAMP WHERE folder_id = ?').run(targetFolder.parent_id ?? null, id)
      }

      const info = db.prepare('DELETE FROM graph_workflow_folders WHERE id = ?').run(id)
      return { deleted: info.changes > 0, workflowIds }
    })

    return transaction.immediate()
  }
}
