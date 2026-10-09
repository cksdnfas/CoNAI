import type Database from 'better-sqlite3'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { attachMainImagesDatabase } from '../../database/userSettingsBootstrap'
import type { McpRequester } from '../../mcp/context'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { GroupPathService } from '../groupPathService'
import { EmoticonService, normalizeKeyword } from '../emoticonService'
import { ChatAssetError, requireChatAssetAdmin } from './chatAssetAccess'
import { chatCharacterGroupPath, normalizeProfileAssetHash } from './chatProfileAssets'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { normalizeChatStyle } from './chatStyle'

/**
 * A character's expressions are the keyworded images of its "채팅 캐릭터/<name>/표정" group: one image per emotion
 * name. These helpers fill, replace and clear one emotion from the profile editor and from asset batches.
 */

/** The profile's expression group, or null when it was never made. */
export function expressionGroupId(profile: Pick<ChatProfile, 'name'>, database: Database.Database = getUserSettingsDb()) {
  return GroupPathService.resolve(`${chatCharacterGroupPath(profile.name)}/표정`, { create: false }, database)?.groupId ?? null
}

/** Take these keywords off every image of the group other than `keep`; an image left without keywords leaves the group. */
function releaseKeywords(groupId: number, keywords: string[], keep: string | null, database: Database.Database) {
  const wanted = new Set(keywords.map((keyword) => keyword.toLowerCase()))
  for (const entry of EmoticonService.listEntries(groupId, database)) {
    if (entry.compositeHash === keep || !entry.keywords.some((keyword) => wanted.has(keyword.toLowerCase()))) continue
    const rest = entry.keywords.filter((keyword) => !wanted.has(keyword.toLowerCase()))
    if (rest.length) EmoticonService.setKeywords(groupId, [{ compositeHash: entry.compositeHash, keywords: rest }], database)
    else database.prepare('DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?').run(groupId, entry.compositeHash)
  }
}

/**
 * Give images these emotion keywords in the group (keeping their other explicit keywords), replacing whatever image
 * held each keyword before. Runs inside the caller's transaction.
 */
export function assignExpressionKeywords(groupId: number, items: Array<{ compositeHash: string; keywords: string[] }>, database: Database.Database) {
  for (const item of items) releaseKeywords(groupId, item.keywords, item.compositeHash, database)
  const entries = new Map(EmoticonService.listEntries(groupId, database).map((entry) => [entry.compositeHash, entry]))
  const merged = items.map((item) => ({ compositeHash: item.compositeHash, keywords: [...new Set([...(entries.get(item.compositeHash)?.explicit ? entries.get(item.compositeHash)!.keywords : []), ...item.keywords])] }))
  if (merged.some((item) => item.keywords.length > 12)) throw new ChatAssetError('한 이미지에 표정 키워드를 12개 넘게 넣을 수 없어.', 409)
  const result = EmoticonService.addImages(groupId, merged, database)
  if (result.conflicts.length || result.missing.length) throw new ChatAssetError('표정 그룹의 키워드가 겹치거나 이미지가 사라졌어.', 409, { conflicts: result.conflicts, missing: result.missing })
}

/** The style with the expression group linked first; refuses when the link limit is reached. */
export function styleWithExpressionGroup(profile: ChatProfile, groupId: number) {
  const groupIds = [groupId, ...profile.style.emoticonGroupIds.filter((id) => id !== groupId)]
  const style = { ...profile.style, emoticonGroupIds: groupIds }
  if (normalizeChatStyle(style).emoticonGroupIds.length !== groupIds.length) throw new ChatAssetError('이모티콘 그룹 연결이 상한에 닿았어. 먼저 연결 하나를 풀어줘.', 409)
  return style
}

function emotionName(value: unknown) {
  const name = normalizeKeyword(value)
  if (!name || typeof value !== 'string' || name !== value.trim()) throw new ChatAssetError('감정 이름이 올바르지 않아.')
  return name
}

function writableProfile(requester: McpRequester, profileId: number) {
  requireChatAssetAdmin(requester)
  requireRequesterPermission(requester, 'images.edit')
  const profile = ChatProfileStore.find(profileId)
  if (!profile) throw new ChatAssetError('프로필을 찾을 수 없어.', 404)
  return profile
}

/** Put a library image (uploaded or picked) on one emotion, replacing the image it had. */
export function setProfileExpression(requester: McpRequester, profileId: number, name: unknown, compositeHash: unknown) {
  const profile = writableProfile(requester, profileId)
  const emotion = emotionName(name)
  if (typeof compositeHash !== 'string') throw new ChatAssetError('이미지를 골라줘.')
  normalizeProfileAssetHash(compositeHash)
  const database = getUserSettingsDb()
  attachMainImagesDatabase(database)
  return database.transaction(() => {
    const group = GroupPathService.resolveOrCreate(`${chatCharacterGroupPath(profile.name)}/표정`, database)
    database.prepare('UPDATE groups SET emoticon_enabled = 1 WHERE id = ?').run(group.groupId)
    assignExpressionKeywords(group.groupId, [{ compositeHash, keywords: [emotion] }], database)
    const updated = profile.style.emoticonGroupIds[0] === group.groupId ? profile : ChatProfileStore.update(profileId, { style: styleWithExpressionGroup(profile, group.groupId) }, database)
    return { expressionGroupId: group.groupId, profile: updated ?? profile }
  }).immediate()
}

/** Empty one emotion: its image loses the keyword (and leaves the group when it has no other). */
export function clearProfileExpression(requester: McpRequester, profileId: number, name: unknown) {
  const profile = writableProfile(requester, profileId)
  const emotion = emotionName(name)
  const database = getUserSettingsDb()
  attachMainImagesDatabase(database)
  database.transaction(() => {
    const groupId = expressionGroupId(profile, database)
    if (groupId) releaseKeywords(groupId, [emotion], null, database)
  }).immediate()
  return { expressionGroupId: expressionGroupId(profile, database) }
}
