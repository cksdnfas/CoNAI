import { z } from 'zod'
import { assertFolderDestination, folderWrite, listFoldersWithCounts } from './libraryFolderStore'
import type Database from 'better-sqlite3'
import { CHAT_PROFILE_TEXT_LIMITS, type CharacterFolder, type CharacterSetting, type CharacterSettingSummary, type CharacterSettingPage, type CharacterLibraryDeletePreview, type CharacterLibraryDeleteResult } from '@conai/shared'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { attachMainImagesDatabase } from '../database/userSettingsBootstrap'
import { normalizeAvatarCrop, normalizeProfileAssetHash } from './codex-chat/chatProfileAssets'
import { GroupPathService } from './groupPathService'
import { publishRuntimeEvent } from './runtime-events/runtimeEventBus'
import { characterMediaGroupPath } from './codex-chat/chatCardAssets'
import { ChatProfileStore } from './codex-chat/chatProfiles'
import { copyExpressionGroup, expressionGroupId } from './codex-chat/chatProfileExpressions'
import { characterLibraryId as id, characterLibraryName as name, characterSettingFields as fields, characterSettingCreateSchema, characterSettingPatchSchema, characterFolderCreateSchema, characterFolderPatchSchema } from './characterLibraryInput'
export { characterSettingCreateSchema, characterSettingPatchSchema, characterFolderCreateSchema, characterFolderPatchSchema } from './characterLibraryInput'

