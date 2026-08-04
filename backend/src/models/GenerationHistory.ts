import { apiGenDb } from '../database/apiGenerationDb';
import type { AuthAccountType } from './AuthAccount';
import { buildUpdateQuery, filterDefined } from '../utils/dynamicUpdate';
import { MediaPostprocessVisibilityService } from '../services/mediaPostprocessVisibilityService';
import { publishHistoryRecordEvent } from '../services/runtime-events/runtimeEventPublishers';
import { requestGenerationResultRetentionPrune } from '../services/generationResultRetentionService';

export type ServiceType = 'comfyui' | 'novelai' | 'codex';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Publish one runtime history event for the stored row.
 *
 * 히스토리 상태 쓰기 호출부가 20곳 넘게 흩어져 있어 예외적으로 모델 레이어에서 발행한다.
 * payload 가 전이 전 상태를 필요로 하지 않으므로 모델 내부 발행이 안전하다.
 */
function publishHistoryEventById(id: number, name: 'history.record.created' | 'history.record.status'): void {
  try {
    const row = apiGenDb.prepare(`
      SELECT id, queue_job_id, service_type, workflow_id, generation_status, composite_hash, requested_by_account_id
      FROM api_generation_history
      WHERE id = ?
    `).get(id) as {
      id: number;
      queue_job_id: number | null;
      service_type: ServiceType;
      workflow_id: number | null;
      generation_status: GenerationStatus;
      composite_hash: string | null;
      requested_by_account_id: number | null;
    } | undefined;

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
    console.warn(`⚠️ Failed to publish generation history event for record ${id}:`, error instanceof Error ? error.message : error);
  }
}

export interface GenerationHistoryRecord {
  id?: number;

  // Basic Info
  service_type: ServiceType;
  generation_status: GenerationStatus;
  created_at?: string;
  completed_at?: string;

  // Core result-index / traceability fields
  workflow_id?: number;             // Workflow reference for ComfyUI
  workflow_name?: string;           // Optional display-friendly denormalized name
  nai_model?: string;               // Optional display-friendly denormalized model label
  composite_hash?: string;          // Key used to resolve the real image from the main image DB
  queue_job_id?: number;
  requested_by_account_id?: number;
  requested_by_account_type?: AuthAccountType;
  server_id?: number;
  error_message?: string;

  // Transitional compatibility fields, kept only for detail/compat surfaces while old rows still exist
  width?: number;
  height?: number;
  original_path?: string;
  file_size?: number;
  assigned_group_id?: number;       // User-selected group for automatic assignment
  metadata?: string;                // JSON string
  comfyui_workflow?: string;        // JSON string (legacy, avoid new dependence where possible)

  // Legacy compatibility fields, not preferred for result-focused history reads
  comfyui_prompt_id?: string;       // Legacy compatibility alias only, prefer queue/runtime provider_job_id
  nai_sampler?: string;
  nai_seed?: number;
  nai_steps?: number;
  nai_scale?: number;
  nai_parameters?: string;          // JSON string
  positive_prompt?: string;
  negative_prompt?: string;
}

export interface GenerationHistoryListRecord extends GenerationHistoryRecord {
  // Compact list surface used by result-focused history UIs.
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  actual_mime_type?: string | null;
  result_file_status?: 'active' | 'missing' | 'deleted' | null;
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
  queue_status?: 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  queue_cancel_requested?: number | null;
  provider_job_id?: string | null;
}

export interface GenerationHistoryDetailRecord extends GenerationHistoryRecord {
  // Detail/compat surface for internal consumers. Do not treat this as the primary UI list contract.
  // Keep it explicit and compact. Legacy execution aliases may remain temporarily, but image/path leftovers should disappear first.
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  actual_mime_type?: string | null;
  result_file_status?: 'active' | 'missing' | 'deleted' | null;
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
  queue_status?: 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  queue_cancel_requested?: number | null;
  provider_job_id?: string | null;
}

