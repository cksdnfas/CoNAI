import fs from 'fs'
import { IMAGE_VIEW_PERMISSION } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { AuthAccessControlService } from '../authAccessControlService'
import { EmoticonService, originalNameFromPath } from '../emoticonService'
import { FileStoreError } from '../fileStoreService'
import { ImageSafetyService } from '../imageSafetyService'
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService'
import { MEDIA_HASH_PATTERN } from './chatMediaLinks'

/** A reference to existing library media, never a copy into the private file store. */
export type ChatMediaAttachment = { compositeHash: string; name: string; mimeType: string | null }

function requireChatMediaAccess(requester: McpRequester) {
  const id = requester.accountId
  const permissions = id === null
    ? (hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys)
    : (AuthAccount.findById(id)?.status === 'active' ? AuthAccessControlService.resolveForAccountId(id).permissionKeys : [])
  if (!permissions.includes(IMAGE_VIEW_PERMISSION)) {
    throw new FileStoreError('앱 미디어 접근 권한이 없어.', 403)
  }
}

export function validateChatMediaAttachments(requester: McpRequester, hashes: unknown, fileCount: number): ChatMediaAttachment[] {
  if (hashes === undefined || (Array.isArray(hashes) && hashes.length === 0)) return []
  requireChatMediaAccess(requester)
  if (!Array.isArray(hashes) || hashes.some((hash) => typeof hash !== 'string' || !MEDIA_HASH_PATTERN.test(hash))) {
    throw new FileStoreError('앱 미디어 목록에서 첨부할 항목을 다시 선택해줘.', 400)
  }
  if (hashes.length + fileCount > 20) {
    throw new FileStoreError('첨부는 보관함 파일과 앱 미디어를 합쳐 최대 20개까지 가능해.', 400)
  }
  return [...new Set(hashes as string[])].map((compositeHash) => {
    const metadata = MediaMetadataModel.findByHash(compositeHash)
    const file = metadata && MediaPostprocessVisibilityService.isReadyRecord(metadata) && !ImageSafetyService.isHidden(metadata.rating_score)
      ? EmoticonService.activeFile(compositeHash) : null
    if (!file || !fs.existsSync(file.path)) throw new FileStoreError('첨부할 미디어가 삭제되었거나 현재 접근할 수 없어.', 404)
    return { compositeHash, name: originalNameFromPath(file.path) || compositeHash, mimeType: file.mimeType }
  })
}

export function parseChatMediaAttachments(value: string | null): ChatMediaAttachment[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is ChatMediaAttachment => item && typeof item.compositeHash === 'string' && MEDIA_HASH_PATTERN.test(item.compositeHash) && typeof item.name === 'string' && (item.mimeType === null || typeof item.mimeType === 'string')).slice(0, 20) : []
  } catch {
    return []
  }
}
