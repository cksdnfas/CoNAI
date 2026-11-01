import path from 'path'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import { assertFolderDestination, folderWrite, listFoldersWithCounts } from './libraryFolderStore'
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '../middleware/upload'
import { zipEntryBytes, zipEntryKind } from '../utils/zipEntries'
import { EmoticonService } from './emoticonService'
import type Database from 'better-sqlite3'
import { CHAT_PROFILE_TEXT_LIMITS, characterOutfitIndex, composeCharacterAppearance, emptyCharacterAppearanceSections, folderPath, normalizeCharacterTag, type CharacterAppearanceSections, type CharacterFacetKey, type CharacterFolder, type CharacterLibraryExport, type CharacterLibraryFacets, type CharacterLibraryImportResult, type CharacterOutfit, type CharacterSetting, type CharacterSettingBulkResult, type CharacterSettingSummary, type CharacterSettingPage, type CharacterLibraryDeletePreview, type CharacterLibraryDeleteResult } from '@conai/shared'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { indexCharacterSettingTags } from '../database/characterLibrarySchema'
import { CHARACTER_FACET_KEYS, libraryFacetDimensions, settingCopyrightLabels, splitAppearanceText } from './characterAppearanceTags'
import { danbooruBrowserService } from './danbooruBrowserService'
import { attachMainImagesDatabase } from '../database/userSettingsBootstrap'
import { normalizeAvatarCrop, normalizeProfileAssetHash } from './codex-chat/chatProfileAssets'
import { GroupPathService } from './groupPathService'
import { publishRuntimeEvent } from './runtime-events/runtimeEventBus'
import { activeMediaFile, characterMediaGroupPath, ingestMedia } from './codex-chat/chatCardAssets'
import { ChatProfileStore } from './codex-chat/chatProfiles'
import { copyExpressionGroup, expressionGroupId } from './codex-chat/chatProfileExpressions'
import { characterLibraryId as id, characterLibraryName as name, characterSettingFields as fields, characterSettingCreateSchema, characterSettingPatchSchema, characterFolderCreateSchema, characterFolderPatchSchema, characterOutfitsSchema, characterSectionsSchema } from './characterLibraryInput'
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
  sections: string | null; outfits: string; favorite: number
  revision: number; created_at: string; updated_at: string
  linked_profile_count?: number
}
const linkedCountColumn = '(SELECT COUNT(*) FROM llm_chat_profiles p WHERE p.character_setting_id = character_settings.id AND p.character_sync = 1) AS linked_profile_count'
const summaryColumns = `id, folder_id, name, reference_hash, avatar_hash, avatar_crop, outfits, favorite, revision, updated_at, ${linkedCountColumn}`
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
function summary(row: SettingRow, images: boolean, copyrights: ReadonlyMap<number, string>): CharacterSettingSummary {
  return { id: row.id, folderId: row.folder_id, name: row.name, referenceHash: images ? row.reference_hash : null, avatarHash: images ? row.avatar_hash : null, avatarCrop: row.avatar_crop ? JSON.parse(row.avatar_crop) : null, favorite: row.favorite === 1, revision: row.revision, updatedAt: row.updated_at, linkedProfileCount: row.linked_profile_count ?? 0, copyright: copyrights.get(row.id) ?? null, outfitCount: (JSON.parse(row.outfits) as unknown[]).length }
}
/** The settings' works from their tag index; none without a Danbooru dictionary. */
function copyrightsOf(settingIds: number[]): Map<number, string> {
  if (!settingIds.length || !danbooruBrowserService.isAvailable()) return new Map()
  return settingCopyrightLabels(getUserSettingsDb().prepare('SELECT setting_id AS settingId, tag FROM character_setting_tags WHERE setting_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(settingIds)) as Array<{ settingId: number; tag: string }>)
}
/** The stored look; a setting from before sections reads its whole appearance as `other`. */
function lookOf(row: Pick<SettingRow, 'sections' | 'outfits' | 'appearance'>): { sections: CharacterAppearanceSections; outfits: CharacterOutfit[] } {
  return {
    sections: row.sections ? { ...emptyCharacterAppearanceSections(), ...JSON.parse(row.sections) as Partial<CharacterAppearanceSections> } : { ...emptyCharacterAppearanceSections(), other: row.appearance },
    outfits: JSON.parse(row.outfits) as CharacterOutfit[],
  }
}
/** The appearance a profile or workflow gets wearing the named outfit (`characterOutfitIndex`); stored text for the default. */
export function characterSettingAppearance(row: Pick<SettingRow, 'sections' | 'outfits' | 'appearance'>, outfit: string | null | undefined): string {
  if (!outfit?.trim()) return row.appearance
  const look = lookOf(row)
  const index = characterOutfitIndex(look.outfits, outfit)
  return index === 0 ? row.appearance : composeCharacterAppearance(look, index)
}
export function getCharacterSetting(settingId: number, images = true): CharacterSetting {
  const row = characterSettingRow(settingId)
  return { ...summary(row, images, copyrightsOf([settingId])), appearance: row.appearance, ...lookOf(row), expressionGroupId: row.expression_group_id, candidateGroupId: row.candidate_group_id, createdAt: row.created_at, path: characterFolderPath(row.folder_id).map((folder) => folder.name), linkedProfiles: syncedCharacterProfiles([settingId]) }
}

const tagList = z.array(z.string().trim().min(1).transform(normalizeCharacterTag))
const listFields = {
  folderId: id.nullable().optional(),
  query: z.string().optional(),
  favorite: z.boolean().optional(),
  filters: z.partialRecord(z.enum(CHARACTER_FACET_KEYS as [CharacterFacetKey, ...CharacterFacetKey[]]), tagList).optional(),
  sort: z.enum(['name', 'updated', 'created', 'created_asc']).default('name'),
}
type ListScope = { folderId?: number | null; query?: string; favorite?: boolean; filters?: Partial<Record<CharacterFacetKey, string[]>> }
const ORDER_BY = { name: 'name COLLATE NOCASE, id', updated: 'updated_at DESC, id DESC', created: 'created_at DESC, id DESC', created_asc: 'created_at, id' } as const
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`

/** Library tags whose Korean dictionary name contains the query; translations are Korean only, so other text skips it. */
function translatedTagMatches(query: string): string[] {
  if (!/[^\u0000-\u007f]/.test(query) || !danbooruBrowserService.isAvailable()) return []
  const tags = (getUserSettingsDb().prepare('SELECT DISTINCT tag FROM character_setting_tags').all() as Array<{ tag: string }>).map((row) => row.tag)
  return [...danbooruBrowserService.describeTags(tags)].filter(([, description]) => description.translated?.includes(query)).map(([tag]) => tag)
}

/** WHERE over character_settings for a scope; `excluded` leaves one dimension's selection out (its own counts). */
function scopeWhere(scope: ListScope, excluded?: CharacterFacetKey) {
  const where: string[] = [], bindings: Array<number | string | null> = []
  if (scope.folderId !== undefined) { checkFolder(scope.folderId); where.push('folder_id IS ?'); bindings.push(scope.folderId) }
  const query = scope.query?.trim()
  if (query) {
    where.push("(name LIKE ? ESCAPE '\\' OR id IN (SELECT setting_id FROM character_setting_tags WHERE tag LIKE ? ESCAPE '\\' OR tag IN (SELECT value FROM json_each(?))))")
    bindings.push(likePattern(query), likePattern(normalizeCharacterTag(query)), JSON.stringify(translatedTagMatches(query)))
  }
  if (scope.favorite) where.push('favorite = 1')
  for (const [key, tags] of Object.entries(scope.filters ?? {}) as Array<[CharacterFacetKey, string[]]>) {
    if (key === excluded || !tags.length) continue
    where.push('id IN (SELECT setting_id FROM character_setting_tags WHERE tag IN (SELECT value FROM json_each(?)))')
    bindings.push(JSON.stringify(tags))
  }
  return { filter: where.length ? `WHERE ${where.join(' AND ')}` : '', bindings }
}

export function listCharacterSettings(input: unknown = {}, images = true): CharacterSettingPage {
  const value = parse(z.object({ ...listFields, limit: z.number().int().min(1).max(200).default(60), offset: z.number().int().nonnegative().default(0) }).strict(), input)
  const { filter, bindings } = scopeWhere(value)
  const db = getUserSettingsDb()
  const total = (db.prepare(`SELECT COUNT(*) n FROM character_settings ${filter}`).get(...bindings) as { n: number }).n
  const rows = db.prepare(`SELECT ${summaryColumns} FROM character_settings ${filter} ORDER BY ${ORDER_BY[value.sort]} LIMIT ? OFFSET ?`).all(...bindings, value.limit, value.offset) as SettingRow[]
  const copyrights = copyrightsOf(rows.map((row) => row.id))
  return { items: rows.map((row) => summary(row, images, copyrights)), total, hasMore: value.offset + rows.length < total }
}

/**
 * Filter dimensions of the listed scope with each tag's setting count. A dimension with a selection is counted
 * without that selection (choosing a second hair colour stays possible); the others share one count.
 */
export function characterLibraryFacets(input: unknown = {}): CharacterLibraryFacets {
  const { sort: _sort, ...scopeFields } = listFields
  const value = parse(z.object(scopeFields).strict(), input)
  if (!danbooruBrowserService.isAvailable()) return { available: false, dimensions: [] }
  const counted = new Map<string, Map<string, number>>()
  const countsFor = (key: CharacterFacetKey) => {
    const excluded = value.filters?.[key]?.length ? key : undefined
    const cacheKey = excluded ?? ''
    let counts = counted.get(cacheKey)
    if (!counts) {
      const { filter, bindings } = scopeWhere(value, excluded)
      const rows = getUserSettingsDb().prepare(`SELECT tag, COUNT(*) n FROM character_setting_tags WHERE setting_id IN (SELECT id FROM character_settings ${filter}) GROUP BY tag`).all(...bindings) as Array<{ tag: string; n: number }>
      counts = new Map(rows.map((row) => [row.tag, row.n]))
      counted.set(cacheKey, counts)
    }
    return counts
  }
  return { available: true, dimensions: libraryFacetDimensions(countsFor) }
}
export function requireCharacterImageAccess(input: unknown, canViewImages: boolean) {
  const value = input as { referenceHash?: unknown; avatarHash?: unknown } | null
  if (!canViewImages && value && ['referenceHash', 'avatarHash', 'avatarCrop'].some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new CharacterLibraryError('Permission required: images.view', 403)
  }
}
type LookInput = { appearance?: string; sections?: Partial<CharacterAppearanceSections>; outfits?: CharacterOutfit[] }
/**
 * The look a write stores, null when it leaves the look alone. Sections and outfits apply over the current ones; a
 * plain appearance text is split by the dictionary, its outfit tags replacing the default outfit's (an unchanged text
 * keeps the stored structure).
 */
function resolveLook(value: LookInput, current: SettingRow | null) {
  if (value.appearance === undefined && value.sections === undefined && value.outfits === undefined) return null
  if (value.appearance !== undefined && (value.sections !== undefined || value.outfits !== undefined)) throw new CharacterLibraryError('appearance 텍스트와 sections/outfits는 함께 보낼 수 없어. 하나만 보내줘.')
  const base = current ? lookOf(current) : { sections: emptyCharacterAppearanceSections(), outfits: [] as CharacterOutfit[] }
  let sections: CharacterAppearanceSections, outfits: CharacterOutfit[]
  if (value.appearance !== undefined) {
    if (current && value.appearance === current.appearance) return null
    const split = splitAppearanceText(value.appearance)
    sections = split.sections
    const [first, ...rest] = base.outfits
    outfits = first ? [{ ...first, tags: split.outfitTags }, ...rest] : split.outfitTags ? [{ name: '기본', tags: split.outfitTags }] : []
  } else {
    sections = { ...base.sections, ...value.sections }
    outfits = value.outfits ?? base.outfits
  }
  const appearance = composeCharacterAppearance({ sections, outfits })
  // Profiles and workflows may wear any outfit, so every combination must fit.
  const tooLong = outfits.findIndex((_, index) => composeCharacterAppearance({ sections, outfits }, index).length > CHAT_PROFILE_TEXT_LIMITS.text)
  if (appearance.length > CHAT_PROFILE_TEXT_LIMITS.text || tooLong >= 0) throw new CharacterLibraryError(`외형 태그가 너무 길어. 섹션과 ${tooLong > 0 ? `'${outfits[tooLong].name}' 의상` : '기본 의상'}을 합쳐 ${CHAT_PROFILE_TEXT_LIMITS.text}자 이하로 줄여줘.`)
  return { sections, outfits, appearance }
}

export function validateCharacterSetting(input: unknown, settingId?: number, canViewImages = true) {
  requireCharacterImageAccess(input, canViewImages)
  const value = settingId === undefined ? parse(characterSettingCreateSchema, input) : parse(characterSettingPatchSchema, input)
  resolveLook(value, settingId === undefined ? null : characterSettingRow(settingId))
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
  const look = resolveLook(value, null) ?? { sections: emptyCharacterAppearanceSections(), outfits: [], appearance: '' }
  const setting = write(() => {
    const db = getUserSettingsDb()
    const settingId = Number(db.prepare('INSERT INTO character_settings(folder_id, name, appearance, sections, outfits, reference_hash, avatar_hash, avatar_crop) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(value.folderId, value.name, look.appearance, JSON.stringify(look.sections), JSON.stringify(look.outfits), value.referenceHash ?? null, value.avatarHash ?? null, value.avatarCrop ? JSON.stringify(value.avatarCrop) : null).lastInsertRowid)
    indexCharacterSettingTags(db, settingId, look.appearance, look.outfits)
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
  const look = resolveLook(value, before)
  database.prepare(`UPDATE character_settings SET folder_id = ?, name = ?, appearance = ?, sections = ?, outfits = ?, reference_hash = ?, avatar_hash = ?, avatar_crop = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?`).run(
    value.folderId === undefined ? before.folder_id : value.folderId, settingName,
    look ? look.appearance : before.appearance, look ? JSON.stringify(look.sections) : before.sections, look ? JSON.stringify(look.outfits) : before.outfits,
    value.referenceHash === undefined ? before.reference_hash : value.referenceHash,
    value.avatarHash === undefined ? before.avatar_hash : value.avatarHash,
    value.avatarCrop === undefined ? before.avatar_crop : value.avatarCrop === null ? null : JSON.stringify(value.avatarCrop), settingId)
  if (look) indexCharacterSettingTags(database, settingId, look.appearance, look.outfits)
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

const idList = z.array(id).min(1)
const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('favorite'), ids: idList, favorite: z.boolean() }).strict(),
  z.object({ action: z.literal('move'), ids: idList, folderId: id.nullable() }).strict(),
  z.object({ action: z.literal('delete'), ids: idList }).strict(),
])
/** One write for several settings (by id, without revisions: the person chose them in the list just now). */
export function bulkCharacterSettings(input: unknown): CharacterSettingBulkResult {
  const value = parse(bulkSchema, input)
  const ids = [...new Set(value.ids)]
  const done = write(() => {
    const db = getUserSettingsDb()
    const rows = ids.map((settingId) => characterSettingRow(settingId))
    if (value.action === 'favorite') {
      const changed = db.prepare('UPDATE character_settings SET favorite = ?, revision = revision + 1 WHERE id IN (SELECT value FROM json_each(?)) AND favorite != ?').run(value.favorite ? 1 : 0, JSON.stringify(ids), value.favorite ? 1 : 0).changes
      return { changed, folderIds: [], profileIds: [] as number[] }
    }
    if (value.action === 'move') {
      checkFolder(value.folderId)
      const moving = rows.filter((row) => row.folder_id !== value.folderId)
      // A name taken in the destination (or twice among the moved) fails the unique index and the whole move.
      const move = db.prepare("UPDATE character_settings SET folder_id = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?")
      for (const row of moving) move.run(value.folderId, row.id)
      return { changed: moving.length, folderIds: [...moving.map((row) => row.folder_id), value.folderId], profileIds: [] }
    }
    const profileIds = (db.prepare('SELECT id FROM llm_chat_profiles WHERE character_setting_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as Array<{ id: number }>).map((row) => row.id)
    ids.forEach((settingId) => deleteCharacterSetting(settingId))
    return { changed: ids.length, folderIds: rows.map((row) => row.folder_id), profileIds }
  })
  characterChanged(done.folderIds, ids, done.profileIds)
  return { changed: done.changed }
}

const exportSchema = z.union([z.object({ ids: idList }).strict(), z.object({ folderId: id.nullable() }).strict()])
/** The bundle's document entry; images sit beside it as `images/<hash>.<ext>`. */
export const CHARACTER_BUNDLE_DOCUMENT = 'character-library.json'
const BUNDLE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024
/**
 * Settings as a portable bundle: the document (folder paths from the export's top, the folder exported or the top
 * level) and the library file of every image it names (reference, avatar, expressions, candidates). Images whose file
 * is gone are left out of the document. Without `images` (no `images.view`) the document names no image.
 */
export function exportCharacterLibrary(input: unknown, images: boolean): { document: CharacterLibraryExport; files: Array<{ name: string; path: string }> } {
  const value = parse(exportSchema, input)
  const db = getUserSettingsDb()
  const folders = new Map(listCharacterFolders().map((folder) => [folder.id, folder]))
  let rows: SettingRow[], depth = 0
  if ('ids' in value) rows = [...new Set(value.ids)].map((settingId) => characterSettingRow(settingId))
  else if (value.folderId === null) rows = db.prepare('SELECT * FROM character_settings ORDER BY id').all() as SettingRow[]
  else {
    rows = db.prepare('SELECT * FROM character_settings WHERE folder_id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(subtree(value.folderId).map((folder) => folder.id))) as SettingRow[]
    depth = folderPath(folders, value.folderId).length
  }
  if (images) attachMainImagesDatabase(db)
  const files = new Map<string, { name: string; path: string }>()
  const bundled = (hash: string | null) => {
    if (!images || !hash) return null
    if (files.has(hash)) return hash
    const file = activeMediaFile(hash)
    if (!file) return null
    files.set(hash, { name: `images/${hash}${path.extname(file.path).toLowerCase()}`, path: file.path })
    return hash
  }
  const groupExists = (groupId: number | null): groupId is number => images && groupId !== null && Boolean(db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId))
  const candidateHashes = db.prepare('SELECT composite_hash FROM image_groups WHERE group_id = ? ORDER BY order_index, id')
  const document: CharacterLibraryExport = {
    format: 'conai.character-library',
    version: 1,
    settings: rows.map((row) => {
      const avatarHash = bundled(row.avatar_hash)
      return {
        path: folderPath(folders, row.folder_id).slice(depth).map((folder) => folder.name),
        name: row.name,
        ...lookOf(row),
        favorite: row.favorite === 1,
        referenceHash: bundled(row.reference_hash),
        avatarHash,
        avatarCrop: avatarHash && row.avatar_crop ? JSON.parse(row.avatar_crop) : null,
        expressions: groupExists(row.expression_group_id)
          ? EmoticonService.listEntries(row.expression_group_id, db).flatMap((entry) => bundled(entry.compositeHash) ? [{ hash: entry.compositeHash, keywords: entry.explicit ? entry.keywords : [] }] : [])
          : [],
        candidates: groupExists(row.candidate_group_id)
          ? (candidateHashes.all(row.candidate_group_id) as Array<{ composite_hash: string }>).flatMap((entry) => bundled(entry.composite_hash) ?? [])
          : [],
      }
    }),
  }
  return { document, files: [...files.values()] }
}

const documentSchema = z.object({
  format: z.literal('conai.character-library'),
  version: z.literal(1),
  settings: z.array(z.object({
    path: z.array(name), name, sections: characterSectionsSchema, outfits: characterOutfitsSchema, favorite: z.boolean(),
    referenceHash: z.string().nullable(), avatarHash: z.string().nullable(), avatarCrop: fields.avatarCrop.unwrap(),
    expressions: z.array(z.object({ hash: z.string(), keywords: z.array(z.string()) }).strict()),
    candidates: z.array(z.string()),
  }).strict()),
}).strict()
/**
 * Add a bundle's settings under `folderId`: path folders are reused by name or created, a taken name gets ` (2)`,
 * ` (3)`…, bundled images join the library first (`canUpload`; already stored ones are reused), and an image neither
 * bundled nor in this library, or one the person may not see, is dropped and counted.
 */
export async function importCharacterLibrary(input: { folderId: unknown; bundlePath: string }, canViewImages: boolean, canUpload: boolean): Promise<CharacterLibraryImportResult> {
  const targetFolderId = parse(id.nullable(), input.folderId)
  checkFolder(targetFolderId)
  let zip: AdmZip
  try { zip = new AdmZip(input.bundlePath) } catch { throw new CharacterLibraryError('ZIP 파일을 읽지 못했어. CoNAI에서 내보낸 외형 묶음인지 확인해줘.') }
  const entries = zip.getEntries().filter((entry) => zipEntryKind(entry) === 'file')
  const documentEntry = entries.find((entry) => entry.entryName === CHARACTER_BUNDLE_DOCUMENT)
  const documentBytes = documentEntry ? zipEntryBytes(documentEntry, BUNDLE_DOCUMENT_MAX_BYTES) : null
  if (!documentBytes) throw new CharacterLibraryError(`묶음에 ${CHARACTER_BUNDLE_DOCUMENT}가 없어. CoNAI에서 내보낸 외형 묶음인지 확인해줘.`)
  let raw: unknown
  try { raw = JSON.parse(documentBytes.toString('utf8')) } catch { throw new CharacterLibraryError(`${CHARACTER_BUNDLE_DOCUMENT}를 읽지 못했어.`) }
  const document = parse(documentSchema, raw)
  const result = { createdSettings: 0, createdFolders: 0, renamed: 0, importedImages: 0, droppedImages: 0 }

  // Images first (asynchronous): a bundled file joins the library, else a hash this library has stays.
  const imageEntries = new Map(entries.flatMap((entry) => {
    const match = /^images\/([^/.]+)\.[a-z0-9]+$/i.exec(entry.entryName)
    return match ? [[match[1], entry] as const] : []
  }))
  const hashes = new Map<string, string | null>()
  for (const setting of document.settings) {
    for (const hash of [setting.referenceHash, setting.avatarHash, ...setting.expressions.map((entry) => entry.hash), ...setting.candidates]) {
      if (!hash || hashes.has(hash)) continue
      let stored: string | null = null
      if (canViewImages) {
        const entry = imageEntries.get(hash)
        const bytes = entry && canUpload ? zipEntryBytes(entry, MAX_UPLOAD_FILE_SIZE_BYTES) : null
        if (bytes) {
          try { stored = (await ingestMedia(bytes)).compositeHash; result.importedImages += 1 } catch { /* counted below: not a usable image */ }
        }
        if (!stored && activeMediaFile(hash)) stored = hash
      }
      if (!stored) result.droppedImages += 1
      hashes.set(hash, stored)
    }
  }
  const mapped = (hash: string | null) => hash ? hashes.get(hash) ?? null : null

  const db = getUserSettingsDb()
  if (canViewImages) attachMainImagesDatabase(db)
  const settingIds: number[] = [], folderIds: Array<number | null> = [targetFolderId]
  write(() => {
    checkFolder(targetFolderId)
    const findFolder = db.prepare('SELECT id FROM character_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE')
    const nameTaken = db.prepare('SELECT 1 FROM character_settings WHERE folder_id IS ? AND name = ? COLLATE NOCASE')
    const folderFor = (folderNames: string[]) => folderNames.reduce<number | null>((parentId, folderName) => {
      const found = findFolder.get(parentId, folderName) as { id: number } | undefined
      if (found) return found.id
      result.createdFolders += 1
      const created = Number(db.prepare('INSERT INTO character_folders(parent_id, name) VALUES (?, ?)').run(parentId, folderName).lastInsertRowid)
      folderIds.push(created)
      return created
    }, targetFolderId)
    for (const entry of document.settings) {
      const folderId = folderFor(entry.path)
      let settingName = entry.name
      for (let copy = 2; nameTaken.get(folderId, settingName); copy += 1) {
        const suffix = ` (${copy})`
        settingName = entry.name.slice(0, CHAT_PROFILE_TEXT_LIMITS.name - suffix.length) + suffix
      }
      if (settingName !== entry.name) result.renamed += 1
      const referenceHash = mapped(entry.referenceHash)
      const avatarHash = mapped(entry.avatarHash)
      const setting = createCharacterSetting({
        folderId, name: settingName, sections: entry.sections, outfits: entry.outfits,
        ...(canViewImages ? { referenceHash, avatarHash, avatarCrop: avatarHash ? entry.avatarCrop : null } : {}),
      }, canViewImages)
      if (entry.favorite) db.prepare('UPDATE character_settings SET favorite = 1 WHERE id = ?').run(setting.id)
      // Two bundled images may be the same picture here; the first one keeps its keywords.
      const seen = new Set<string>()
      const expressions = entry.expressions.flatMap((item) => {
        const hash = mapped(item.hash)
        if (!hash || seen.has(hash)) return []
        seen.add(hash)
        return [{ compositeHash: hash, keywords: item.keywords.length ? item.keywords : undefined }]
      })
      const candidates = [...new Set(entry.candidates.flatMap((hash) => mapped(hash) ?? []))]
      if (expressions.length || candidates.length) {
        const groups = ensureCharacterGroups(setting.id, db)
        if (expressions.length) {
          const added = EmoticonService.addImages(groups.expressionGroupId, expressions, db)
          if (added.conflicts.length || added.missing.length) throw new CharacterLibraryError(`'${entry.name}'의 표정 키워드가 겹치거나 이미지가 사라졌어.`, 409)
        }
        const insert = db.prepare("INSERT OR IGNORE INTO image_groups(group_id, composite_hash, collection_type, order_index) VALUES (?, ?, 'manual', ?)")
        candidates.forEach((hash, index) => insert.run(groups.candidateGroupId, hash, index))
      }
      settingIds.push(setting.id)
      result.createdSettings += 1
    }
  })
  characterChanged(folderIds, settingIds)
  return result
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
