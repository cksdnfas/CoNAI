import { apiGenDb } from '../database/apiGenerationDb';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import type {
  GenerationHistoryRecord,
  GenerationStatus,
  ServiceType,
} from '../types/generationHistory';
import { buildUpdateQuery, filterDefined } from '../utils/dynamicUpdate';
import { requestGenerationResultRetentionPrune } from './generationResultRetentionService';
import { publishHistoryRecordEvent } from './runtime-events/runtimeEventPublishers';

export type HistoryRecordEventName = 'history.record.created' | 'history.record.status';

interface StoredHistoryEventRow {
  id: number;
  queue_job_id: number | null;
  service_type: ServiceType;
  workflow_id: number | null;
  generation_status: GenerationStatus;
  composite_hash: string | null;
  requested_by_account_id: number | null;
}

/** Publish failures must never roll back or reject a successful history write. */
function publishHistoryEventById(id: number, name: HistoryRecordEventName): void {
  try {
    const row = apiGenDb.prepare(`
      SELECT id, queue_job_id, service_type, workflow_id, generation_status, composite_hash, requested_by_account_id
      FROM api_generation_history
      WHERE id = ?
    `).get(id) as StoredHistoryEventRow | undefined;

    if (!row) {
      return;
    }

    publishHistoryRecordEvent(name, {
      history_id: row.id,
      queue_job_id: row.queue_job_id ?? null,
      service_type: row.service_type,
      workflow_id: row.workflow_id ?? null,
      generation_status: row.generation_status,
      composite_hash: row.composite_hash ?? null,
      requested_by_account_id: row.requested_by_account_id ?? null,
    });
  } catch (error) {
    console.warn(
      `⚠️ Failed to publish generation history event for record ${id}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export interface HistoryCommandSideEffectDependencies {
  invalidateCache: () => void;
  publishEvent: (historyId: number, name: HistoryRecordEventName) => void;
  requestRetention: () => void;
}

const defaultSideEffectDependencies: HistoryCommandSideEffectDependencies = {
  invalidateCache: () => HistoryQueryRepository.invalidateListCountCache(),
  publishEvent: publishHistoryEventById,
  requestRetention: requestGenerationResultRetentionPrune,
};

/**
 * The write-side contract is intentionally centralized and observable:
 * cache invalidation -> SSE event -> terminal-row retention request.
 */
export function runHistoryCommandSideEffects(
  historyIds: number | number[],
  options: { eventName?: HistoryRecordEventName; requestRetention?: boolean } = {},
  dependencies: HistoryCommandSideEffectDependencies = defaultSideEffectDependencies,
): void {
  dependencies.invalidateCache();
  if (options.eventName) {
    publishHistoryEvents(historyIds, options.eventName, dependencies);
  }
  if (options.requestRetention) {
    dependencies.requestRetention();
  }
}

function publishHistoryEvents(
  historyIds: number | number[],
  eventName: HistoryRecordEventName,
  dependencies: HistoryCommandSideEffectDependencies = defaultSideEffectDependencies,
): void {
  const ids = Array.isArray(historyIds) ? historyIds : [historyIds];
  for (const historyId of ids) {
    try {
      dependencies.publishEvent(historyId, eventName);
    } catch (error) {
      console.warn(
        `⚠️ Failed to publish generation history event for record ${historyId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** Write-side service for history rows and their ordered runtime side effects. */
export class HistoryCommandService {
  static create(data: Omit<GenerationHistoryRecord, 'id'>): number {
    const info = apiGenDb.prepare(`
      INSERT INTO api_generation_history (
        service_type, generation_status,
        comfyui_workflow, comfyui_prompt_id, workflow_id, workflow_name,
        nai_model, nai_sampler, nai_seed, nai_steps, nai_scale, nai_parameters,
        positive_prompt, negative_prompt, width, height,
        original_path, file_size, assigned_group_id,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id,
        error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.service_type,
      data.generation_status,
      data.comfyui_workflow,
      data.comfyui_prompt_id,
      data.workflow_id,
      data.workflow_name,
      data.nai_model,
      data.nai_sampler,
      data.nai_seed,
      data.nai_steps,
      data.nai_scale,
      data.nai_parameters,
      data.positive_prompt,
      data.negative_prompt,
      data.width,
      data.height,
      data.original_path,
      data.file_size,
      data.assigned_group_id,
      data.queue_job_id,
      data.requested_by_account_id,
      data.requested_by_account_type,
      data.server_id,
      data.error_message,
      data.metadata,
    );

    const historyId = info.lastInsertRowid as number;
    runHistoryCommandSideEffects(historyId, { eventName: 'history.record.created' });
    return historyId;
  }

  static update(id: number, data: Partial<GenerationHistoryRecord>): void {
    const computedFields = [
      'actual_composite_hash',
      'actual_width',
      'actual_height',
      'actual_mime_type',
      'result_file_status',
      'rating_score',
    ];
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key]) => key !== 'id' && !computedFields.includes(key)),
    );
    const updates = filterDefined(cleanData);
    if (Object.keys(updates).length === 0) {
      return;
    }

    const { sql, values } = buildUpdateQuery('api_generation_history', updates, { id });
    apiGenDb.prepare(sql).run(...values);

    const status = updates.generation_status;
    const hasStatusTransition = typeof status === 'string';
    runHistoryCommandSideEffects(id, {
      eventName: hasStatusTransition ? 'history.record.status' : undefined,
      requestRetention: status === 'completed' || status === 'failed',
    });
  }

  static updateStatus(id: number, status: GenerationStatus): void {
    apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = ?,
          completed_at = CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `).run(status, status, id);

    runHistoryCommandSideEffects(id, {
      eventName: 'history.record.status',
      requestRetention: status === 'completed' || status === 'failed',
    });
  }

  static updateImagePaths(id: number, paths: { compositeHash?: string }): void {
    apiGenDb.prepare(`
      UPDATE api_generation_history
      SET composite_hash = ?
      WHERE id = ?
    `).run(paths.compositeHash || null, id);

    runHistoryCommandSideEffects(id, { eventName: 'history.record.status' });
  }

  static publishStatusEventsByCompositeHashes(compositeHashes: string[]): void {
    const uniqueHashes = Array.from(new Set(
      compositeHashes.filter((hash): hash is string => typeof hash === 'string' && hash.length > 0),
    ));
    if (uniqueHashes.length === 0) {
      return;
    }

    const rows: Array<{ id: number; requested_by_account_id: number | null }> = [];
    const lookupChunkSize = 400;
    for (let start = 0; start < uniqueHashes.length; start += lookupChunkSize) {
      const chunk = uniqueHashes.slice(start, start + lookupChunkSize);
      rows.push(...apiGenDb.prepare(`
        SELECT id, requested_by_account_id
        FROM api_generation_history
        WHERE composite_hash IN (${chunk.map(() => '?').join(',')})
      `).all(...chunk) as Array<{ id: number; requested_by_account_id: number | null }>);
    }

    const nullRequesterRow = rows.find((row) => row.requested_by_account_id === null);
    const representativeRows = nullRequesterRow
      ? [nullRequesterRow]
      : Array.from(new Map(rows.map((row) => [row.requested_by_account_id, row])).values());

    publishHistoryEvents(
      representativeRows.map((row) => row.id),
      'history.record.status',
    );
  }

  static recordError(id: number, errorMessage: string): void {
    apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = 'failed',
          error_message = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(errorMessage, id);

    runHistoryCommandSideEffects(id, {
      eventName: 'history.record.status',
      requestRetention: true,
    });
  }

  static recordErrorByQueueJobIds(queueJobIds: number[], errorMessage: string): number {
    const uniqueJobIds = Array.from(new Set(
      queueJobIds.filter((id) => Number.isInteger(id) && id > 0),
    ));
    if (uniqueJobIds.length === 0) {
      return 0;
    }

    const placeholders = uniqueJobIds.map(() => '?').join(',');
    const affectedIds = (apiGenDb.prepare(`
      SELECT id
      FROM api_generation_history
      WHERE queue_job_id IN (${placeholders})
        AND generation_status IN ('pending', 'processing')
    `).all(...uniqueJobIds) as Array<{ id: number }>).map((row) => row.id);

    const info = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = 'failed',
          error_message = ?,
          completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
      WHERE queue_job_id IN (${placeholders})
        AND generation_status IN ('pending', 'processing')
    `).run(errorMessage, ...uniqueJobIds);

    runHistoryCommandSideEffects(affectedIds, {
      eventName: 'history.record.status',
      requestRetention: info.changes > 0,
    });
    return info.changes;
  }

  static delete(id: number): void {
    apiGenDb.prepare('DELETE FROM api_generation_history WHERE id = ?').run(id);
    runHistoryCommandSideEffects(id);
  }

  static deleteByCompositeHash(compositeHash: string): number {
    const info = apiGenDb
      .prepare('DELETE FROM api_generation_history WHERE composite_hash = ?')
      .run(compositeHash);
    runHistoryCommandSideEffects([]);
    return info.changes;
  }

  static deleteMany(ids: number[]): number {
    if (ids.length === 0) {
      return 0;
    }

    const placeholders = ids.map(() => '?').join(',');
    const info = apiGenDb
      .prepare(`DELETE FROM api_generation_history WHERE id IN (${placeholders})`)
      .run(...ids);
    runHistoryCommandSideEffects(ids);
    return info.changes;
  }
}
