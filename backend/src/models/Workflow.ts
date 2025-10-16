import { db } from '../database/init';
import {
  WorkflowRecord,
  WorkflowCreateData,
  WorkflowUpdateData,
  GenerationHistoryRecord,
  GenerationHistoryCreateData,
  MarkedField
} from '../types/workflow';

export class WorkflowModel {
  /**
   * 새 워크플로우 생성
   */
  static async create(workflowData: WorkflowCreateData): Promise<number> {
    const markedFieldsJson = workflowData.marked_fields ?
      JSON.stringify(workflowData.marked_fields) : null;

    const info = db.prepare(`
      INSERT INTO workflows (
        name, description, workflow_json, marked_fields, api_endpoint, is_active
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      workflowData.name,
      workflowData.description || null,
      workflowData.workflow_json,
      markedFieldsJson,
      workflowData.api_endpoint || 'http://127.0.0.1:8188',
      workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : 1
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 워크플로우 조회 (ID)
   */
  static async findById(id: number): Promise<WorkflowRecord | null> {
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRecord | undefined;
    return row || null;
  }

  /**
   * 모든 워크플로우 조회
   */
  static async findAll(activeOnly: boolean = false): Promise<WorkflowRecord[]> {
    let query = 'SELECT * FROM workflows';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY created_date DESC';

    const rows = db.prepare(query).all() as WorkflowRecord[];
    return rows || [];
  }

  /**
   * 워크플로우 업데이트
   */
  static async update(id: number, workflowData: WorkflowUpdateData): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (workflowData.name !== undefined) {
      fields.push('name = ?');
      values.push(workflowData.name);
    }
    if (workflowData.description !== undefined) {
      fields.push('description = ?');
      values.push(workflowData.description);
    }
    if (workflowData.workflow_json !== undefined) {
      fields.push('workflow_json = ?');
      values.push(workflowData.workflow_json);
    }
    if (workflowData.marked_fields !== undefined) {
      fields.push('marked_fields = ?');
      values.push(workflowData.marked_fields ? JSON.stringify(workflowData.marked_fields) : null);
    }
    if (workflowData.api_endpoint !== undefined) {
      fields.push('api_endpoint = ?');
      values.push(workflowData.api_endpoint);
    }
    if (workflowData.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(workflowData.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`;
    const info = db.prepare(query).run(...values);
    return info.changes > 0;
  }

  /**
   * 워크플로우 삭제
   */
  static async delete(id: number): Promise<boolean> {
    // generation_history는 CASCADE로 자동 삭제됨
    const info = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 워크플로우 이름 중복 확인
   */
  static async existsByName(name: string, excludeId?: number): Promise<boolean> {
    let query = 'SELECT 1 FROM workflows WHERE name = ?';
    const params: any[] = [name];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = db.prepare(query).get(...params);
    return !!row;
  }
}

export class GenerationHistoryModel {
  /**
   * 새 생성 히스토리 생성
   */
  static async create(historyData: GenerationHistoryCreateData): Promise<number> {
    const promptDataJson = JSON.stringify(historyData.prompt_data);

    const info = db.prepare(`
      INSERT INTO generation_history (
        workflow_id, prompt_data, status, comfyui_prompt_id,
        generated_image_id, error_message, execution_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      historyData.workflow_id,
      promptDataJson,
      historyData.status || 'pending',
      historyData.comfyui_prompt_id || null,
      historyData.generated_image_id || null,
      historyData.error_message || null,
      historyData.execution_time || null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 생성 히스토리 조회 (ID)
   */
  static async findById(id: number): Promise<GenerationHistoryRecord | null> {
    const row = db.prepare('SELECT * FROM generation_history WHERE id = ?').get(id) as GenerationHistoryRecord | undefined;
    return row || null;
  }

  /**
   * ComfyUI Prompt ID로 조회
   */
  static async findByComfyUIPromptId(promptId: string): Promise<GenerationHistoryRecord | null> {
    const row = db.prepare('SELECT * FROM generation_history WHERE comfyui_prompt_id = ?').get(promptId) as GenerationHistoryRecord | undefined;
    return row || null;
  }

  /**
   * 워크플로우별 히스토리 조회
   */
  static async findByWorkflow(
    workflowId: number,
    page: number = 1,
    limit: number = 20
  ): Promise<{ histories: GenerationHistoryRecord[], total: number }> {
    const offset = (page - 1) * limit;

    // 총 개수 조회
    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM generation_history WHERE workflow_id = ?'
    ).get(workflowId) as any;
    const total = countRow.total;

    // 페이지네이션된 데이터 조회
    const query = `
      SELECT * FROM generation_history
      WHERE workflow_id = ?
      ORDER BY created_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(workflowId, limit, offset) as GenerationHistoryRecord[];

    return { histories: rows || [], total };
  }

  /**
   * 최근 생성 히스토리 조회
   */
  static async findRecent(limit: number = 20): Promise<GenerationHistoryRecord[]> {
    const query = `
      SELECT gh.*, w.name as workflow_name
      FROM generation_history gh
      LEFT JOIN workflows w ON gh.workflow_id = w.id
      ORDER BY gh.created_date DESC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(limit) as any[];
    return rows || [];
  }

  /**
   * 생성 히스토리 상태 업데이트
   */
  static async updateStatus(
    id: number,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    additionalData?: {
      comfyui_prompt_id?: string;
      generated_image_id?: number;
      error_message?: string;
      execution_time?: number;
    }
  ): Promise<boolean> {
    const fields: string[] = ['status = ?'];
    const values: any[] = [status];

    if (additionalData?.comfyui_prompt_id !== undefined) {
      fields.push('comfyui_prompt_id = ?');
      values.push(additionalData.comfyui_prompt_id);
    }
    if (additionalData?.generated_image_id !== undefined) {
      fields.push('generated_image_id = ?');
      values.push(additionalData.generated_image_id);
    }
    if (additionalData?.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(additionalData.error_message);
    }
    if (additionalData?.execution_time !== undefined) {
      fields.push('execution_time = ?');
      values.push(additionalData.execution_time);
    }

    values.push(id);

    const query = `UPDATE generation_history SET ${fields.join(', ')} WHERE id = ?`;
    const info = db.prepare(query).run(...values);
    return info.changes > 0;
  }

  /**
   * 생성 히스토리 삭제
   */
  static async delete(id: number): Promise<boolean> {
    const info = db.prepare('DELETE FROM generation_history WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 워크플로우별 통계 조회
   */
  static async getStatsByWorkflow(workflowId: number): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM generation_history
      WHERE workflow_id = ?
    `;

    const row = db.prepare(query).get(workflowId) as any;
    return {
      total: row.total || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      pending: row.pending || 0,
      processing: row.processing || 0
    };
  }
}
