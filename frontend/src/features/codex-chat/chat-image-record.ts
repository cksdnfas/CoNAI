import type { CodexChatMediaInfo } from '@/lib/api-codex-chat'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { buildApiUrl } from '@/lib/api-url'
import type { ImageRecord } from '@/types/image'

/** Any library media by hash through the chat's own routes: the chat is the grant, so no gallery permission is involved. */
export function buildChatLibraryImageRecord(compositeHash: string, mimeType?: string | null): ImageRecord {
  const base = `/api/codex-chat/media/${encodeURIComponent(compositeHash)}`
  return {
    id: compositeHash,
    composite_hash: compositeHash,
    thumbnail_url: buildApiUrl(`${base}/thumbnail`),
    image_url: buildApiUrl(`${base}.${mimeType?.startsWith('video/') ? 'mp4' : 'png'}`),
    detail_url: `${base}/image`,
    detail_scope_key: `chat-media:${compositeHash}`,
    mime_type: mimeType ?? null,
  }
}

/** A library image as the lightbox needs it; history rows and the thread's media map add mime type and size. */
export function buildChatImageRecord(compositeHash: string, record?: GenerationHistoryRecord, info?: CodexChatMediaInfo): ImageRecord {
  const historyId = record?.id ?? info?.historyId
  const resultBase = info?.resultMediaUrl
  return {
    id: compositeHash,
    composite_hash: compositeHash,
    thumbnail_url: buildApiUrl(resultBase ? `${resultBase}/thumbnail` : historyId ? `/api/generation-history/${historyId}/thumbnail` : `/api/images/${compositeHash}/thumbnail`),
    image_url: buildApiUrl(resultBase ? `${resultBase}/file` : historyId ? `/api/generation-history/${historyId}/file` : `/api/images/${compositeHash}/file`),
    detail_url: resultBase ? `${resultBase}/image` : historyId ? `/api/generation-history/${historyId}/image` : null,
    detail_scope_key: resultBase ?? (historyId ? `generation-history:${historyId}` : null),
    generation_history_id: historyId,
    postprocess_status: record?.postprocess_status ?? info?.postprocessStatus,
    mime_type: record?.actual_mime_type ?? info?.mimeType ?? null,
    width: record?.actual_width ?? info?.width ?? record?.width ?? null,
    height: record?.actual_height ?? info?.height ?? record?.height ?? null,
  }
}
