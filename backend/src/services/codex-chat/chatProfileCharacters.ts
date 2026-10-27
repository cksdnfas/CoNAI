import type Database from 'better-sqlite3'
import type { ChatProfileCharacterLink, ChatProfileCharacterLinkInput } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { attachMainImagesDatabase } from '../../database/userSettingsBootstrap'
import { characterSettingRow } from '../characterLibrary'
import { ChatProfileError } from './chatProfileError'
import { chatCharacterGroupPath } from './chatProfileAssets'
import { GroupPathService } from '../groupPathService'
import { copyExpressionGroup } from './chatProfileExpressions'
import type { ChatProfile, ChatProfileInput } from './chatProfiles'
import { MAX_EMOTICON_GROUPS, normalizeChatStyle, type ChatStyle } from './chatStyle'
import { activeMediaFile } from './chatCardAssets'

export const CHARACTER_APPEARANCE_FIELDS = ['appearance', 'referenceHash', 'avatarHash', 'avatarCrop', 'avatar'] as const
const GROUP_LIMIT_ERROR = '숨겨진 프로필 이모티콘 연결까지 합치면 상한을 넘어. 기존 연결을 먼저 정리해줘.'
// Match SQLite TRIM + NOCASE used by GroupPathService (NOCASE folds ASCII only).
const expressionPathKey = (path: string) => path.split('/').map((part) => part.replace(/^ +| +$/g, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase())).join('/')

export function normalizeCharacterLink(value: unknown): ChatProfileCharacterLinkInput {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new ChatProfileError('캐릭터 연결 값을 확인해줘.')
  const { settingId, synced } = value as { settingId?: unknown; synced?: unknown }
  if (typeof settingId !== 'number' || !Number.isSafeInteger(settingId) || settingId <= 0 || typeof synced !== 'boolean') throw new ChatProfileError('캐릭터 설정 id와 동기화 여부를 확인해줘.')
  if (!getUserSettingsDb().prepare('SELECT 1 FROM character_settings WHERE id = ?').get(settingId)) throw new ChatProfileError('연결할 캐릭터 외형 설정을 찾을 수 없어.')
  return { settingId, synced }
}
export function refuseSyncedCharacterProposal(input: Record<string, unknown>, current?: ChatProfile | null) {
  const next = input.characterLink === undefined ? current?.characterLink : normalizeCharacterLink(input.characterLink)
  const linked = next?.synced ? next : current?.characterLink?.synced ? current.characterLink : null
  if (linked && CHARACTER_APPEARANCE_FIELDS.some((key) => input[key] !== undefined)) {
    const setting = characterSettingRow(linked.settingId)
    throw new ChatProfileError(`동기화된 외형이야. propose_character_library(setting_id=${linked.settingId})를 사용해줘 (${setting.linked_profile_count ?? 0}개 프로필이 함께 변경돼). 또는 먼저 분리해줘.`)
  }
}

/** Setting values are joined into every profile projection, without changing stored local columns. */
export const CHARACTER_PROFILE_COLUMNS = `s.id AS linked_setting_id, s.name AS linked_setting_name, s.folder_id AS linked_folder_id,
  s.revision AS linked_revision, s.appearance AS linked_appearance, s.reference_hash AS linked_reference_hash,
  s.avatar_hash AS linked_avatar_hash, s.avatar_crop AS linked_avatar_crop, s.expression_group_id AS linked_expression_group_id,
  (SELECT COUNT(*) FROM llm_chat_profiles cp WHERE cp.character_setting_id = s.id AND cp.character_sync = 1) AS linked_profile_count`
