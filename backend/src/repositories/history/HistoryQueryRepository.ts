import { apiGenDb } from '../../database/apiGenerationDb';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import type {
  GenerationHistoryDetailRecord,
  GenerationHistoryFilterOptions,
  GenerationHistoryListRecord,
  GenerationHistoryRecord,
  GenerationHistoryStatistics,
  GenerationStatus,
  GenerationWorkflowStatistics,
} from '../../types/generationHistory';
import {
  appendHistoryFilterConditions,
  type HistoryFilterBinding,
} from './historyQueryFilter';

const HISTORY_LIST_COUNT_CACHE_TTL_MS = 3_000;
const HISTORY_LIST_COUNT_CACHE_MAX_ENTRIES = 64;
/** Keep comfortably below SQLite's default 999 binding limit. */
const HISTORY_RESULT_MEDIA_LOOKUP_CHUNK_SIZE = 400;

type HistoryListCountCacheEntry = { expiresAt: number; total: number };
const historyListCountCache = new Map<string, HistoryListCountCacheEntry>();

type HistoryResultMediaView = {
  actual_composite_hash: string | null;
  actual_width: number | null;
  actual_height: number | null;
  actual_mime_type: string | null;
  actual_file_name: string | null;
  result_file_status: 'active' | 'missing' | 'deleted' | null;
  rating_score: number | null;
};

const EMPTY_HISTORY_RESULT_MEDIA_VIEW: HistoryResultMediaView = {
  actual_composite_hash: null,
  actual_width: null,
  actual_height: null,
  actual_mime_type: null,
  actual_file_name: null,
  result_file_status: null,
  rating_score: null,
};

type HistoryResultMediaRow = {
  composite_hash: string;
  file_id: number;
  file_status: 'active' | 'missing' | 'deleted' | null;
  mime_type: string | null;
  original_file_path: string | null;
  media_composite_hash: string | null;
  media_width: number | null;
  media_height: number | null;
  media_rating_score: number | null;
};

/** Replicate `ORDER BY (file_status = 'active') DESC, id DESC LIMIT 1` in memory. */
export function isPreferredHistoryResultFile(
  candidate: HistoryResultMediaRow,
  current: HistoryResultMediaRow,
): boolean {
  const candidateRank = candidate.file_status === 'active' ? 0 : 1;
  const currentRank = current.file_status === 'active' ? 0 : 1;
  if (candidateRank !== currentRank) {
    return candidateRank < currentRank;
  }

  return candidate.file_id > current.file_id;
}

/** Read-only repository for generation-history rows and their media projections. */
export class HistoryQueryRepository {
  static invalidateListCountCache(): void {
    if (historyListCountCache.size > 0) {
      historyListCountCache.clear();
    }
  }

  private static appendHistoryListVisibilityFilter(sql: string): string {
    return `${sql}
      AND NOT (
        gh.generation_status = 'completed'
        AND gh.composite_hash IS NULL
        AND COALESCE(workflow.result_view_mode, '') = 'artifact_explorer'
      )`;
  }

  static findById(id: number): GenerationHistoryRecord | null {
    const record = apiGenDb
      .prepare('SELECT * FROM api_generation_history WHERE id = ?')
      .get(id) as GenerationHistoryRecord | undefined;
    return record || null;
  }

