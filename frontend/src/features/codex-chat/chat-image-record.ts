import type { CodexChatMediaInfo } from '@/lib/api-codex-chat'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { buildApiUrl } from '@/lib/api-url'
import type { ImageRecord } from '@/types/image'

/** A library image as the lightbox needs it; history rows and the thread's media map add mime type and size. */
export function buildChatImageRecord(compositeHash: string, record?: GenerationHistoryRecord, info?: CodexChatMediaInfo): ImageRecord {
  const historyId = record?.id ?? info?.historyId
  const resultBase = info?.resultMediaUrl
  return {
    id: compositeHash,
    composite_hash: compositeHash,
    thumbnail_url: buildApiUrl(resultBase ? `${resultBase}/thumbnail` : historyId ? `/api/generation-history/${historyId}/thumbnail` : `/api/images/${compositeHash}/thumbnail`),
    image_url: buildApiUrl(resultBase ? `${resultBase}/file` : historyId ? `/api/generation-history/${historyId}/file` : `/api/images/${compositeHash}/file`),
    detail_url: !resultBase && historyId ? `/api/generation-history/${historyId}/image` : null,
    detail_scope_key: resultBase ?? (historyId ? `generation-history:${historyId}` : null),
    generation_history_id: historyId,
    postprocess_status: record?.postprocess_status ?? info?.postprocessStatus,
    mime_type: record?.actual_mime_type ?? info?.mimeType ?? null,
    width: record?.actual_width ?? info?.width ?? record?.width ?? null,
    height: record?.actual_height ?? info?.height ?? record?.height ?? null,
  }
}