export type CharacterProfileRow = {
  character_setting_id?: number | null; character_sync?: number
  linked_setting_id?: number | null; linked_setting_name?: string; linked_folder_id?: number | null
  linked_revision?: number; linked_appearance?: string; linked_reference_hash?: string | null
  linked_avatar_hash?: string | null; linked_avatar_crop?: string | null; linked_expression_group_id?: number | null; linked_profile_count?: number
}
export function characterProfileDependencies(rows: CharacterProfileRow[]) {
  const folders = new Map<number, { parent_id: number | null; name: string }>()
  const expressions = new Map<string, number>()
  if (rows.some((row) => row.linked_setting_id)) {
    for (const row of getUserSettingsDb().prepare('SELECT id, parent_id, name FROM character_folders').all() as Array<{ id: number; parent_id: number | null; name: string }>) folders.set(row.id, row)
    if (rows.some((row) => row.character_sync === 1)) {
      const database = getUserSettingsDb()
      attachMainImagesDatabase(database)
      for (const row of database.prepare(`SELECT e.id, p.name FROM groups e JOIN groups p ON e.parent_id = p.id
        JOIN groups r ON p.parent_id = r.id WHERE TRIM(e.name) = '표정' COLLATE NOCASE AND r.parent_id IS NULL AND TRIM(r.name) = '채팅 캐릭터' COLLATE NOCASE`).all() as Array<{ id: number; name: string }>) expressions.set(expressionPathKey(`채팅 캐릭터/${row.name}`), row.id)
    }
  }
  return { folders, expressions }
}
function singleCharacterDependencies(profile: ChatProfile, row: CharacterProfileRow): ReturnType<typeof characterProfileDependencies> {
  const folders = new Map<number, { parent_id: number | null; name: string }>(), expressions = new Map<string, number>()
  if (!row.linked_setting_id) return { folders, expressions }
  const database = getUserSettingsDb()
  if (row.linked_folder_id) {
    for (const folder of database.prepare(`WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, name FROM character_folders WHERE id = ?
      UNION ALL SELECT f.id, f.parent_id, f.name FROM character_folders f JOIN ancestors a ON f.id = a.parent_id
    ) SELECT * FROM ancestors`).all(row.linked_folder_id) as Array<{ id: number; parent_id: number | null; name: string }>) folders.set(folder.id, folder)
  }
  if (row.character_sync === 1) {
    attachMainImagesDatabase(database)
    const path = chatCharacterGroupPath(profile.name)
    const group = GroupPathService.resolve(`${path}/표정`, { create: false }, database)
    if (group) expressions.set(expressionPathKey(path), group.groupId)
  }
  return { folders, expressions }
}
function effectiveExpressionGroups(stored: number[], setting: number | null, own?: number) {
  return [...(setting ? [setting] : []), ...stored.filter((id) => id !== setting && id !== own)].slice(0, MAX_EMOTICON_GROUPS)
}
/** Undo the read overlay before persisting an editor's effective style; hidden local memberships remain local. */
export function storedCharacterStyle(name: string, stored: ChatStyle, input: unknown, previous: ChatProfileCharacterLinkInput, next: ChatProfileCharacterLinkInput, database: Database.Database): ChatStyle {
  const style = normalizeChatStyle(input)
  const groupOf = (link: ChatProfileCharacterLinkInput) => link ? characterSettingRow(link.settingId).expression_group_id : null
  const previousGroup = groupOf(previous), nextGroup = groupOf(next)
  attachMainImagesDatabase(database)
  const own = GroupPathService.resolve(`${chatCharacterGroupPath(name)}/표정`, { create: false }, database)?.groupId
  const shown = previous?.synced ? effectiveExpressionGroups(stored.emoticonGroupIds, previousGroup, own) : stored.emoticonGroupIds
  const ids = style.emoticonGroupIds.filter((id) => id !== previousGroup && id !== nextGroup)
  stored.emoticonGroupIds.forEach((id, index) => {
    if (id === previousGroup || id === nextGroup || ids.includes(id)) return
    if (id === own || !shown.includes(id)) ids.splice(Math.min(index, ids.length), 0, id)
  })
  if (ids.length > MAX_EMOTICON_GROUPS) throw new ChatProfileError(GROUP_LIMIT_ERROR)
  return { ...style, emoticonGroupIds: ids }
}
export function effectiveCharacterProfile(profile: ChatProfile, row: CharacterProfileRow, dependencies = singleCharacterDependencies(profile, row)): ChatProfile {
  if (!row.linked_setting_id) return profile
  const path: string[] = []
  let folderId = row.linked_folder_id
  while (folderId) {
    const folder = dependencies.folders.get(folderId)
    if (!folder) break
    path.unshift(folder.name); folderId = folder.parent_id
  }
  const link: ChatProfileCharacterLink = { settingId: row.linked_setting_id, synced: row.character_sync === 1, settingName: row.linked_setting_name!, path, revision: row.linked_revision!, linkedProfileCount: row.linked_profile_count ?? 0 }
  if (!link.synced) return { ...profile, characterLink: link }
  const expressionGroupId = row.linked_expression_group_id ?? null
  const own = dependencies.expressions.get(expressionPathKey(chatCharacterGroupPath(profile.name)))
  return { ...profile, characterLink: link, characterExpressionGroupId: expressionGroupId,
    appearance: row.linked_appearance ?? '', referenceHash: row.linked_reference_hash ?? null,
    avatarHash: row.linked_avatar_hash ?? null, avatarCrop: row.linked_avatar_crop ? JSON.parse(row.linked_avatar_crop) : null, avatar: null,
    style: { ...profile.style, emoticonGroupIds: effectiveExpressionGroups(profile.style.emoticonGroupIds, expressionGroupId, own) },
  }
}

/** Snapshot a setting into local profile fields and its own expression group, in the caller's transaction. */
export function detachedCharacterFields(settingId: number, profile: Pick<ChatProfile, 'name' | 'style'>, patch: ChatProfileInput, database: Database.Database, deletingSetting = false): ChatProfileInput {
  const setting = characterSettingRow(settingId)
  attachMainImagesDatabase(database)
  const path = `${chatCharacterGroupPath(profile.name)}/표정`
  let groupId = GroupPathService.resolve(path, { create: false }, database)?.groupId ?? null
  const source = setting.expression_group_id && database.prepare('SELECT 1 FROM groups WHERE id = ?').get(setting.expression_group_id) ? setting.expression_group_id : null
  if (source && !groupId) groupId = GroupPathService.resolveOrCreate(path, database).groupId
  if (groupId) copyExpressionGroup(source, groupId, database)
  // A deleted file must not prevent detaching or deleting its setting. Explicit patch hashes are still validated by the store.
  const availableHash = (hash: string | null) => hash && activeMediaFile(hash)?.mimeType.startsWith('image/') ? hash : null
  const fields: ChatProfileInput = { appearance: setting.appearance, referenceHash: availableHash(setting.reference_hash), avatarHash: availableHash(setting.avatar_hash), avatarCrop: setting.avatar_crop ? JSON.parse(setting.avatar_crop) : null, avatar: null }
  for (const key of CHARACTER_APPEARANCE_FIELDS) if (key !== 'avatar' && patch[key] !== undefined) (fields as Record<string, unknown>)[key] = patch[key]
  let emoticonGroupIds = [...(groupId ? [groupId] : []), ...profile.style.emoticonGroupIds.filter((id) => id !== groupId && id !== setting.expression_group_id)]
  if (emoticonGroupIds.length > MAX_EMOTICON_GROUPS) {
    if (!deletingSetting) throw new ChatProfileError(GROUP_LIMIT_ERROR)
    emoticonGroupIds = profile.style.emoticonGroupIds
  }
  return { ...fields, style: { ...profile.style, emoticonGroupIds } }
}
