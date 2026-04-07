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

export type GraphWorkflowFolderDeleteMode = 'move_children' | 'delete_tree'

function collectDescendantFolderIds(folders: GraphWorkflowFolderRecord[], folderId: number) {
  const descendants = new Set<number>()
  const queue = [folderId]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    for (const folder of folders) {
      if (folder.parent_id !== currentId || descendants.has(folder.id)) {
        continue
      }

      descendants.add(folder.id)
      queue.push(folder.id)
    }
  }

  return [...descendants]
}

/** Manage workflow explorer folders for graph workflows. */
export class GraphWorkflowFolderModel {
  /** Resolve one folder subtree including the selected folder id itself. */
  static getSubtreeFolderIds(folderId: number): number[] {
    const folders = this.findAll()
    return [folderId, ...collectDescendantFolderIds(folders, folderId)]
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

  static delete(id: number, mode: GraphWorkflowFolderDeleteMode = 'move_children'): boolean {
    const db = getUserSettingsDb()
    const targetFolder = this.findById(id)
    if (!targetFolder) {
      return false
    }

    const transaction = db.transaction(() => {
      if (mode === 'delete_tree') {
        const descendantFolderIds = collectDescendantFolderIds(this.findAll(), id)
        const targetFolderIds = [id, ...descendantFolderIds]
        const placeholders = targetFolderIds.map(() => '?').join(', ')

        db.prepare(`DELETE FROM graph_workflows WHERE folder_id IN (${placeholders})`).run(...targetFolderIds)
      } else {
        db.prepare('UPDATE graph_workflow_folders SET parent_id = ?, updated_date = CURRENT_TIMESTAMP WHERE parent_id = ?').run(targetFolder.parent_id ?? null, id)
        db.prepare('UPDATE graph_workflows SET folder_id = ?, updated_date = CURRENT_TIMESTAMP WHERE folder_id = ?').run(targetFolder.parent_id ?? null, id)
      }

      const info = db.prepare('DELETE FROM graph_workflow_folders WHERE id = ?').run(id)
      return info.changes > 0
    })

    return transaction()
  }
}
