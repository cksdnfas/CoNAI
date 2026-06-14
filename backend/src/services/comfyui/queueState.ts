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
