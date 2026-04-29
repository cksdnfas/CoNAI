import { userSettingsDb } from '../database/userSettingsDb';
import {
  WorkflowRecord,
  WorkflowCreateData,
  WorkflowUpdateData,
  MarkedField
} from '../types/workflow';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

const PUBLIC_QUEUE_MAX_COUNT_DEFAULT = 32;

function normalizePublicQueueMaxCount(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : null;

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.min(PUBLIC_QUEUE_MAX_COUNT_DEFAULT, Math.max(1, Math.trunc(numericValue as number)));
}

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
      public_queue_max_count: normalizePublicQueueMaxCount(workflow.public_queue_max_count),
      result_view_mode: workflow.result_view_mode === 'artifact_explorer' ? 'artifact_explorer' : 'history',
      artifact_root_path: workflow.artifact_root_path ?? null,
      artifact_directory_mode: workflow.artifact_directory_mode === 'per_run' ? 'per_run' : 'shared',
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
        name, description, workflow_json, marked_fields, api_endpoint, is_active, is_public_page, public_slug, public_queue_max_count, result_view_mode, artifact_root_path, artifact_directory_mode, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowData.name,
      workflowData.description || null,
      workflowData.workflow_json,
      markedFieldsJson,
      workflowData.api_endpoint || 'http://127.0.0.1:8188',
      workflowData.is_active !== undefined ? (workflowData.is_active ? 1 : 0) : 1,
      workflowData.is_public_page ? 1 : 0,
      workflowData.public_slug || null,
      workflowData.is_public_page ? normalizePublicQueueMaxCount(workflowData.public_queue_max_count) : null,
      workflowData.result_view_mode === 'artifact_explorer' ? 'artifact_explorer' : 'history',
      workflowData.artifact_root_path?.trim() || null,
      workflowData.artifact_directory_mode === 'per_run' ? 'per_run' : 'shared',
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
      is_public_page: workflowData.is_public_page !== undefined ? (workflowData.is_public_page ? 1 : 0) : undefined,
      public_queue_max_count: workflowData.public_queue_max_count !== undefined
        ? normalizePublicQueueMaxCount(workflowData.public_queue_max_count)
        : undefined,
      result_view_mode: workflowData.result_view_mode !== undefined
        ? (workflowData.result_view_mode === 'artifact_explorer' ? 'artifact_explorer' : 'history')
        : undefined,
      artifact_root_path: workflowData.artifact_root_path !== undefined
        ? (workflowData.artifact_root_path?.trim() || null)
        : undefined,
      artifact_directory_mode: workflowData.artifact_directory_mode !== undefined
        ? (workflowData.artifact_directory_mode === 'per_run' ? 'per_run' : 'shared')
        : undefined
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
