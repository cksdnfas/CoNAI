import { getUserSettingsDb } from '../database/userSettingsDb'

type FolderTable = 'character_folders' | 'chat_profile_folders'

export function folderWrite<T>(run: () => T, nameConflict: () => Error): T {
  try { return getUserSettingsDb().transaction(run).immediate() }
  catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw nameConflict()
    throw error
  }
}

/** Domain-owned table/column names only; counts are aggregated once, never queried per folder. */
export function listFoldersWithCounts<T>(table: FolderTable, items: 'character_settings' | 'llm_chat_profiles', count: 'settingCount' | 'profileCount', parentId?: number | null): T[] {
  return getUserSettingsDb().prepare(`SELECT f.id, f.parent_id AS parentId, f.name, f.created_at AS createdAt,
    f.updated_at AS updatedAt, COALESCE(s.n, 0) AS ${count} FROM ${table} f
    LEFT JOIN (SELECT folder_id, COUNT(*) n FROM ${items} GROUP BY folder_id) s ON s.folder_id = f.id
    ${parentId === undefined ? '' : 'WHERE f.parent_id IS ?'} ORDER BY f.name COLLATE NOCASE, f.id`)
    .all(...(parentId === undefined ? [] : [parentId])) as T[]
}

export function assertFolderDestination(table: FolderTable, id: number, parentId: number | null, cycle: () => Error) {
  if (parentId === null) return
  const found = getUserSettingsDb().prepare(`WITH RECURSIVE ancestors(id) AS (
    SELECT ? UNION ALL SELECT f.parent_id FROM ${table} f JOIN ancestors a ON f.id = a.id WHERE f.parent_id IS NOT NULL
  ) SELECT 1 FROM ancestors WHERE id = ? LIMIT 1`).get(parentId, id)
  if (found) throw cycle()
}