export class CharacterLibraryError extends Error {
  constructor(message: string, readonly status = 400, readonly revision?: number, readonly code?: 'revision_conflict' | 'name_conflict') { super(message) }
}
export function characterId(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return parse(id, number)
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new CharacterLibraryError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
type SettingRow = {
  id: number; folder_id: number | null; name: string; appearance: string
  reference_hash: string | null; avatar_hash: string | null; avatar_crop: string | null
  asset_group_id: number | null; expression_group_id: number | null; candidate_group_id: number | null
  revision: number; created_at: string; updated_at: string
  linked_profile_count?: number
}
const linkedCountColumn = '(SELECT COUNT(*) FROM llm_chat_profiles p WHERE p.character_setting_id = character_settings.id AND p.character_sync = 1) AS linked_profile_count'
const summaryColumns = `id, folder_id, name, reference_hash, avatar_hash, avatar_crop, revision, updated_at, ${linkedCountColumn}`
const folderColumns = 'f.id, f.parent_id AS parentId, f.name, f.created_at AS createdAt, f.updated_at AS updatedAt'
export function syncedCharacterProfiles(settingIds: number[]) {
  return getUserSettingsDb().prepare('SELECT id, name FROM llm_chat_profiles WHERE character_sync = 1 AND character_setting_id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(settingIds)) as Array<{ id: number; name: string }>
}
export function characterChanged(folderIds: Array<number | null>, settingIds: number[], profileIds: number[] = []) {
  publishRuntimeEvent({ name: 'characters.changed', topic: 'characters', payload: { folderIds: [...new Set(folderIds.filter((value): value is number => value !== null))], settingIds: [...new Set(settingIds)], profileIds: [...new Set([...profileIds, ...syncedCharacterProfiles(settingIds).map((profile) => profile.id)])] } })
}
function write<T>(run: () => T) {
  return folderWrite(run, () => new CharacterLibraryError('같은 위치에 같은 이름이 있어.', 409, undefined, 'name_conflict'))
}
export function listCharacterFolders(parentId?: number | null): CharacterFolder[] {
  return listFoldersWithCounts('character_folders', 'character_settings', 'settingCount', parentId)
}
export function getCharacterFolder(folderId: number): CharacterFolder {
  const folder = getUserSettingsDb().prepare(`SELECT ${folderColumns}, (SELECT COUNT(*) FROM character_settings WHERE folder_id = f.id) AS settingCount FROM character_folders f WHERE f.id = ?`).get(folderId) as CharacterFolder | undefined
  if (!folder) throw new CharacterLibraryError('폴더를 찾을 수 없어.', 404)
  return folder
}
function checkFolder(folderId: number | null) { if (folderId !== null) getCharacterFolder(folderId) }
export function characterFolderPath(folderId: number | null): CharacterFolder[] {
  if (folderId === null) return []
  checkFolder(folderId)
  return getUserSettingsDb().prepare(`WITH RECURSIVE ancestors(id, depth) AS (
    SELECT ?, 0 UNION ALL SELECT f.parent_id, a.depth + 1 FROM character_folders f JOIN ancestors a ON f.id = a.id WHERE f.parent_id IS NOT NULL
  ) SELECT ${folderColumns}, 0 AS settingCount FROM ancestors a JOIN character_folders f ON f.id = a.id ORDER BY a.depth DESC`).all(folderId) as CharacterFolder[]
}
export function createCharacterFolder(input: unknown) {
  const value = parse(characterFolderCreateSchema, input)
  const folder = write(() => {
    checkFolder(value.parentId)
    return getCharacterFolder(Number(getUserSettingsDb().prepare('INSERT INTO character_folders(parent_id, name) VALUES (?, ?)').run(value.parentId, value.name).lastInsertRowid))
  })
  characterChanged([folder.id, folder.parentId], [])
  return folder
}
export function patchCharacterFolder(folderId: number, input: unknown) {
  const value = parse(characterFolderPatchSchema, input)
  const before = getCharacterFolder(folderId)
  const folder = write(() => {
    const parentId = value.parentId === undefined ? before.parentId : value.parentId
    checkFolder(parentId)
    assertFolderDestination('character_folders', folderId, parentId, () => new CharacterLibraryError('폴더를 자신이나 하위 폴더로 옮길 수 없어.'))
    getUserSettingsDb().prepare("UPDATE character_folders SET parent_id = ?, name = ?, updated_at = datetime('now') WHERE id = ?").run(parentId, value.name ?? before.name, folderId)
    return getCharacterFolder(folderId)
  })
  characterChanged([folderId, before.parentId, folder.parentId], deletionTargets('folder', folderId).settingIds)
  return folder
}
export function characterSettingRow(settingId: number): SettingRow {
  const row = getUserSettingsDb().prepare(`SELECT *, ${linkedCountColumn} FROM character_settings WHERE id = ?`).get(settingId) as SettingRow | undefined
  if (!row) throw new CharacterLibraryError('외형 설정을 찾을 수 없어.', 404)
  return row
}
function summary(row: SettingRow, images: boolean): CharacterSettingSummary {
  return { id: row.id, folderId: row.folder_id, name: row.name, referenceHash: images ? row.reference_hash : null, avatarHash: images ? row.avatar_hash : null, avatarCrop: row.avatar_crop ? JSON.parse(row.avatar_crop) : null, revision: row.revision, updatedAt: row.updated_at, linkedProfileCount: row.linked_profile_count ?? 0 }
}
export function getCharacterSetting(settingId: number, images = true): CharacterSetting {
  const row = characterSettingRow(settingId)
  return { ...summary(row, images), appearance: row.appearance, expressionGroupId: row.expression_group_id, candidateGroupId: row.candidate_group_id, createdAt: row.created_at, path: characterFolderPath(row.folder_id).map((folder) => folder.name), linkedProfiles: syncedCharacterProfiles([settingId]) }
}
export function listCharacterSettings(input: { folderId?: number | null; query?: string; limit?: number; offset?: number } = {}, images = true): CharacterSettingPage {
  const value = parse(z.object({ folderId: id.nullable().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).default(60), offset: z.number().int().nonnegative().default(0) }).strict(), input)
  if (value.folderId !== undefined) checkFolder(value.folderId)
  const where: string[] = [], bindings: Array<number | string | null> = []
  if (value.folderId !== undefined) { where.push('folder_id IS ?'); bindings.push(value.folderId) }
  if (value.query) { where.push("name LIKE ? ESCAPE '\\'"); bindings.push(`%${value.query.replace(/[\\%_]/g, '\\$&')}%`) }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = getUserSettingsDb()
  const total = (db.prepare(`SELECT COUNT(*) n FROM character_settings ${filter}`).get(...bindings) as { n: number }).n
  const rows = db.prepare(`SELECT ${summaryColumns} FROM character_settings ${filter} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...bindings, value.limit, value.offset) as SettingRow[]
  return { items: rows.map((row) => summary(row, images)), total, hasMore: value.offset + rows.length < total }
}
export function requireCharacterImageAccess(input: unknown, canViewImages: boolean) {
  const value = input as { referenceHash?: unknown; avatarHash?: unknown } | null
  if (!canViewImages && value && ['referenceHash', 'avatarHash', 'avatarCrop'].some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new CharacterLibraryError('Permission required: images.view', 403)
  }
}
export function validateCharacterSetting(input: unknown, settingId?: number, canViewImages = true) {
  requireCharacterImageAccess(input, canViewImages)
  const value = settingId === undefined ? parse(characterSettingCreateSchema, input) : parse(characterSettingPatchSchema, input)
  if (value.folderId !== undefined) checkFolder(value.folderId)
  if (settingId !== undefined) {
    const row = characterSettingRow(settingId)
    if (!('revision' in value) || value.revision !== row.revision) throw new CharacterLibraryError('설정이 바뀌었어. 다시 읽고 저장해줘.', 409, row.revision, 'revision_conflict')
  }
  const current = settingId === undefined ? null : characterSettingRow(settingId)
  const folderId = value.folderId === undefined ? current?.folder_id ?? null : value.folderId
  const settingName = value.name ?? current?.name
  if (getUserSettingsDb().prepare('SELECT 1 FROM character_settings WHERE folder_id IS ? AND name = ? COLLATE NOCASE AND id != ?').get(folderId, settingName, settingId ?? 0)) throw new CharacterLibraryError('같은 위치에 같은 이름이 있어.', 409, undefined, 'name_conflict')
  return { ...value,
    ...(value.referenceHash !== undefined ? { referenceHash: normalizeProfileAssetHash(value.referenceHash) } : {}),
    ...(value.avatarHash !== undefined ? { avatarHash: normalizeProfileAssetHash(value.avatarHash) } : {}),
    ...(value.avatarCrop !== undefined ? { avatarCrop: normalizeAvatarCrop(value.avatarCrop) } : {}),
  }
}
/** ID-owned groups never follow a name lookup after creation. No image/group is deleted with its setting. */
function characterGroupLabel(name: string, id: number) {
  return `${characterMediaGroupPath(name, '').slice(1)} #${id}`
}
export function ensureCharacterGroups(settingId: number, database: Database.Database = getUserSettingsDb()) {
  attachMainImagesDatabase(database)
  const row = characterSettingRow(settingId)
  const exists = (groupId: number | null) => groupId !== null && Boolean(database.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId))
  const child = (parent: number, label: string) => {
    const existing = database.prepare('SELECT id FROM groups WHERE parent_id = ? AND TRIM(name) = ? COLLATE NOCASE').get(parent, label) as { id: number } | undefined
    return existing?.id ?? Number(database.prepare('INSERT INTO groups(parent_id, name) VALUES (?, ?)').run(parent, label).lastInsertRowid)
  }
  let changed = false
  const result = database.transaction(() => {
    const root = exists(row.asset_group_id) ? row.asset_group_id! : child(GroupPathService.resolveOrCreate('캐릭터 라이브러리', database).groupId, characterGroupLabel(row.name, row.id))
    const expressions = exists(row.expression_group_id) ? row.expression_group_id! : child(root, '표정')
    const candidates = exists(row.candidate_group_id) ? row.candidate_group_id! : child(root, '후보')
    database.prepare('UPDATE groups SET emoticon_enabled = 1 WHERE id = ? AND emoticon_enabled IS NOT 1').run(expressions)
    changed = root !== row.asset_group_id || expressions !== row.expression_group_id || candidates !== row.candidate_group_id
    if (changed) database.prepare('UPDATE character_settings SET asset_group_id = ?, expression_group_id = ?, candidate_group_id = ? WHERE id = ?').run(root, expressions, candidates, settingId)
    return { assetGroupId: root, expressionGroupId: expressions, candidateGroupId: candidates }
  })()
  return result
}
export function fileCharacterAssets(settingId: number, hashes: Array<string | null>, database: Database.Database = getUserSettingsDb()) {
  const unique = [...new Set(hashes.filter((hash): hash is string => Boolean(hash)))]
  if (!unique.length) return
  const group = ensureCharacterGroups(settingId, database)
  const insert = database.prepare("INSERT OR IGNORE INTO image_groups(composite_hash, group_id, collection_type, order_index) VALUES (?, ?, 'manual', 0)")
  unique.forEach((hash) => insert.run(hash, group.assetGroupId))
}
export function createCharacterSetting(input: unknown, canViewImages = true) {
  const nested = getUserSettingsDb().inTransaction
  const value = validateCharacterSetting(input, undefined, canViewImages)
  if (value.referenceHash || value.avatarHash) attachMainImagesDatabase(getUserSettingsDb())
  const setting = write(() => {
    const settingId = Number(getUserSettingsDb().prepare('INSERT INTO character_settings(folder_id, name, appearance, reference_hash, avatar_hash, avatar_crop) VALUES (?, ?, ?, ?, ?, ?)').run(value.folderId, value.name, value.appearance ?? '', value.referenceHash ?? null, value.avatarHash ?? null, value.avatarCrop ? JSON.stringify(value.avatarCrop) : null).lastInsertRowid)
    fileCharacterAssets(settingId, [value.referenceHash ?? null, value.avatarHash ?? null])
    return getCharacterSetting(settingId)
  })
  if (!nested) characterChanged([setting.folderId], [setting.id])
  return setting
}
/** Caller-owned transaction variant is shared by expression and batch application; caller publishes after commit. */
export function updateCharacterSetting(settingId: number, input: unknown, database: Database.Database = getUserSettingsDb()) {
  const value = validateCharacterSetting(input, settingId)
  const before = characterSettingRow(settingId)
  const settingName = value.name ?? before.name
  database.prepare(`UPDATE character_settings SET folder_id = ?, name = ?, appearance = ?, reference_hash = ?, avatar_hash = ?, avatar_crop = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?`).run(
    value.folderId === undefined ? before.folder_id : value.folderId, settingName, value.appearance ?? before.appearance,
    value.referenceHash === undefined ? before.reference_hash : value.referenceHash,
    value.avatarHash === undefined ? before.avatar_hash : value.avatarHash,
    value.avatarCrop === undefined ? before.avatar_crop : value.avatarCrop === null ? null : JSON.stringify(value.avatarCrop), settingId)
  if (before.asset_group_id && settingName !== before.name) {
    attachMainImagesDatabase(database)
    const label = characterGroupLabel(settingName, settingId)
    const collision = database.prepare('SELECT id FROM groups WHERE parent_id IS (SELECT parent_id FROM groups WHERE id = ?) AND TRIM(name) = ? COLLATE NOCASE AND id != ?').get(before.asset_group_id, label, before.asset_group_id)
    if (collision) throw new CharacterLibraryError('캐릭터 이미지 그룹 이름이 다른 이미지 그룹과 겹쳐. 이미지 그룹 이름을 먼저 바꿔줘.', 409, undefined, 'name_conflict')
    database.prepare("UPDATE groups SET name = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ? AND name != ?").run(label, before.asset_group_id, label)
  }
  fileCharacterAssets(settingId, [value.referenceHash ?? null, value.avatarHash ?? null], database)
  return getCharacterSetting(settingId)
}
export function patchCharacterSetting(settingId: number, input: unknown, canViewImages = true) {
  requireCharacterImageAccess(input, canViewImages)
  const before = characterSettingRow(settingId)
  const setting = write(() => updateCharacterSetting(settingId, input))
  characterChanged([before.folder_id, setting.folderId], [settingId])
  return setting
}
function subtree(folderId: number) {
  getCharacterFolder(folderId)
  return getUserSettingsDb().prepare(`WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT f.id FROM character_folders f JOIN tree t ON f.parent_id = t.id) SELECT id FROM tree`).all(folderId) as Array<{ id: number }>
}
function deletionTargets(kind: 'folder' | 'setting', targetId: number) {
  if (kind === 'setting') { const row = characterSettingRow(targetId); return { folderIds: [], settingIds: [targetId], parentId: row.folder_id } }
  const folderIds = subtree(targetId).map((folder) => folder.id)
  const settingIds = (getUserSettingsDb().prepare('SELECT id FROM character_settings WHERE folder_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(folderIds)) as Array<{ id: number }>).map((setting) => setting.id)
  return { folderIds, settingIds, parentId: getCharacterFolder(targetId).parentId }
}
export function previewCharacterDelete(kind: 'folder' | 'setting', targetId: number): CharacterLibraryDeletePreview {
  const targets = deletionTargets(kind, targetId), linkedProfiles = syncedCharacterProfiles(targets.settingIds)
  return { folders: targets.folderIds.length, settings: targets.settingIds.length, linkedProfileCount: linkedProfiles.length, linkedProfiles }
}
/** Phase 2 extends this one deletion boundary to copy values to linked profiles. */
export function deleteCharacterSetting(settingId: number, database: Database.Database = getUserSettingsDb()) {
  characterSettingRow(settingId)
  const profiles = database.prepare('SELECT id FROM llm_chat_profiles WHERE character_setting_id = ?').all(settingId) as Array<{ id: number }>
  for (const profile of profiles) ChatProfileStore.update(profile.id, { characterLink: null }, database, { deletingCharacterSetting: true })
  database.prepare('DELETE FROM character_settings WHERE id = ?').run(settingId)
}
export function deleteCharacterLibrary(kind: 'folder' | 'setting', targetId: number, revision?: number): CharacterLibraryDeleteResult {
  const targets = write(() => {
    if (kind === 'setting' && revision !== undefined) {
      const current = characterSettingRow(targetId).revision
      if (revision !== current) throw new CharacterLibraryError('설정이 바뀌었어. 다시 읽고 삭제해줘.', 409, current, 'revision_conflict')
    }
    const targets = deletionTargets(kind, targetId)
    const profileIds = (getUserSettingsDb().prepare('SELECT id FROM llm_chat_profiles WHERE character_setting_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(targets.settingIds)) as Array<{ id: number }>).map((row) => row.id)
    targets.settingIds.forEach((settingId) => deleteCharacterSetting(settingId))
    if (kind === 'folder') getUserSettingsDb().prepare('DELETE FROM character_folders WHERE id = ?').run(targetId)
    return { ...targets, profileIds }
  })
  characterChanged([...targets.folderIds, targets.parentId], targets.settingIds, targets.profileIds)
  return { deletedFolders: targets.folderIds.length, deletedSettings: targets.settingIds.length }
}

const fromProfileFields = {
  profileId: id, appearance: z.string().max(CHAT_PROFILE_TEXT_LIMITS.text),
  referenceHash: fields.referenceHash.unwrap(), avatarHash: fields.avatarHash.unwrap(), avatarCrop: fields.avatarCrop.unwrap(),
}
export function saveCharacterSettingFromProfile(input: unknown, canViewImages: boolean) {
  requireCharacterImageAccess(input, canViewImages)
  const value = parse(z.discriminatedUnion('mode', [
    z.object({ ...fromProfileFields, mode: z.literal('create'), folderId: fields.folderId, name }).strict(),
    z.object({ ...fromProfileFields, mode: z.literal('overwrite'), settingId: id, revision: id }).strict(),
  ]), input)
  const database = getUserSettingsDb()
  attachMainImagesDatabase(database)
  let previousSettingId: number | null = null
  const setting = write(() => {
    const profile = ChatProfileStore.find(value.profileId)
    if (!profile) throw new CharacterLibraryError('프로필을 찾을 수 없어.', 404)
    previousSettingId = profile.characterLink?.settingId ?? null
    const { appearance, referenceHash, avatarHash, avatarCrop } = value
    let target: CharacterSetting
    if (value.mode === 'create') target = createCharacterSetting({ folderId: value.folderId, name: value.name, appearance, referenceHash, avatarHash, avatarCrop }, canViewImages)
    else {
      if (!profile.characterLink || profile.characterLink.synced || profile.characterLink.settingId !== value.settingId) throw new CharacterLibraryError('이 외형 설정에서 분리한 프로필만 덮어쓸 수 있어.', 400)
      target = updateCharacterSetting(value.settingId, { revision: value.revision, appearance, referenceHash, avatarHash, avatarCrop }, database)
    }
    const source = profile.characterLink?.synced ? profile.characterExpressionGroupId : expressionGroupId(profile, database)
    const group = ensureCharacterGroups(target.id, database)
    copyExpressionGroup(source, group.expressionGroupId, database)
    ChatProfileStore.update(profile.id, { characterLink: { settingId: target.id, synced: true } }, database)
    return getCharacterSetting(target.id)
  })
  characterChanged([setting.folderId], [...new Set([setting.id, ...(previousSettingId === null ? [] : [previousSettingId])])], [value.profileId])
  return setting
}
