import { folderPath, type ChatProfileFolder } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { characterFolderCreateSchema, characterFolderPatchSchema, characterLibraryId } from '../characterLibraryInput'
import { ChatProfileError } from './chatProfileError'
import { assertFolderDestination, folderWrite, listFoldersWithCounts } from '../libraryFolderStore'
import { appendFolderProfiles } from './chatProfileOrder'

export function listChatProfileFolders(): ChatProfileFolder[] {
  return listFoldersWithCounts('chat_profile_folders', 'llm_chat_profiles', 'profileCount')
}

export function checkedProfileFolder(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = characterLibraryId.safeParse(value)
  if (!parsed.success) throw new ChatProfileError('폴더 ID가 올바르지 않아.')
  if (!getUserSettingsDb().prepare('SELECT 1 FROM chat_profile_folders WHERE id = ?').get(parsed.data)) throw new ChatProfileError('폴더를 찾을 수 없어.')
  return parsed.data
}

function write<T>(run: () => T): T {
  return folderWrite(run, () => new ChatProfileError('같은 위치에 같은 폴더 이름이 있어. 이름을 바꾼 뒤 다시 시도해줘.'))
}

export function createChatProfileFolder(input: unknown): ChatProfileFolder {
  const parsed = characterFolderCreateSchema.safeParse(input)
  if (!parsed.success) throw new ChatProfileError(parsed.error.message)
  return write(() => {
    const { name, parentId } = parsed.data
    checkedProfileFolder(parentId)
    const result = getUserSettingsDb().prepare('INSERT INTO chat_profile_folders (name, parent_id) VALUES (?, ?)').run(name, parentId)
    return listChatProfileFolders().find((folder) => folder.id === Number(result.lastInsertRowid))!
  })
}

export function updateChatProfileFolder(id: number, input: unknown): ChatProfileFolder {
  const parsed = characterFolderPatchSchema.safeParse(input)
  if (!parsed.success) throw new ChatProfileError(parsed.error.message)
  return write(() => {
    checkedProfileFolder(id)
    const folders = listChatProfileFolders()
    const current = folders.find((folder) => folder.id === id)!
    const parentId = parsed.data.parentId === undefined ? current.parentId : checkedProfileFolder(parsed.data.parentId)
    assertFolderDestination('chat_profile_folders', id, parentId, () => new ChatProfileError('폴더를 자신이나 하위 폴더로 옮길 수 없어.'))
    getUserSettingsDb().prepare("UPDATE chat_profile_folders SET name = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(parsed.data.name ?? current.name, parentId, id)
    return { ...current, name: parsed.data.name ?? current.name, parentId }
  })
}

/** Reparent atomically; duplicate sibling names reject the entire operation instead of losing or renaming data. */
export function deleteChatProfileFolder(id: number) {
  return write(() => {
    checkedProfileFolder(id)
    const db = getUserSettingsDb()
    const folder = db.prepare('SELECT parent_id AS parentId FROM chat_profile_folders WHERE id = ?').get(id) as { parentId: number | null }
    // Deferred foreign keys let a same-named child take the removed folder's place in this transaction.
    db.prepare('DELETE FROM chat_profile_folders WHERE id = ?').run(id)
    db.prepare("UPDATE chat_profile_folders SET parent_id = ?, updated_at = datetime('now') WHERE parent_id = ?").run(folder.parentId, id)
    appendFolderProfiles(id, folder.parentId)
    return { parentId: folder.parentId }
  })
}

/** Only attach names to usable profiles: the legacy directory also includes inaccessible/disabled profiles. */
export function profileFolderPaths<T extends { id: number; folderId: number | null }>(profiles: T[], usable: (profile: T) => boolean) {
  const byId = new Map(listChatProfileFolders().map((folder) => [folder.id, folder]))
  return new Map(profiles.map((profile) => [profile.id, usable(profile) ? folderPath(byId, profile.folderId).map(({ id, name }) => ({ id, name })) : []]))
}
