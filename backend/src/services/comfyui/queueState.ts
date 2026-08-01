import type { ComfyUIQueueState } from '../../types/comfyuiServer';

export type ComfyUIQueueResponse = {
  queue_running?: unknown;
  queue_pending?: unknown;
};

function normalizeQueueEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }

  return [];
}

function extractPromptIdFromQueueEntry(entry: unknown): string | null {
  if (Array.isArray(entry)) {
    if (typeof entry[1] === 'string' && entry[1].trim().length > 0) {
      return entry[1].trim();
    }

    for (const item of entry) {
      const nested = extractPromptIdFromQueueEntry(item);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    if (typeof record.prompt_id === 'string' && record.prompt_id.trim().length > 0) {
      return record.prompt_id.trim();
    }
    if (typeof record.id === 'string' && record.id.trim().length > 0) {
      return record.id.trim();
    }

    for (const value of Object.values(record)) {
      const nested = extractPromptIdFromQueueEntry(value);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

/**
 * ComfyUI 큐 아이템 튜플은 `[index, prompt_id, prompt, extra_data, outputs_to_execute]` 이고
 * index 3 이 우리가 POST 로 넣은 `extra_data` 다(로컬 ComfyUI 실측 확인).
 * `provider_job_id` 가 유실된 경우 이 마커로 우리 잡을 역매칭한다.
 */
export const COMFY_QUEUE_JOB_MARKER_KEY = 'conai_queue_job_id'
const COMFY_QUEUE_ENTRY_EXTRA_DATA_INDEX = 3

export type ComfyUIQueueEntry = {
  promptId: string | null
  conaiQueueJobId: number | null
  clientId: string | null
}

export type ComfyUIQueueEntries = {
  running: ComfyUIQueueEntry[]
  pending: ComfyUIQueueEntry[]
}

function toQueueJobMarkerId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim())
  }

  return null
}

function extractExtraDataFromQueueEntry(entry: unknown): Record<string, unknown> | null {
  if (Array.isArray(entry)) {
    const extraData = entry[COMFY_QUEUE_ENTRY_EXTRA_DATA_INDEX]
    return extraData && typeof extraData === 'object' && !Array.isArray(extraData)
      ? extraData as Record<string, unknown>
      : null
  }

  if (entry && typeof entry === 'object') {
    const extraData = (entry as Record<string, unknown>).extra_data
    return extraData && typeof extraData === 'object' && !Array.isArray(extraData)
      ? extraData as Record<string, unknown>
      : null
  }

  return null
}

function buildQueueEntry(entry: unknown): ComfyUIQueueEntry {
  const extraData = extractExtraDataFromQueueEntry(entry)
  const clientId = typeof extraData?.client_id === 'string' ? extraData.client_id : null

  return {
    promptId: extractPromptIdFromQueueEntry(entry),
    // 마커가 없는 레거시 잡은 `conai-job-<id>` client_id 로 2차 폴백 매칭한다.
    conaiQueueJobId: toQueueJobMarkerId(extraData?.[COMFY_QUEUE_JOB_MARKER_KEY])
      ?? toQueueJobMarkerId(clientId?.replace(/^conai-job-/, '')),
    clientId,
  }
}

/** Extract prompt ids together with our CoNAI job marker from one /queue response. */
export function extractComfyQueueEntries(response: ComfyUIQueueResponse): ComfyUIQueueEntries {
  return {
    running: normalizeQueueEntries(response.queue_running).map(buildQueueEntry),
    pending: normalizeQueueEntries(response.queue_pending).map(buildQueueEntry),
  }
}

function collectPromptIds(entries: unknown[]) {
  const promptIds = new Set<string>();
  for (const entry of entries) {
    const promptId = extractPromptIdFromQueueEntry(entry);
    if (promptId) {
      promptIds.add(promptId);
    }
  }
  return [...promptIds];
}

export function buildComfyUIQueueState(response: ComfyUIQueueResponse): ComfyUIQueueState {
  const runningEntries = normalizeQueueEntries(response.queue_running);
  const pendingEntries = normalizeQueueEntries(response.queue_pending);

  return {
    pending_count: pendingEntries.length,
    running_count: runningEntries.length,
    pending_prompt_ids: collectPromptIds(pendingEntries),
    running_prompt_ids: collectPromptIds(runningEntries),
    is_idle: pendingEntries.length === 0 && runningEntries.length === 0,
  };
}