  static findAll(filters: GenerationHistoryFilterOptions = {}): GenerationHistoryRecord[] {
    let sql = 'SELECT * FROM api_generation_history WHERE 1=1';
    const params: HistoryFilterBinding[] = [];

    // Compatibility ruling for Phase 2-1: the legacy plain-row surface ignored
    // `ids`. Preserve that behavior while still using the one shared builder.
    sql = appendHistoryFilterConditions(sql, params, filters, { includeIds: false });

    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDir}, id ${orderDir}`;

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    return apiGenDb.prepare(sql).all(...params) as GenerationHistoryRecord[];
  }

  static count(filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'> = {}): number {
    let sql = 'SELECT COUNT(*) as total FROM api_generation_history WHERE 1=1';
    const params: HistoryFilterBinding[] = [];
    sql = appendHistoryFilterConditions(sql, params, filters);

    const result = apiGenDb.prepare(sql).get(...params) as { total: number } | undefined;
    return result?.total || 0;
  }

  static countListRecords(filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'> = {}): number {
    const cacheKey = JSON.stringify([
      filters.ids ?? null,
      filters.service_type ?? null,
      filters.generation_status ?? null,
      filters.workflow_id ?? null,
      filters.queue_job_id ?? null,
      filters.requested_by_account_id ?? null,
      filters.requested_by_account_type ?? null,
      filters.server_id ?? null,
    ]);
    const now = Date.now();
    const cached = historyListCountCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.total;
    }

    let sql = `
      SELECT COUNT(*) as total
      FROM api_generation_history gh
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      WHERE 1=1
    `;
    const params: HistoryFilterBinding[] = [];
    sql = appendHistoryFilterConditions(sql, params, filters, { tableAlias: 'gh' });
    sql = this.appendHistoryListVisibilityFilter(sql);

    const result = apiGenDb.prepare(sql).get(...params) as { total: number } | undefined;
    const total = result?.total || 0;

    if (historyListCountCache.size >= HISTORY_LIST_COUNT_CACHE_MAX_ENTRIES) {
      const oldestKey = historyListCountCache.keys().next().value;
      if (oldestKey !== undefined) {
        historyListCountCache.delete(oldestKey);
      }
    }

    historyListCountCache.set(cacheKey, { expiresAt: now + HISTORY_LIST_COUNT_CACHE_TTL_MS, total });
    return total;
  }

  static getListStatistics(
    filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'> = {},
  ): GenerationHistoryStatistics {
    let sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN gh.service_type = 'comfyui' THEN 1 ELSE 0 END) as comfyui,
        SUM(CASE WHEN gh.service_type = 'novelai' THEN 1 ELSE 0 END) as novelai,
        SUM(CASE WHEN gh.service_type = 'codex' THEN 1 ELSE 0 END) as codex,
        SUM(CASE WHEN gh.generation_status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN gh.generation_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN gh.generation_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN gh.generation_status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM api_generation_history gh
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      WHERE 1=1
    `;
    const params: HistoryFilterBinding[] = [];
    sql = appendHistoryFilterConditions(sql, params, filters, { tableAlias: 'gh' });
    sql = this.appendHistoryListVisibilityFilter(sql);

