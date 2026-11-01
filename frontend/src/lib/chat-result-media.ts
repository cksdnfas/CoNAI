import { buildApiUrl } from './api-url'
import type { ImageRecord } from '@/types/image'

/** A UI delivery scope only; the server reauthorizes the stored result on every file request. */
export function isChatResultMedia(image: ImageRecord | null | undefined): image is ImageRecord & { image_url: string } {
  if (!image?.image_url || !image.composite_hash) return false
  const prefix = buildApiUrl('/api/codex-chat/threads/')
  if (!image.image_url.startsWith(prefix)) return false
  const match = /^([1-9]\d*)\/messages\/([1-9]\d*)\/media\/([a-f0-9]{48}|[a-f0-9]{32})\/file$/.exec(image.image_url.slice(prefix.length))
  return match?.[3] === image.composite_hash
}
