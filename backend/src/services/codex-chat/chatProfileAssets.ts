import fs from 'fs'
import { db as imagesDb } from '../../database/init'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '../../middleware/upload'
import { ImageSafetyService } from '../imageSafetyService'
import { requireFileStoreOwner } from '../fileStoreAccess'
import { FileStoreService, parseFileId } from '../fileStoreService'
import type { McpRequester } from '../../mcp/context'
import { activeMediaFile, characterMediaGroupPath, downloadToLibrary, fileLibraryMediaUnderGroup, ingestMedia } from './chatCardAssets'
import { MEDIA_HASH_PATTERN, MEDIA_MIME_TYPES, sniffMediaExtension } from './chatMediaLinks'
import { ChatProfileError } from './chatProfileError'
import type { ChatProfile } from './chatProfiles'

export type ChatProfileAssetKind = 'avatar' | 'background' | 'reference'
export type ChatAvatarCrop = { x: number; y: number; scale: number }

export function chatCharacterGroupPath(name: string) {
  return characterMediaGroupPath(name, '채팅 캐릭터')
}

/** Library ids use the existing 48/32-hex composite identity, not the pixel SHA-256. */
export function normalizeProfileAssetHash(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !MEDIA_HASH_PATTERN.test(value)) throw new ChatProfileError('이미지 해시가 올바르지 않아.')
  const file = activeMediaFile(value)
  if (!file?.mimeType.startsWith('image/')) throw new ChatProfileError('라이브러리에서 이미지를 찾을 수 없어.')
  return value
}

export function normalizeAvatarCrop(value: unknown): ChatAvatarCrop | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new ChatProfileError('아바타 자르기 값이 올바르지 않아.')
  const { x, y, scale } = value as ChatAvatarCrop
  if (![x, y, scale].every((number) => typeof number === 'number' && Number.isFinite(number)) || scale <= 0) {
    throw new ChatProfileError('아바타 자르기 값이 올바르지 않아.')
  }
  return { x, y, scale }
}

export function isProfileAssetHidden(hash: string | null) {
  if (!hash) return false
  const metadata = imagesDb.prepare('SELECT rating_score FROM media_metadata WHERE composite_hash = ?').get(hash) as { rating_score: number | null } | undefined
  return Boolean(metadata && ImageSafetyService.isHidden(metadata.rating_score))
}

/** Pending postprocess does not block a profile's original; safety always does, including legacy fallback. */
export function resolveProfileAsset(profile: ChatProfile, kind: ChatProfileAssetKind) {
  const hash = kind === 'avatar' ? profile.avatarHash : kind === 'background' ? profile.backgroundHash : profile.referenceHash
  if (isProfileAssetHidden(hash)) return { state: 'hidden' as const }
  const file = hash ? activeMediaFile(hash) : null
  if (file?.mimeType.startsWith('image/')) return { state: 'file' as const, file }
  const legacy = kind === 'avatar' ? profile.avatar : kind === 'background' ? profile.background : null
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(legacy ?? '')
  return match ? { state: 'legacy' as const, mimeType: match[1], buffer: Buffer.from(match[2], 'base64') } : { state: 'missing' as const }
}

/** Additive fields shared by the public and admin profile responses. */
export function profileAssetFields(profile: ChatProfile, canViewImages: boolean) {
  return {
    appearance: profile.appearance,
    referenceHash: canViewImages ? profile.referenceHash : null,
    avatarHash: canViewImages ? profile.avatarHash : null,
    avatarCrop: profile.avatarCrop,
    backgroundHash: canViewImages ? profile.backgroundHash : null,
    assetVersion: canViewImages ? [profile.avatarHash, profile.backgroundHash, profile.referenceHash].map((hash) => hash?.slice(0, 8) ?? '').join('-') + `-${Date.parse(profile.updatedDate) || 0}` : null,
    avatarThumbnailUrl: canViewImages && profile.avatarHash && !isProfileAssetHidden(profile.avatarHash) ? `/api/images/${profile.avatarHash}/thumbnail` : null,
  }
}

