import { apiGenDb } from '../database/apiGenerationDb';

export type ServiceType = 'comfyui' | 'novelai';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationHistoryRecord {
  id?: number;

  // Basic Info
  service_type: ServiceType;
  generation_status: GenerationStatus;
  created_at?: string;
  completed_at?: string;

  // ComfyUI Specific
  comfyui_workflow?: string;        // JSON string
  comfyui_prompt_id?: string;
  workflow_id?: number;             // Workflow reference for ComfyUI
  workflow_name?: string;           // Workflow name (denormalized for fast display)

  // NovelAI Specific
  nai_model?: string;
  nai_sampler?: string;
  nai_seed?: number;
  nai_steps?: number;
  nai_scale?: number;
  nai_parameters?: string;          // JSON string

  // Common Fields
  positive_prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;

  // Image Paths
  original_path?: string;
  thumbnail_path?: string;
  optimized_path?: string;
  file_size?: number;

  // Link to main images DB
  linked_image_id?: number;

  // Group Assignment
  assigned_group_id?: number;       // User-selected group for automatic assignment

  // Error and Metadata
  error_message?: string;
  metadata?: string;                // JSON string
}

export interface FilterOptions {
  service_type?: ServiceType;
  generation_status?: GenerationStatus;
  workflow_id?: number;             // Filter by workflow (ComfyUI only)
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
        original_path, thumbnail_path, optimized_path, file_size,
        linked_image_id, assigned_group_id, error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.thumbnail_path,
      data.optimized_path,
      data.file_size,
      data.linked_image_id,
      data.assigned_group_id,
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

    // Order by
    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDir}`;

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
    const fields: string[] = [];
    const params: any[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'id' && value !== undefined) {
        fields.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (fields.length === 0) {
      return;
    }

    params.push(id);
    const sql = `UPDATE api_generation_history SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = apiGenDb.prepare(sql);
    stmt.run(...params);
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
   * Update image paths after processing
   */
  static updateImagePaths(
    id: number,
    paths: {
      original: string;
      thumbnail: string;
      optimized: string;
      fileSize: number;
    }
  ): void {
    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET original_path = ?,
          thumbnail_path = ?,
          optimized_path = ?,
          file_size = ?
      WHERE id = ?
    `);
    stmt.run(paths.original, paths.thumbnail, paths.optimized, paths.fileSize, id);
  }

  /**
   * Link to main images DB record
   */
  static linkToImage(historyId: number, imageId: number): void {
    const stmt = apiGenDb.prepare('UPDATE api_generation_history SET linked_image_id = ? WHERE id = ?');
    stmt.run(imageId, historyId);
  }

  /**
   * Update metadata fields (extracted from ComfyUI images)
   */
  static updateMetadata(
    id: number,
    metadata: {
      positive_prompt?: string;
      negative_prompt?: string;
      width?: number;
      height?: number;
      metadata?: string;
    }
  ): void {
    const stmt = apiGenDb.prepare(`
      UPDATE api_generation_history
      SET positive_prompt = ?,
          negative_prompt = ?,
          width = ?,
          height = ?,
          metadata = ?
      WHERE id = ?
    `);

    stmt.run(
      metadata.positive_prompt || null,
      metadata.negative_prompt || null,
      metadata.width || null,
      metadata.height || null,
      metadata.metadata || null,
      id
    );
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

    const stmt = apiGenDb.prepare(sql);
    const result = stmt.get(...params) as { total: number } | undefined;
    return result?.total || 0;
  }

  /**
   * Get recent history (last 50 records)
   */
  static getRecent(limit: number = 50): GenerationHistoryRecord[] {
    return this.findAll({ limit, order_by: 'created_at', order_direction: 'DESC' });
  }

  /**
   * Find history record by ID with metadata from image_files and image_metadata tables
   * Returns history with actual composite_hash, thumbnails, and metadata if available
   * Uses ATTACH DATABASE for cross-database queries (main_db = images.db)
   */
  static findByIdWithMetadata(id: number): (GenerationHistoryRecord & {
    actual_composite_hash?: string | null;
    actual_thumbnail_path?: string | null;
    actual_optimized_path?: string | null;
  }) | null {
    const stmt = apiGenDb.prepare(`
      SELECT
        gh.*,
        if.composite_hash as actual_composite_hash,
        im.thumbnail_path as actual_thumbnail_path,
        im.optimized_path as actual_optimized_path
      FROM api_generation_history gh
      LEFT JOIN main_db.image_files if ON if.original_file_path = gh.original_path
      LEFT JOIN main_db.image_metadata im ON im.composite_hash = if.composite_hash
      WHERE gh.id = ?
      LIMIT 1
    `);
    const record = stmt.get(id) as any;
    return record || null;
  }

  /**
   * Find all records with metadata from image_files and image_metadata tables
   * Returns history records with actual composite_hash, thumbnails, and metadata if available
   * Uses ATTACH DATABASE for cross-database queries (main_db = images.db)
   */
  static findAllWithMetadata(filters: FilterOptions = {}): (GenerationHistoryRecord & {
    actual_composite_hash?: string | null;
    actual_thumbnail_path?: string | null;
    actual_optimized_path?: string | null;
  })[] {
    let sql = `
      SELECT
        gh.*,
        if.composite_hash as actual_composite_hash,
        im.thumbnail_path as actual_thumbnail_path,
        im.optimized_path as actual_optimized_path
      FROM api_generation_history gh
      LEFT JOIN main_db.image_files if ON if.original_file_path = gh.original_path
      LEFT JOIN main_db.image_metadata im ON im.composite_hash = if.composite_hash
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

    // Order by
    const orderBy = filters.order_by || 'created_at';
    const orderDir = filters.order_direction || 'DESC';
    sql += ` ORDER BY gh.${orderBy} ${orderDir}`;

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
}
