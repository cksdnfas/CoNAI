import { userSettingsDb } from '../database/userSettingsDb';
import {
  WorkflowRecord,
  WorkflowCreateData,
  WorkflowUpdateData,
  MarkedField
} from '../types/workflow';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

export class WorkflowModel {
  private static normalizeWorkflowRecord(workflow: WorkflowRecord | undefined | null): WorkflowRecord | null {
    if (!workflow) {
      return null
    }

    const rawIsActive = (workflow as unknown as { is_active: boolean | number }).is_active
    const rawIsPublicPage = (workflow as unknown as { is_public_page: boolean | number }).is_public_page

    return {
      ...workflow,
      is_active: rawIsActive === true || rawIsActive === 1,
      is_public_page: rawIsPublicPage === true || rawIsPublicPage === 1,
    }
  }

  /**
   * 새 워크플로우 생성
   */
  static create(workflowData: WorkflowCreateData): number {
    const markedFieldsJson = workflowData.marked_fields ?
      JSON.stringify(workflowData.marked_fields) : null;

    const info = userSettingsDb.prepare(`
      INSERT INTO workflows (
        name, description, workflow_json, marked_fields, api_endpoint, is_active, is_public_page, public_slug, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowData.name,
      workflowData.description || null,
      workflowData.workflow_json,
      markedFieldsJson,
      workflowData.api_endpoint || 'http://127.0.0.1:8188',
      workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : 1,
      workflowData.is_public_page ? 1 : 0,
      workflowData.public_slug || null,
      workflowData.color || '#2196f3'
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 워크플로우 조회 (ID)
   */
  static findById(id: number): WorkflowRecord | null {
    const row = userSettingsDb.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRecord | undefined;
    return this.normalizeWorkflowRecord(row);
  }

  /**
   * 모든 워크플로우 조회
   */
  static findAll(activeOnly: boolean = false): WorkflowRecord[] {
    let query = 'SELECT * FROM workflows';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY created_date DESC';

    const rows = userSettingsDb.prepare(query).all() as WorkflowRecord[];
    return (rows || []).map((row) => this.normalizeWorkflowRecord(row)).filter((row): row is WorkflowRecord => row !== null);
  }

  /**
   * 워크플로우 업데이트
   */
  static update(id: number, workflowData: WorkflowUpdateData): boolean {
    // 특수 처리가 필요한 필드들 변환
    const cleanData: Record<string, any> = {
      ...workflowData,
      marked_fields: workflowData.marked_fields !== undefined
        ? (workflowData.marked_fields ? JSON.stringify(workflowData.marked_fields) : null)
        : undefined,
      is_active: workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : undefined,
      is_public_page: workflowData.is_public_page !== undefined ? (workflowData.is_public_page ? 1 : 0) : undefined
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
  static delete(id: number): boolean {
    const info = userSettingsDb.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 워크플로우 이름 중복 확인
   */
  static existsByName(name: string, excludeId?: number): boolean {
    let query = 'SELECT 1 FROM workflows WHERE name = ?';
    const params: any[] = [name];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = userSettingsDb.prepare(query).get(...params);
    return !!row;
  }

  /**
   * Public slug duplication check
   */
  static existsByPublicSlug(publicSlug: string, excludeId?: number): boolean {
    let query = 'SELECT 1 FROM workflows WHERE public_slug = ?';
    const params: any[] = [publicSlug];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = userSettingsDb.prepare(query).get(...params);
    return !!row;
  }

  /**
   * Public workflow lookup by slug
   */
  static findPublicBySlug(publicSlug: string): WorkflowRecord | null {
    const row = userSettingsDb.prepare(`
      SELECT *
      FROM workflows
      WHERE public_slug = ?
        AND is_public_page = 1
        AND is_active = 1
    `).get(publicSlug) as WorkflowRecord | undefined;

    return this.normalizeWorkflowRecord(row);
  }

  static findAllPublic(): WorkflowRecord[] {
    const rows = userSettingsDb.prepare(`
      SELECT *
      FROM workflows
      WHERE is_public_page = 1
        AND is_active = 1
      ORDER BY name COLLATE NOCASE ASC
    `).all() as WorkflowRecord[];

    return rows.map((row) => this.normalizeWorkflowRecord(row)).filter((row): row is WorkflowRecord => row !== null);
  }
}
