import { userSettingsDb } from '../database/userSettingsDb';
import {
  WorkflowRecord,
  WorkflowCreateData,
  WorkflowUpdateData,
  MarkedField
} from '../types/workflow';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

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
    // 특수 처리가 필요한 필드들 변환
    const cleanData: Record<string, any> = {
      ...workflowData,
      marked_fields: workflowData.marked_fields !== undefined
        ? (workflowData.marked_fields ? JSON.stringify(workflowData.marked_fields) : null)
        : undefined,
      is_active: workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : undefined
    };

    const updates = filterDefined(cleanData);

    if (Object.keys(updates).length === 0) {
      return false;
    }

    // updated_date는 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...updates,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery('workflows', finalUpdates, { id });
    const info = userSettingsDb.prepare(sql).run(...values);
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
