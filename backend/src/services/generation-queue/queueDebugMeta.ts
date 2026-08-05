import { GenerationQueueModel } from '../../models/GenerationQueue'
import { getComfyRequestDebugRelativePath, writeComfyRequestDebugSnapshot, type ComfyRequestDebugSnapshot } from '../generationRequestDebugService'

/**
 * PAYLOAD-2: 디버그 상태는 `debug_enabled` / `debug_meta` 컬럼이 1차 출처다.
 *
 * 예전에는 플래그 한 번 읽자고 멀티 MB `request_payload` 를 통째로 파싱했고,
 * 메타 한 줄 쓰자고 페이로드 전체를 다시 직렬화해 행에 재기록했다.
 * 이제 읽기는 좁은 컬럼 SELECT 하나, 쓰기는 작은 JSON UPDATE 하나다.
 *
 * 029 이전 행은 모델의 SQL 폴백(`request_payload._debug` 를 SQLite 안에서 json_extract)이
 * 그대로 답을 주므로 하위 호환이 유지된다.
 */

/** 잡 식별자만 있으면 되는 최소 입력. 전체 레코드든 경량 리스트 레코드든 받는다. */
type QueueDebugTarget = { id: number }

function isQueueDetailedDebugEnabled(record: QueueDebugTarget) {
  return GenerationQueueModel.isDetailedDebugEnabled(record.id)
}

/** Read the debug metadata bag for one queue job (column first, legacy payload `_debug` as fallback). */
export function readQueueDebugMeta(jobId: number) {
  return GenerationQueueModel.readDebugMeta(jobId)
}

export function updateQueueRequestDebugMeta(record: QueueDebugTarget, meta: Record<string, unknown>) {
  try {
    GenerationQueueModel.updateDebugMeta(record.id, meta)
  } catch (error) {
    console.warn(`⚠️ Failed to persist queue debug metadata for job ${record.id}:`, error)
  }
}

export async function writeQueueComfyDebugSnapshot(record: QueueDebugTarget, snapshot: ComfyRequestDebugSnapshot) {
  if (!isQueueDetailedDebugEnabled(record)) {
    return {
      absolutePath: null,
      relativePath: null,
    }
  }

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
