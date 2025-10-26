import { userSettingsDb } from '../database/userSettingsDb';
import {
  WorkflowRecord,
  WorkflowCreateData,
  WorkflowUpdateData,
  MarkedField
} from '../types/workflow';

export class WorkflowModel {
  /**
   * 새 워크플로우 생성
   */
  static async create(workflowData: WorkflowCreateData): Promise<number> {
    const markedFieldsJson = workflowData.marked_fields ?
      JSON.stringify(workflowData.marked_fields) : null;

    const info = userSettingsDb.prepare(`
      INSERT INTO workflows (
        name, description, workflow_json, marked_fields, api_endpoint, is_active, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowData.name,
      workflowData.description || null,
      workflowData.workflow_json,
      markedFieldsJson,
      workflowData.api_endpoint || 'http://127.0.0.1:8188',
      workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : 1,
      workflowData.color || '#2196f3'
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 워크플로우 조회 (ID)
   */
  static async findById(id: number): Promise<WorkflowRecord | null> {
    const row = userSettingsDb.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRecord | undefined;
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

    const rows = userSettingsDb.prepare(query).all() as WorkflowRecord[];
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
    if (workflowData.color !== undefined) {
      fields.push('color = ?');
      values.push(workflowData.color);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`;
    const info = userSettingsDb.prepare(query).run(...values);
    return info.changes > 0;
  }

  /**
   * 워크플로우 삭제
   */
  static async delete(id: number): Promise<boolean> {
    const info = userSettingsDb.prepare('DELETE FROM workflows WHERE id = ?').run(id);
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

    const row = userSettingsDb.prepare(query).get(...params);
    return !!row;
  }
}