export function fileProfileAssetsUnderGroup(name: string, hashes: Array<string | null>) {
  const unique = [...new Set(hashes.filter((hash): hash is string => Boolean(hash)))]
  fileLibraryMediaUnderGroup(chatCharacterGroupPath(name), unique)
}

/** Decode and register an image; the pipeline keeps its library identity and original bytes. */
export async function ingestProfileAsset(buffer: Buffer, characterName: string) {
  if (buffer.length > MAX_UPLOAD_FILE_SIZE_BYTES) throw new ChatProfileError('이미지는 500MB까지 넣을 수 있어.')
  let extension: string
  try { extension = await sniffMediaExtension(buffer) } catch { throw new ChatProfileError('PNG, JPEG, WebP 또는 GIF 이미지를 골라줘.') }
  if (!MEDIA_MIME_TYPES[extension]?.startsWith('image/')) throw new ChatProfileError('이미지 파일만 넣을 수 있어.')
  const stored = await ingestMedia(buffer)
  fileProfileAssetsUnderGroup(characterName, [stored.compositeHash])
  return stored
}

export async function downloadProfileAsset(url: unknown, characterName: string) {
  if (typeof url !== 'string' || !url.trim()) throw new ChatProfileError('이미지 URL을 넣어줘.')
  try {
    return await downloadToLibrary(url.trim(), chatCharacterGroupPath(characterName), { imagesOnly: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    if (reason === 'private address') throw new ChatProfileError('사설 주소에서는 이미지를 받을 수 없어.')
    if (reason === 'too large') throw new ChatProfileError('URL 이미지는 50MB까지 받을 수 있어.')
    if (reason === 'unsupported protocol' || error instanceof TypeError) throw new ChatProfileError('http 또는 https 이미지 URL을 넣어줘.')
    if (reason === 'not an image') throw new ChatProfileError('이미지 형식이 올바르지 않아.')
    throw new ChatProfileError('이미지 URL을 받지 못했어.')
  }
}

export async function importFileStoreProfileAsset(requester: McpRequester, fileId: unknown, characterName: string) {
  const owner = requireFileStoreOwner(requester)
  const id = parseFileId(fileId)
  if (!id) throw new ChatProfileError('파일을 골라줘.')
  const { entry, filePath } = FileStoreService.resolveFile(owner, id)
  if (!entry.mimeType?.startsWith('image/')) throw new ChatProfileError('이미지 파일만 넣을 수 있어.')
  if (fs.statSync(filePath).size > MAX_UPLOAD_FILE_SIZE_BYTES) throw new ChatProfileError('이미지는 500MB까지 넣을 수 있어.')
  return ingestProfileAsset(await fs.promises.readFile(filePath), characterName)
}

/** Safe on every boot; conditional writes cannot overwrite a profile edited during ingestion. */
export async function migrateLegacyProfileAssets() {
  const db = getUserSettingsDb()
  const rows = db.prepare(`SELECT id, name, avatar, background_image FROM llm_chat_profiles
    WHERE (COALESCE(avatar_hash, '') = '' AND avatar IS NOT NULL) OR (COALESCE(background_hash, '') = '' AND background_image IS NOT NULL)`)
    .all() as Array<{ id: number; name: string; avatar: string | null; background_image: string | null }>
  for (const row of rows) {
    for (const [legacyColumn, hashColumn] of [['avatar', 'avatar_hash'], ['background_image', 'background_hash']] as const) {
      const value = row[legacyColumn]
      if (!value || (db.prepare(`SELECT ${hashColumn} FROM llm_chat_profiles WHERE id = ?`).get(row.id) as Record<string, string | null> | undefined)?.[hashColumn]) continue
      try {
        const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(value)
        if (!match) throw new Error('invalid data URL')
        const stored = await ingestProfileAsset(Buffer.from(match[1], 'base64'), row.name)
        db.prepare(`UPDATE llm_chat_profiles SET ${hashColumn} = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ? AND COALESCE(${hashColumn}, '') = '' AND ${legacyColumn} = ?`)
          .run(stored.compositeHash, row.id, value)
      } catch (error) {
        console.warn(`⚠️ Could not move profile ${row.id} ${legacyColumn} into the library:`, error instanceof Error ? error.message : error)
      }
    }
  }
}
