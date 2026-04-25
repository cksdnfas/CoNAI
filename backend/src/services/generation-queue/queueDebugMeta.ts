import { GenerationQueueModel } from '../../models/GenerationQueue'
import { getComfyRequestDebugRelativePath, writeComfyRequestDebugSnapshot, type ComfyRequestDebugSnapshot } from '../generationRequestDebugService'
import type { GenerationQueueJobRecord } from '../../types/generationQueue'
import { parseStoredRequestPayload } from './queuePayloads'

export function updateQueueRequestDebugMeta(record: GenerationQueueJobRecord, meta: Record<string, unknown>) {
  try {
    const latestRecord = GenerationQueueModel.findById(record.id) ?? record
    const payload = parseStoredRequestPayload(latestRecord)
    const currentDebug = payload._debug && typeof payload._debug === 'object' && !Array.isArray(payload._debug)
      ? payload._debug as Record<string, unknown>
      : {}

    GenerationQueueModel.update(record.id, {
      request_payload: {
        ...payload,
        _debug: {
          ...currentDebug,
          ...meta,
        },
      },
    })
  } catch (error) {
    console.warn(`⚠️ Failed to persist queue debug metadata for job ${record.id}:`, error)
  }
}

export async function writeQueueComfyDebugSnapshot(record: GenerationQueueJobRecord, snapshot: ComfyRequestDebugSnapshot) {
  try {
    const saved = await writeComfyRequestDebugSnapshot(record.id, snapshot)
    updateQueueRequestDebugMeta(record, {
      comfy_request_log_path: saved.relativePath,
      comfy_request_captured_at: snapshot.captured_at,
      comfy_request_stage: snapshot.stage,
      comfy_prompt_id: snapshot.prompt_id ?? null,
      comfy_endpoint: snapshot.endpoint ?? null,
    })
    return saved
  } catch (error) {
    console.warn(`⚠️ Failed to write ComfyUI request debug snapshot for job ${record.id}:`, error)
    return {
      absolutePath: null,
      relativePath: getComfyRequestDebugRelativePath(record.id),
    }
  }
}
