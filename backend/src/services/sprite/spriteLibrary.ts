import fs from 'fs'
import path from 'path'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { GroupModel } from '../../models/Group'
import { ImageFileModel } from '../../models/Image/ImageFileModel'
import { GroupPathService } from '../groupPathService'
import { LibraryIngestError, saveMediaBytesToLibrary } from '../libraryMediaIngest'
import { parseLibraryMediaDataUrl } from '../libraryMediaDataUrl'
import { SpriteError } from './spriteErrors'
import { readSpriteOptionsXmp } from './spriteEncode'

/**
 * Sprite inputs and outputs go through the image library only: inputs are library media (by composite hash), and
 * every saved sheet/animation/normalised sheet is written like other in-app output, registered with
 * processSavedMediaFile and filed under a group ("스프라이트" unless the caller picks one).
 */

export const SPRITE_GROUP_PATH = '스프라이트'
export const SPRITE_SOURCE_GROUP_PATH = '스프라이트/원본 영상'
const MEDIA_HASH = /^(?:[a-f0-9]{48}|[a-f0-9]{32})$/

export interface LibraryMedia {
  compositeHash: string
  filePath: string
  mimeType: string
  fileType: string
  name: string
}

export function findLibraryMedia(compositeHash: string): LibraryMedia | null {
  if (!MEDIA_HASH.test(compositeHash)) return null
  for (const record of ImageFileModel.findActiveByHash(compositeHash)) {
    const filePath = resolveUploadsPath(record.original_file_path)
    if (fs.existsSync(filePath)) {
      return { compositeHash, filePath, mimeType: record.mime_type ?? '', fileType: record.file_type, name: path.basename(record.original_file_path) }
    }
  }
  return null
}

/** A library video (or animated GIF/WebP, which ffmpeg decodes the same way). */
export function requireLibraryVideo(compositeHash: string): LibraryMedia {
  const media = findLibraryMedia(compositeHash)
  if (!media) throw new SpriteError('라이브러리에서 영상을 찾을 수 없습니다.', 404)
  if (!(media.fileType === 'video' || media.fileType === 'animated' || media.mimeType.startsWith('video/'))) {
    throw new SpriteError('영상 또는 움직이는 이미지만 스프라이트로 추출할 수 있습니다.')
  }
  return media
}

export function requireLibraryImage(compositeHash: string): LibraryMedia {
  const media = findLibraryMedia(compositeHash)
  if (!media) throw new SpriteError('라이브러리에서 이미지를 찾을 수 없습니다.', 404)
  if (!media.mimeType.startsWith('image/')) throw new SpriteError('이미지 파일만 처리할 수 있습니다.')
  return media
}

export interface SpriteGroupTarget {
  groupId?: number | null
  groupPath?: string | null
}

/** Resolve where saved output goes; an explicit group id must exist, a path is created when missing. */
export function resolveSpriteGroup(target: SpriteGroupTarget = {}): number {
  if (target.groupId !== undefined && target.groupId !== null) {
    if (!GroupModel.findById(target.groupId)) throw new SpriteError(`그룹 ${target.groupId}을(를) 찾을 수 없습니다.`, 404)
    return target.groupId
  }
  return GroupPathService.resolveOrCreate(target.groupPath?.trim() || SPRITE_GROUP_PATH).groupId
}

/** Write one output into the library like other in-app results and file it under the target group. */
export async function saveSpriteOutputToLibrary(input: { bytes: Buffer; extension: string; mimeType: string; group?: SpriteGroupTarget }): Promise<{ compositeHash: string; groupId: number }> {
  const groupId = resolveSpriteGroup(input.group)
  try {
    return { compositeHash: await saveMediaBytesToLibrary({ bytes: input.bytes, extension: input.extension, mimeType: input.mimeType, groupId }), groupId }
  } catch (error) {
    if (error instanceof LibraryIngestError) throw new SpriteError(error.message, error.status)
    throw error
  }
}

/**
 * External MCP clients send a video as a data URL (already size- and type-checked by requestSecurity). It is
 * uploaded into the library first, under "스프라이트/원본 영상", so the source stays visible and reusable.
 */
export async function ingestVideoDataUrl(dataUrl: string): Promise<string> {
  try {
    const media = parseLibraryMediaDataUrl(dataUrl.trim())
    if (!media.mimeType.startsWith('video/') && !['image/gif', 'image/webp'].includes(media.mimeType)) {
      throw new SpriteError('영상 data URL 형식을 확인하세요 (video/*, image/gif, image/webp).')
    }
    const saved = await saveSpriteOutputToLibrary({ ...media, group: { groupPath: SPRITE_SOURCE_GROUP_PATH } })
    return saved.compositeHash
  } catch (error) {
    if (error instanceof LibraryIngestError) throw new SpriteError(error.message, error.status)
    throw error
  }
}

/** The settings a saved sprite output was made with (embedded XMP), or null for other media. */
export async function readSpriteSettings(compositeHash: string): Promise<unknown | null> {
  const media = findLibraryMedia(compositeHash)
  return media ? readSpriteOptionsXmp(media.filePath) : null
}