    const result = apiGenDb.prepare(sql).get(...params) as Partial<GenerationHistoryStatistics> | undefined;
    return {
      total: result?.total || 0,
      comfyui: result?.comfyui || 0,
      novelai: result?.novelai || 0,
      codex: result?.codex || 0,
      completed: result?.completed || 0,
      failed: result?.failed || 0,
      pending: result?.pending || 0,
      processing: result?.processing || 0,
    };
  }

  static getRecent(limit = 50): GenerationHistoryListRecord[] {
    return this.findAllWithMetadata({ limit, order_by: 'created_at', order_direction: 'DESC' });
  }

  static findByIdWithMetadata(id: number): GenerationHistoryDetailRecord | null {
    const record = apiGenDb.prepare(`
      SELECT
        gh.id,
        gh.service_type,
        gh.generation_status,
        gh.created_at,
        gh.completed_at,
        gh.workflow_id,
        gh.workflow_name,
        gh.nai_model,
        gh.composite_hash,
        gh.error_message,
        gh.queue_job_id,
        gh.requested_by_account_id,
        gh.requested_by_account_type,
        gh.server_id,
        qj.requested_server_id,
        qj.requested_server_tag,
        requested_server.name as requested_server_name,
        qj.assigned_server_id,
        assigned_server.name as assigned_server_name,
        qj.status as queue_status,
        qj.cancel_requested as queue_cancel_requested,
        qj.provider_job_id,
        CASE WHEN matched_file.file_status = 'active' THEN im.composite_hash ELSE NULL END as actual_composite_hash,
        CASE WHEN matched_file.file_status = 'active' THEN im.width ELSE NULL END as actual_width,
        CASE WHEN matched_file.file_status = 'active' THEN im.height ELSE NULL END as actual_height,
        CASE WHEN matched_file.file_status = 'active' THEN matched_file.mime_type ELSE NULL END as actual_mime_type,
        matched_file.file_status as result_file_status,
        CASE WHEN matched_file.file_status = 'active' THEN im.rating_score ELSE NULL END as rating_score
      FROM api_generation_history gh
      LEFT JOIN generation_queue_jobs qj ON qj.id = gh.queue_job_id
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      LEFT JOIN comfyui_servers requested_server ON requested_server.id = qj.requested_server_id
      LEFT JOIN comfyui_servers assigned_server ON assigned_server.id = qj.assigned_server_id
      LEFT JOIN main_db.image_files matched_file ON matched_file.id = (
        SELECT if2.id
        FROM main_db.image_files if2
        WHERE gh.composite_hash IS NOT NULL
          AND if2.composite_hash = gh.composite_hash
        ORDER BY
          CASE WHEN if2.file_status = 'active' THEN 0 ELSE 1 END,
          if2.id DESC
        LIMIT 1
      )
      LEFT JOIN main_db.media_metadata im ON im.composite_hash = matched_file.composite_hash
        AND ${MediaPostprocessVisibilityService.buildReadyCondition('im')}
      WHERE gh.id = ?
      LIMIT 1
    `).get(id) as GenerationHistoryDetailRecord | undefined;
    return record || null;
  }

  static findAllWithMetadata(filters: GenerationHistoryFilterOptions = {}): GenerationHistoryListRecord[] {
    let sql = `
      SELECT
        gh.id,
        gh.service_type,
        gh.generation_status,
        gh.created_at,
        gh.completed_at,
        gh.workflow_id,
        gh.workflow_name,
        gh.nai_model,
        gh.composite_hash,
        gh.error_message,
        gh.queue_job_id,
        gh.requested_by_account_id,
        gh.requested_by_account_type,
        gh.server_id,
        qj.requested_server_id,
        qj.requested_server_tag,
        requested_server.name as requested_server_name,
        qj.assigned_server_id,
        assigned_server.name as assigned_server_name,
        qj.status as queue_status,
        qj.cancel_requested as queue_cancel_requested,
        qj.provider_job_id
      FROM api_generation_history gh
      LEFT JOIN generation_queue_jobs qj ON qj.id = gh.queue_job_id
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      LEFT JOIN comfyui_servers requested_server ON requested_server.id = qj.requested_server_id
      LEFT JOIN comfyui_servers assigned_server ON assigned_server.id = qj.assigned_server_id
      WHERE 1=1
    `;
    const params: HistoryFilterBinding[] = [];
    sql = appendHistoryFilterConditions(sql, params, filters, { tableAlias: 'gh' });
    sql = this.appendHistoryListVisibilityFilter(sql);

    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY gh.${orderBy} ${orderDir}, gh.id ${orderDir}`;

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = apiGenDb.prepare(sql).all(...params) as GenerationHistoryListRecord[];
    return this.attachResultMediaViews(rows);
  }

  private static attachResultMediaViews(rows: GenerationHistoryListRecord[]): GenerationHistoryListRecord[] {
    const compositeHashes = Array.from(new Set(
      rows
        .map((row) => row.composite_hash)
        .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0),
    ));

    const views = this.readResultMediaViews(compositeHashes);
    return rows.map((row) => Object.assign(
      row,
      (row.composite_hash ? views.get(row.composite_hash) : undefined) ?? EMPTY_HISTORY_RESULT_MEDIA_VIEW,
    ));
  }

  private static readResultMediaViews(compositeHashes: string[]): Map<string, HistoryResultMediaView> {
    const views = new Map<string, HistoryResultMediaView>();
    if (compositeHashes.length === 0) {
      return views;
    }

    const preferredRowByHash = new Map<string, HistoryResultMediaRow>();
    for (let start = 0; start < compositeHashes.length; start += HISTORY_RESULT_MEDIA_LOOKUP_CHUNK_SIZE) {
      const chunk = compositeHashes.slice(start, start + HISTORY_RESULT_MEDIA_LOOKUP_CHUNK_SIZE);
      const chunkRows = apiGenDb.prepare(`
        SELECT
          matched_file.composite_hash as composite_hash,
          matched_file.id as file_id,
          matched_file.file_status as file_status,
          matched_file.mime_type as mime_type,
          matched_file.original_file_path as original_file_path,
          im.composite_hash as media_composite_hash,
          im.width as media_width,
          im.height as media_height,
          im.rating_score as media_rating_score
        FROM main_db.image_files matched_file
        LEFT JOIN main_db.media_metadata im ON im.composite_hash = matched_file.composite_hash
          AND ${MediaPostprocessVisibilityService.buildReadyCondition('im')}
        WHERE matched_file.composite_hash IN (${chunk.map(() => '?').join(',')})
      `).all(...chunk) as HistoryResultMediaRow[];

      for (const chunkRow of chunkRows) {
        const current = preferredRowByHash.get(chunkRow.composite_hash);
        if (!current || isPreferredHistoryResultFile(chunkRow, current)) {
          preferredRowByHash.set(chunkRow.composite_hash, chunkRow);
        }
      }
    }

    preferredRowByHash.forEach((row, hash) => {
      const isActiveFile = row.file_status === 'active';
      views.set(hash, {
        actual_composite_hash: isActiveFile ? row.media_composite_hash ?? null : null,
        actual_width: isActiveFile ? row.media_width ?? null : null,
        actual_height: isActiveFile ? row.media_height ?? null : null,
        actual_mime_type: isActiveFile ? row.mime_type ?? null : null,
        actual_file_name: isActiveFile
          ? row.original_file_path?.replace(/\\/g, '/').split('/').at(-1) ?? null
          : null,
        result_file_status: row.file_status ?? null,
        rating_score: isActiveFile ? row.media_rating_score ?? null : null,
      });
    });

    return views;
  }

  static findByWorkflow(
    workflowId: number,
    filters: Omit<GenerationHistoryFilterOptions, 'workflow_id'> = {},
  ): GenerationHistoryRecord[] {
    return this.findAll({ ...filters, workflow_id: workflowId });
  }

  static getWorkflowListStatistics(workflowId: number): GenerationWorkflowStatistics {
    let sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN gh.generation_status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN gh.generation_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN gh.generation_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN gh.generation_status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM api_generation_history gh
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      WHERE gh.workflow_id = ?
    `;
    sql = this.appendHistoryListVisibilityFilter(sql);

    const result = apiGenDb.prepare(sql).get(workflowId) as Partial<GenerationWorkflowStatistics> | undefined;
    return {
      total: result?.total || 0,
      completed: result?.completed || 0,
      failed: result?.failed || 0,
      pending: result?.pending || 0,
      processing: result?.processing || 0,
    };
  }

  static findByStatus(status: GenerationStatus, olderThan?: string): GenerationHistoryRecord[] {
    let sql = 'SELECT * FROM api_generation_history WHERE generation_status = ?';
    const params: HistoryFilterBinding[] = [status];
    if (olderThan) {
      sql += ' AND created_at < ?';
      params.push(olderThan);
    }
    sql += ' ORDER BY created_at DESC, id DESC';
    return apiGenDb.prepare(sql).all(...params) as GenerationHistoryRecord[];
  }

  static findByStatuses(statuses: GenerationStatus[], olderThan?: string): GenerationHistoryRecord[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(',');
    let sql = `SELECT * FROM api_generation_history WHERE generation_status IN (${placeholders})`;
    const params: HistoryFilterBinding[] = [...statuses];
    if (olderThan) {
      sql += ' AND created_at < ?';
      params.push(olderThan);
    }
    sql += ' ORDER BY created_at DESC, id DESC';
    return apiGenDb.prepare(sql).all(...params) as GenerationHistoryRecord[];
  }
}
