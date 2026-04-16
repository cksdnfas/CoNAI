import { apiGenDb } from '../database/apiGenerationDb';
import type { AuthAccountType } from './AuthAccount';
import { buildUpdateQuery, filterDefined } from '../utils/dynamicUpdate';

export type ServiceType = 'comfyui' | 'novelai';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
}

export interface GenerationHistoryDetailRecord extends GenerationHistoryRecord {
  // Detail/compat surface for internal consumers. Do not treat this as the primary UI list contract.
  // Keep it explicit and compact. Legacy execution aliases may remain temporarily, but image/path leftovers should disappear first.
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
}

export interface FilterOptions {
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

    return info.lastInsertRowid as number;
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
    const computedFields = ['actual_composite_hash', 'actual_width', 'actual_height'];

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
  }

  /**
   * Delete history record
   */
  static delete(id: number): void {
    const stmt = apiGenDb.prepare('DELETE FROM api_generation_history WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Get total count with filters
   */
  static count(filters: Omit<FilterOptions, 'limit' | 'offset'> = {}): number {
    let sql = 'SELECT COUNT(*) as total FROM api_generation_history WHERE 1=1';
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

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(...params) as { total: number } | undefined;
    return result?.total || 0;
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
        im.composite_hash as actual_composite_hash,
        im.width as actual_width,
        im.height as actual_height,
        im.rating_score as rating_score
      FROM api_generation_history gh
      LEFT JOIN generation_queue_jobs qj ON qj.id = gh.queue_job_id
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
        im.composite_hash as actual_composite_hash,
        im.width as actual_width,
        im.height as actual_height,
        im.rating_score as rating_score
      FROM api_generation_history gh
      LEFT JOIN generation_queue_jobs qj ON qj.id = gh.queue_job_id
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
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.service_type) {
      sql += ' AND gh.service_type = ?';
      params.push(filters.service_type);
    }

    if (filters.generation_status) {
      sql += ' AND gh.generation_status = ?';
      params.push(filters.generation_status);
    }

    if (filters.workflow_id !== undefined) {
      sql += ' AND gh.workflow_id = ?';
      params.push(filters.workflow_id);
    }

    if (filters.queue_job_id !== undefined) {
      sql += ' AND gh.queue_job_id = ?';
      params.push(filters.queue_job_id);
    }

    if (filters.requested_by_account_id !== undefined) {
      sql += ' AND gh.requested_by_account_id = ?';
      params.push(filters.requested_by_account_id);
    }

    if (filters.requested_by_account_type !== undefined) {
      sql += ' AND gh.requested_by_account_type = ?';
      params.push(filters.requested_by_account_type);
    }

    if (filters.server_id !== undefined) {
      sql += ' AND gh.server_id = ?';
      params.push(filters.server_id);
    }

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
    return stmt.all(...params) as any[];
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

    return info.changes;
  }
}