/**
 * 히스토리 목록 카운트 캐시 TTL.
 *
 * `countListRecords` 는 페이지 요청마다 `COUNT(*) + LEFT JOIN workflows` 를 돌린다.
 * 큐 활성 구간에서 N명이 3초 폴링하면 그대로 N배가 되므로 짧은 TTL 로 상수화한다.
 * 히스토리 쓰기(생성/상태 전이/삭제)는 즉시 무효화하므로 TTL 은 "쓰기 없이 흐른 시간"에만 적용된다.
 */
const HISTORY_LIST_COUNT_CACHE_TTL_MS = 3_000;
const HISTORY_LIST_COUNT_CACHE_MAX_ENTRIES = 64;
/** `IN (...)` 바인딩 상한(SQLite 기본 999)보다 넉넉히 낮게 자른다. */
const HISTORY_RESULT_MEDIA_LOOKUP_CHUNK_SIZE = 400;

type HistoryListCountCacheEntry = { expiresAt: number; total: number };
const historyListCountCache = new Map<string, HistoryListCountCacheEntry>();
let historyListCountCacheStats = { hits: 0, misses: 0, invalidations: 0 };

/** Drop every cached history list count. Called from every history write path. */
function invalidateHistoryListCountCache(): void {
  if (historyListCountCache.size > 0) {
    historyListCountCache.clear();
  }

  historyListCountCacheStats.invalidations += 1;
}

/** Report history count cache effectiveness for diagnostics and smoke runs. */
export function getGenerationHistoryListCountCacheStats() {
  return { ...historyListCountCacheStats, entries: historyListCountCache.size, ttl_ms: HISTORY_LIST_COUNT_CACHE_TTL_MS };
}

/** Reset history count cache state for contract smoke runs. */
export function resetGenerationHistoryListCountCacheForTests(): void {
  historyListCountCache.clear();
  historyListCountCacheStats = { hits: 0, misses: 0, invalidations: 0 };
}

/**
 * Resolved main-image view for one history row.
 * `findAllWithMetadata` 가 행별 상관 서브쿼리 대신 한 번의 사전 조회로 채운다.
 */
type HistoryResultMediaView = {
  actual_composite_hash: string | null;
  actual_width: number | null;
  actual_height: number | null;
  actual_mime_type: string | null;
  result_file_status: 'active' | 'missing' | 'deleted' | null;
  rating_score: number | null;
};

const EMPTY_HISTORY_RESULT_MEDIA_VIEW: HistoryResultMediaView = {
  actual_composite_hash: null,
  actual_width: null,
  actual_height: null,
  actual_mime_type: null,
  result_file_status: null,
  rating_score: null,
};

type HistoryResultMediaRow = {
  composite_hash: string;
  file_id: number;
  file_status: 'active' | 'missing' | 'deleted' | null;
  mime_type: string | null;
  media_composite_hash: string | null;
  media_width: number | null;
  media_height: number | null;
  media_rating_score: number | null;
};

/** Replicate `ORDER BY (file_status = 'active') DESC, id DESC LIMIT 1` in memory. */
function isPreferredResultFile(candidate: HistoryResultMediaRow, current: HistoryResultMediaRow): boolean {
  const candidateRank = candidate.file_status === 'active' ? 0 : 1;
  const currentRank = current.file_status === 'active' ? 0 : 1;
  if (candidateRank !== currentRank) {
    return candidateRank < currentRank;
  }

  return candidate.file_id > current.file_id;
}

export interface FilterOptions {
  ids?: number[];
  service_type?: ServiceType;
  generation_status?: GenerationStatus;
  workflow_id?: number;             // Filter by workflow (ComfyUI only)
  queue_job_id?: number;
  requested_by_account_id?: number;
  requested_by_account_type?: AuthAccountType;
  server_id?: number;
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'completed_at';
  order_direction?: 'ASC' | 'DESC';
}

/**
 * GenerationHistory Model
 * Manages API generation history records (ComfyUI and NovelAI)
 * Separated from main image management system
 * Uses better-sqlite3 synchronous API
 */
