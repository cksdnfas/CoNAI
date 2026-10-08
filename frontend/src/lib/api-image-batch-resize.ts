import { requestApiData } from '@/lib/api-request'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/** POST /api/images/batch-resize — resize selected library images into new items (a runtime job). */

export type ImageBatchResizeFormat = 'png' | 'webp'

export interface ImageBatchResizeInput {
  compositeHashes: string[]
  width: number
  height: number
  format: ImageBatchResizeFormat
  quality: number
  groupPath?: string
}

export interface ImageBatchResizeResult {
  groupId: number
  saved: Array<{ source: string; compositeHash: string }>
  skipped: Array<{ source: string; reason: string }>
  failed: Array<{ source: string; error: string }>
}

export function startImageBatchResize(input: ImageBatchResizeInput) {
  return requestApiData<RuntimeJobRecord<ImageBatchResizeResult>>('/api/images/batch-resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
