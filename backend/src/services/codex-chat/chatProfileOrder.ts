import type Database from 'better-sqlite3'
import { foldersDepthFirst, type LibraryFolder } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/** One folder read per directory query; the CASE contains only database integer IDs, never names or caller SQL. */
export function chatProfileFolderRankSql(prefix = '', db: Database.Database = getUserSettingsDb()) {
  const folders = db.prepare('SELECT id, parent_id AS parentId, name FROM chat_profile_folders').all() as LibraryFolder[]
  const ranks = foldersDepthFirst(folders).map((folder, index) => `WHEN ${folder.id} THEN ${index + 1}`).join(' ')
  return `CASE COALESCE(${prefix}folder_id, 0) WHEN 0 THEN 0 ${ranks} ELSE ${folders.length + 1} END`
}

export function chatProfileOrderSql(prefix = '', db: Database.Database = getUserSettingsDb()) {
  return `${chatProfileFolderRankSql(prefix, db)}, ${prefix}sort_order, ${prefix}id`
}

export function nextProfileSortOrder(folderId: number | null) {
  return (getUserSettingsDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM llm_chat_profiles WHERE folder_id IS ?').get(folderId) as { next: number }).next
}

/** Call inside the folder write transaction; preserve the moved block's relative order. */
export function appendFolderProfiles(from: number, to: number | null) {
  const db = getUserSettingsDb()
  const next = nextProfileSortOrder(to)
  db.prepare(`WITH ordered AS MATERIALIZED (
    SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) - 1 AS position FROM llm_chat_profiles WHERE folder_id = @from
  ) UPDATE llm_chat_profiles SET folder_id = @to, sort_order = @next + (SELECT position FROM ordered WHERE ordered.id = llm_chat_profiles.id),
    updated_date = CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM ordered)`).run({ from, to, next })
}
