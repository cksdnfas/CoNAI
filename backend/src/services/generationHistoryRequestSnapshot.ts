import { COMPACTED_TERMINAL_REQUEST_PAYLOAD, GenerationQueueModel } from '../models/GenerationQueue';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import type { GenerationHistoryDetailRecord, ServiceType } from '../types/generationHistory';
import { isQueueInputRef } from './generation-queue/queueInputStore';

/**
 * Whether the original queue request is still readable.
 * - `available`: the stored request payload was read.
 * - `pruned`: the terminal-payload compaction already replaced it (only the most recent jobs keep theirs).
 * - `missing`: the history row has no queue job, or the job/payload is gone or unreadable.
 */
export type GenerationHistoryRequestPayloadStatus = 'available' | 'pruned' | 'missing';

/** Read-only view of the request behind one history row, used by "reuse from history" in the generation UI. */
export interface GenerationHistoryRequestSnapshot {
  history_id: number;
  service_type: ServiceType;
  workflow_id: number | null;
  workflow_name: string | null;
  queue_job_id: number | null;
  payload_status: GenerationHistoryRequestPayloadStatus;
  /** Submitted request payload without debug bookkeeping, save options, or inline image data. */
  request_payload: Record<string, unknown> | null;
  /** Prompt the result was actually generated with (image metadata, or the legacy history columns). */
  result_prompt: string | null;
  result_negative_prompt: string | null;
}

const OMITTED_TOP_LEVEL_PAYLOAD_KEYS = new Set(['_debug', 'imageSaveOptions']);
const INLINE_DATA_URL_PATTERN = /^data:[^,]*,/i;
// Encoded vibes and legacy inline base64 inputs can be megabytes; no prompt or setting gets near this.
const MAX_SNAPSHOT_STRING_LENGTH = 100_000;
const MAX_SNAPSHOT_DEPTH = 32;

function sanitizeSnapshotValue(value: unknown, depth: number): unknown {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    return null;
  }

  if (typeof value === 'string') {
    return INLINE_DATA_URL_PATTERN.test(value) || value.length > MAX_SNAPSHOT_STRING_LENGTH ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSnapshotValue(entry, depth + 1));
  }

  if (value && typeof value === 'object') {
    // Stored image inputs are server-side references; they are not reusable from the browser.
    if (isQueueInputRef(value)) {
      return null;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (depth === 0 && OMITTED_TOP_LEVEL_PAYLOAD_KEYS.has(key)) {
        continue;
      }
      sanitized[key] = sanitizeSnapshotValue(entry, depth + 1);
    }
    return sanitized;
  }

  return value;
}

function readQueueRequestPayload(queueJobId: number | null | undefined): {
  status: GenerationHistoryRequestPayloadStatus;
  payload: Record<string, unknown> | null;
} {
  if (typeof queueJobId !== 'number') {
    return { status: 'missing', payload: null };
  }

  const job = GenerationQueueModel.findById(queueJobId);
  if (!job || typeof job.request_payload !== 'string') {
    return { status: 'missing', payload: null };
  }

  if (job.request_payload === COMPACTED_TERMINAL_REQUEST_PAYLOAD) {
    return { status: 'pruned', payload: null };
  }

  try {
    const parsed = JSON.parse(job.request_payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'missing', payload: null };
    }

    return {
      status: 'available',
      payload: sanitizeSnapshotValue(parsed, 0) as Record<string, unknown>,
    };
  } catch {
    return { status: 'missing', payload: null };
  }
}

function toTrimmedText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Build the reuse snapshot for one already access-checked history record. */
export function buildGenerationHistoryRequestSnapshot(record: GenerationHistoryDetailRecord): GenerationHistoryRequestSnapshot {
  const historyId = record.id as number;
  const { status, payload } = readQueueRequestPayload(record.queue_job_id);
  const metadata = record.actual_composite_hash ? MediaMetadataModel.findByHash(record.actual_composite_hash) : null;
  // Codex rows keep the submitted prompt in the legacy columns, which the list/detail queries do not select.
  const legacyRow = metadata?.prompt ? null : HistoryQueryRepository.findById(historyId);

  return {
    history_id: historyId,
    service_type: record.service_type,
    workflow_id: record.workflow_id ?? null,
    workflow_name: record.workflow_name ?? null,
    queue_job_id: record.queue_job_id ?? null,
    payload_status: status,
    request_payload: payload,
    result_prompt: toTrimmedText(metadata?.prompt) ?? toTrimmedText(legacyRow?.positive_prompt),
    result_negative_prompt: metadata?.prompt
      ? toTrimmedText(metadata.negative_prompt)
      : toTrimmedText(legacyRow?.negative_prompt),
  };
}