export class GenerationHistoryModel {
  private static appendFilterConditions(
    sql: string,
    params: any[],
    filters: Omit<FilterOptions, 'limit' | 'offset'>,
    tableAlias = '',
  ): string {
    const columnPrefix = tableAlias ? `${tableAlias}.` : '';

    if (filters.ids && filters.ids.length > 0) {
      sql += ` AND ${columnPrefix}id IN (${filters.ids.map(() => '?').join(',')})`;
      params.push(...filters.ids);
    }

    if (filters.service_type) {
      sql += ` AND ${columnPrefix}service_type = ?`;
      params.push(filters.service_type);
    }

    if (filters.generation_status) {
      sql += ` AND ${columnPrefix}generation_status = ?`;
      params.push(filters.generation_status);
    }

    if (filters.workflow_id !== undefined) {
      sql += ` AND ${columnPrefix}workflow_id = ?`;
      params.push(filters.workflow_id);
    }

    if (filters.queue_job_id !== undefined) {
      sql += ` AND ${columnPrefix}queue_job_id = ?`;
      params.push(filters.queue_job_id);
    }

    if (filters.requested_by_account_id !== undefined) {
      sql += ` AND ${columnPrefix}requested_by_account_id = ?`;
      params.push(filters.requested_by_account_id);
    }

    if (filters.requested_by_account_type !== undefined) {
      sql += ` AND ${columnPrefix}requested_by_account_type = ?`;
      params.push(filters.requested_by_account_type);
    }

    if (filters.server_id !== undefined) {
      sql += ` AND ${columnPrefix}server_id = ?`;
      params.push(filters.server_id);
    }

    return sql;
  }

  private static appendHistoryListVisibilityFilter(sql: string): string {
    return `${sql}
      AND NOT (
        gh.generation_status = 'completed'
        AND gh.composite_hash IS NULL
        AND COALESCE(workflow.result_view_mode, '') = 'artifact_explorer'
      )`;
  }

  /**
   * Create a new generation history record
   */
  static create(data: Omit<GenerationHistoryRecord, 'id'>): number {
    const stmt = apiGenDb.prepare(`
      INSERT INTO api_generation_history (
        service_type, generation_status,
        comfyui_workflow, comfyui_prompt_id, workflow_id, workflow_name,
        nai_model, nai_sampler, nai_seed, nai_steps, nai_scale, nai_parameters,
        positive_prompt, negative_prompt, width, height,
        original_path, file_size, assigned_group_id,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id,
        error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
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
      data.metadata
    );

    const historyId = info.lastInsertRowid as number;
    invalidateHistoryListCountCache();
    // E13: 신규 히스토리 행. 서비스/라우트/MCP 의 모든 생성 경로가 이 한 곳을 지난다.
    publishHistoryEventById(historyId, 'history.record.created');
    return historyId;
  }

  /**
   * Find history record by ID
   */
  static findById(id: number): GenerationHistoryRecord | null {
    const stmt = apiGenDb.prepare('SELECT * FROM api_generation_history WHERE id = ?');
    const record = stmt.get(id) as GenerationHistoryRecord | undefined;
    return record || null;
  }

  /**
   * Find all records with optional filters
   */
  static findAll(filters: FilterOptions = {}): GenerationHistoryRecord[] {
    let sql = 'SELECT * FROM api_generation_history WHERE 1=1';
    const params: any[] = [];

    if (filters.service_type) {
      sql += ' AND service_type = ?';
      params.push(filters.service_type);
    }

    if (filters.generation_status) {
      sql += ' AND generation_status = ?';
      params.push(filters.generation_status);
    }

    if (filters.workflow_id !== undefined) {
      sql += ' AND workflow_id = ?';
      params.push(filters.workflow_id);
    }

    if (filters.queue_job_id !== undefined) {
      sql += ' AND queue_job_id = ?';
      params.push(filters.queue_job_id);
    }

    if (filters.requested_by_account_id !== undefined) {
      sql += ' AND requested_by_account_id = ?';
      params.push(filters.requested_by_account_id);
    }

    if (filters.requested_by_account_type !== undefined) {
      sql += ' AND requested_by_account_type = ?';
      params.push(filters.requested_by_account_type);
    }

    if (filters.server_id !== undefined) {
      sql += ' AND server_id = ?';
      params.push(filters.server_id);
    }

    // Order by
    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDir}, id ${orderDir}`;

    // Pagination
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = apiGenDb.prepare(sql);
    return stmt.all(...params) as GenerationHistoryRecord[];
  }

  /**
   * Update generation history record
   */
  static update(id: number, data: Partial<GenerationHistoryRecord>): void {
    // JOIN으로 계산된 필드 필터링 (actual_* 필드는 테이블에 없음)
    const computedFields = ['actual_composite_hash', 'actual_width', 'actual_height', 'actual_mime_type', 'result_file_status', 'rating_score'];

    // id와 computed fields 제거
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key]) => key !== 'id' && !computedFields.includes(key))
    );

    const updates = filterDefined(cleanData);

    if (Object.keys(updates).length === 0) {
      return;
    }

    const { sql, values } = buildUpdateQuery('api_generation_history', updates, { id });
    const stmt = apiGenDb.prepare(sql);
    stmt.run(...values);
    invalidateHistoryListCountCache();

    if (updates.generation_status === 'completed' || updates.generation_status === 'failed') {
      requestGenerationResultRetentionPrune();
    }
  }

  /**
   * Update generation status
   */
  static updateStatus(id: number, status: GenerationStatus): void {
    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = ?,
          completed_at = CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `);
    stmt.run(status, status, id);
    invalidateHistoryListCountCache();
    // E10
    publishHistoryEventById(id, 'history.record.status');
    if (status === 'completed' || status === 'failed') {
      requestGenerationResultRetentionPrune();
    }
  }

  /**
   * Update main-image linkage after processing.
   * History should keep only the composite hash and resolve image details from the main DB.
   */
  static updateImagePaths(
    id: number,
    paths: {
      compositeHash?: string;
    }
  ): void {
    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET composite_hash = ?
      WHERE id = ?
    `);
    stmt.run(paths.compositeHash || null, id);
    invalidateHistoryListCountCache();
    // E11: composite_hash 확정은 히스토리 카드가 실제 미디어로 바뀌는 순간이다.
    publishHistoryEventById(id, 'history.record.status');
  }

  /**
   * Record error message
   */
  static recordError(id: number, errorMessage: string): void {
    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = 'failed',
          error_message = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(errorMessage, id);
    invalidateHistoryListCountCache();
    // E12
    publishHistoryEventById(id, 'history.record.status');
    requestGenerationResultRetentionPrune();
  }

  /** Mark in-flight histories linked to terminal queue jobs as failed. */
  static recordErrorByQueueJobIds(queueJobIds: number[], errorMessage: string): number {
    const uniqueJobIds = Array.from(new Set(queueJobIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueJobIds.length === 0) {
      return 0;
    }

    const placeholders = uniqueJobIds.map(() => '?').join(',');
    // 전이 대상 id 를 먼저 확보해야 UPDATE 이후 개별 이벤트를 발행할 수 있다.
    const affectedIds = (apiGenDb.prepare(`
      SELECT id
      FROM api_generation_history
      WHERE queue_job_id IN (${placeholders})
        AND generation_status IN ('pending', 'processing')
    `).all(...uniqueJobIds) as Array<{ id: number }>).map((row) => row.id);

    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET generation_status = 'failed',
          error_message = ?,
          completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
      WHERE queue_job_id IN (${placeholders})
        AND generation_status IN ('pending', 'processing')
    `);
    const info = stmt.run(errorMessage, ...uniqueJobIds);
    invalidateHistoryListCountCache();
    // E12: 큐 잡 단위 일괄 실패도 행별로 알린다.
    affectedIds.forEach((historyId) => publishHistoryEventById(historyId, 'history.record.status'));
    if (info.changes > 0) {
      requestGenerationResultRetentionPrune();
    }
    return info.changes;
  }

  /**
   * Delete history record
   */
  static delete(id: number): void {
    const stmt = apiGenDb.prepare('DELETE FROM api_generation_history WHERE id = ?');
    stmt.run(id);
    invalidateHistoryListCountCache();
  }

  /**
   * Delete every history row linked to a main-image composite hash.
   * Used when the image record itself is removed so history does not keep a
   * completed-but-unresolvable row that the UI renders as still processing.
   */
  static deleteByCompositeHash(compositeHash: string): number {
    const stmt = apiGenDb.prepare('DELETE FROM api_generation_history WHERE composite_hash = ?');
    const info = stmt.run(compositeHash);
    invalidateHistoryListCountCache();
    return info.changes;
  }

  /**
   * Get total count with filters
   */
  static count(filters: Omit<FilterOptions, 'limit' | 'offset'> = {}): number {
    let sql = 'SELECT COUNT(*) as total FROM api_generation_history WHERE 1=1';
    const params: any[] = [];

    sql = this.appendFilterConditions(sql, params, filters);

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(...params) as { total: number } | undefined;
    return result?.total || 0;
  }

  /**
   * Count rows visible in compact history-list surfaces.
   */
  static countListRecords(filters: Omit<FilterOptions, 'limit' | 'offset'> = {}): number {
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
      historyListCountCacheStats.hits += 1;
      return cached.total;
    }

    historyListCountCacheStats.misses += 1;

    let sql = `
      SELECT COUNT(*) as total
      FROM api_generation_history gh
      LEFT JOIN workflows workflow ON workflow.id = gh.workflow_id
      WHERE 1=1
    `;
    const params: any[] = [];

    sql = this.appendFilterConditions(sql, params, filters, 'gh');
    sql = this.appendHistoryListVisibilityFilter(sql);

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(...params) as { total: number } | undefined;
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

  /**
   * Aggregate rows visible in compact history-list surfaces.
   */
  static getListStatistics(filters: Omit<FilterOptions, 'limit' | 'offset'> = {}): {
    total: number;
    comfyui: number;
    novelai: number;
    codex: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  } {
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
    const params: any[] = [];

    sql = this.appendFilterConditions(sql, params, filters, 'gh');
    sql = this.appendHistoryListVisibilityFilter(sql);

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(...params) as {
      total?: number | null;
      comfyui?: number | null;
      novelai?: number | null;
      codex?: number | null;
      completed?: number | null;
      failed?: number | null;
      pending?: number | null;
      processing?: number | null;
    } | undefined;

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

  /**
   * Get recent history (last 50 records)
   */
  static getRecent(limit: number = 50): GenerationHistoryListRecord[] {
    return this.findAllWithMetadata({ limit, order_by: 'created_at', order_direction: 'DESC' });
  }

  /**
   * Find one explicit detail/compat history record with main-DB display metadata.
   * This stays broader than the main list surface, but should not auto-expose every legacy blob column.
   * Uses ATTACH DATABASE for cross-database queries (main_db = images.db)
   */
  static findByIdWithMetadata(id: number): GenerationHistoryDetailRecord | null {
    const stmt = apiGenDb.prepare(`
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
    `);
    const record = stmt.get(id) as GenerationHistoryDetailRecord | undefined;
    return record || null;
  }

  /**
   * Find compact history-list records with metadata from image_files and media_metadata tables.
   * This list path intentionally stays result-index focused and avoids shipping legacy prompt/sampler payload fields.
   * Uses ATTACH DATABASE for cross-database queries (main_db = images.db)
   */
  static findAllWithMetadata(filters: FilterOptions = {}): GenerationHistoryListRecord[] {
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
    const params: any[] = [];

    sql = this.appendFilterConditions(sql, params, filters, 'gh');
    sql = this.appendHistoryListVisibilityFilter(sql);

    // Order by
    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY gh.${orderBy} ${orderDir}, gh.id ${orderDir}`;

    // Pagination
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = apiGenDb.prepare(sql);
    const rows = stmt.all(...params) as GenerationHistoryListRecord[];
    return this.attachResultMediaViews(rows);
  }

  /**
   * Resolve display media for one page of history rows in a single indexed lookup.
   *
   * 종전에는 `LEFT JOIN main_db.image_files ON id = (상관 서브쿼리)` 가 **행마다** 실행돼
   * 20만행 `image_files` 를 반복 탐색했다. 페이지의 composite_hash 집합을 모아 한 번만
   * 조회하고(`idx_files_composite_hash` SEARCH), 우선순위(active 우선 → id 내림차순)를
   * 메모리에서 적용해 종전 SQL 과 동일한 결과를 만든다.
   */
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

  /** Read the preferred backing file + ready media metadata for each composite hash. */
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
        if (!current || isPreferredResultFile(chunkRow, current)) {
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
        result_file_status: row.file_status ?? null,
        rating_score: isActiveFile ? row.media_rating_score ?? null : null,
      });
    });

    return views;
  }

  /**
   * Find records by workflow ID
   * @param workflowId - Workflow ID to filter by
   * @param filters - Additional filters
   */
  static findByWorkflow(workflowId: number, filters: Omit<FilterOptions, 'workflow_id'> = {}): GenerationHistoryRecord[] {
    return this.findAll({ ...filters, workflow_id: workflowId });
  }

  /**
   * Get workflow statistics
   * @param workflowId - Workflow ID to get statistics for
   */
  static getWorkflowStatistics(workflowId: number): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  } {
    const stmt = apiGenDb.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN generation_status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN generation_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN generation_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN generation_status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM api_generation_history
      WHERE workflow_id = ?
    `);

    const result = stmt.get(workflowId) as any;
    return {
      total: result?.total || 0,
      completed: result?.completed || 0,
      failed: result?.failed || 0,
      pending: result?.pending || 0,
      processing: result?.processing || 0
    };
  }

  /**
   * Get workflow statistics for compact history-list surfaces.
   */
  static getWorkflowListStatistics(workflowId: number): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  } {
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

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(workflowId) as any;
    return {
      total: result?.total || 0,
      completed: result?.completed || 0,
      failed: result?.failed || 0,
      pending: result?.pending || 0,
      processing: result?.processing || 0
    };
  }

  /**
   * Find records by status with optional time filter
   * Used by cleanup service to find old failed records
   * @param status - Generation status to filter by
   * @param olderThan - ISO timestamp, return records created before this time
   */
  static findByStatus(status: GenerationStatus, olderThan?: string): GenerationHistoryRecord[] {
    let sql = 'SELECT * FROM api_generation_history WHERE generation_status = ?';
    const params: any[] = [status];

    if (olderThan) {
      sql += ' AND created_at < ?';
      params.push(olderThan);
    }

    sql += ' ORDER BY created_at DESC, id DESC';

    const stmt = apiGenDb.prepare(sql);
    return stmt.all(...params) as GenerationHistoryRecord[];
  }

  /**
   * Find records by multiple statuses with optional time filter
   * Used by cleanup service to find stale pending/processing records
   * @param statuses - Array of generation statuses to filter by
   * @param olderThan - ISO timestamp, return records created before this time
   */
  static findByStatuses(statuses: GenerationStatus[], olderThan?: string): GenerationHistoryRecord[] {
    if (statuses.length === 0) return [];

    const placeholders = statuses.map(() => '?').join(',');
    let sql = `SELECT * FROM api_generation_history WHERE generation_status IN (${placeholders})`;
    const params: any[] = [...statuses];

    if (olderThan) {
      sql += ' AND created_at < ?';
      params.push(olderThan);
    }

    sql += ' ORDER BY created_at DESC, id DESC';

    const stmt = apiGenDb.prepare(sql);
    return stmt.all(...params) as GenerationHistoryRecord[];
  }

  /**
   * Delete multiple records by IDs
   * Used by cleanup service for batch deletion
   * @param ids - Array of record IDs to delete
   * @returns Number of records deleted
   */
  static deleteMany(ids: number[]): number {
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM api_generation_history WHERE id IN (${placeholders})`;
    const stmt = apiGenDb.prepare(sql);
    const info = stmt.run(...ids);
    invalidateHistoryListCountCache();

    return info.changes;
  }

}
