import { userSettingsDb } from '../database/userSettingsDb';
import { apiGenDb } from '../database/apiGenerationDb';
import {
  ComfyUIServerRecord,
  ComfyUIServerCreateData,
  ComfyUIServerUpdateData,
  WorkflowServerRecord
} from '../types/comfyuiServer';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

function parseRoutingTagsJson(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function normalizeServerRecord(row: ComfyUIServerRecord | undefined | null): ComfyUIServerRecord | null {
  if (!row) {
    return null;
  }

  return {
    ...row,
    routing_tags: parseRoutingTagsJson(row.routing_tags_json),
  };
}

export class ComfyUIServerModel {
  /**
   * 새 서버 생성
   */
  static create(serverData: ComfyUIServerCreateData): number {
    const info = userSettingsDb.prepare(`
      INSERT INTO comfyui_servers (
        name, endpoint, description, routing_tags_json, is_active
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      serverData.name,
      serverData.endpoint,
      serverData.description || null,
      serverData.routing_tags_json ?? null,
      serverData.is_active !== undefined ? (serverData.is_active ? 1 : 0) : 1
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 서버 조회 (ID)
   */
  static findById(id: number): ComfyUIServerRecord | null {
    const row = userSettingsDb.prepare('SELECT * FROM comfyui_servers WHERE id = ?').get(id) as ComfyUIServerRecord | undefined;
    return normalizeServerRecord(row);
  }

  /**
   * 모든 서버 조회
   */
  static findAll(activeOnly: boolean = false): ComfyUIServerRecord[] {
    let query = 'SELECT * FROM comfyui_servers';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY created_date DESC';

    const rows = userSettingsDb.prepare(query).all() as ComfyUIServerRecord[];
    return (rows || []).map((row) => normalizeServerRecord(row)).filter((row): row is ComfyUIServerRecord => row !== null);
  }

  /**
   * 활성화된 서버만 조회
   */
  static findActiveServers(): ComfyUIServerRecord[] {
    const rows = userSettingsDb.prepare(
      'SELECT * FROM comfyui_servers WHERE is_active = 1 ORDER BY id ASC'
    ).all() as ComfyUIServerRecord[];
    return (rows || []).map((row) => normalizeServerRecord(row)).filter((row): row is ComfyUIServerRecord => row !== null);
  }

  /**
   * 서버 업데이트
   */
  static update(id: number, serverData: ComfyUIServerUpdateData): boolean {
    // is_active를 boolean에서 number로 변환
    const cleanData: Record<string, any> = {
      ...serverData,
      is_active: serverData.is_active !== undefined ? (serverData.is_active ? 1 : 0) : undefined
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

    const { sql, values } = buildUpdateQuery('comfyui_servers', finalUpdates, { id });
    const info = userSettingsDb.prepare(sql).run(...values);
    return info.changes > 0;
  }

  /**
   * 서버 삭제
   */
  static delete(id: number): boolean {
    // workflow_servers는 CASCADE로 자동 처리됨
    const info = userSettingsDb.prepare('DELETE FROM comfyui_servers WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 서버 이름 중복 확인
   */
  static existsByName(name: string, excludeId?: number): boolean {
    let query = 'SELECT 1 FROM comfyui_servers WHERE name = ?';
    const params: any[] = [name];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = userSettingsDb.prepare(query).get(...params);
    return !!row;
  }

  /**
   * 서버별 생성 통계 조회
   * Note: generation_history 제거되어 항상 0 반환
   */
  static getStatsByServer(serverId: number): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  } {
    // generation_history 테이블이 제거되어 통계 불가능
    // api_generation_history에는 server_id가 없음
    return {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      processing: 0
    };
  }
}

export class WorkflowServerModel {
  /**
   * 워크플로우에 서버 연결
   */
  static linkServer(workflowId: number, serverId: number, isEnabled: boolean = true): number {
    const info = userSettingsDb.prepare(`
      INSERT OR REPLACE INTO workflow_servers (workflow_id, server_id, is_enabled)
      VALUES (?, ?, ?)
    `).run(workflowId, serverId, isEnabled ? 1 : 0);

    return info.lastInsertRowid as number;
  }

  /**
   * 워크플로우에서 서버 연결 해제
   */
  static unlinkServer(workflowId: number, serverId: number): boolean {
    const info = userSettingsDb.prepare(
      'DELETE FROM workflow_servers WHERE workflow_id = ? AND server_id = ?'
    ).run(workflowId, serverId);
    return info.changes > 0;
  }

  /**
   * 워크플로우의 연결된 서버 목록 조회
   */
  static findServersByWorkflow(workflowId: number, enabledOnly: boolean = false): any[] {
    let query = `
      SELECT ws.*, s.*
      FROM workflow_servers ws
      INNER JOIN comfyui_servers s ON ws.server_id = s.id
      WHERE ws.workflow_id = ?
    `;

    if (enabledOnly) {
      query += ' AND ws.is_enabled = 1 AND s.is_active = 1';
    }

    query += ' ORDER BY s.id ASC';

    const rows = userSettingsDb.prepare(query).all(workflowId) as any[];
    return (rows || []).map((row) => ({
      ...row,
      routing_tags: parseRoutingTagsJson(row.routing_tags_json),
    }));
  }

  /**
   * 서버를 사용하는 워크플로우 목록 조회
   */
  static findWorkflowsByServer(serverId: number): any[] {
    const query = `
      SELECT ws.*, w.*
      FROM workflow_servers ws
      INNER JOIN workflows w ON ws.workflow_id = w.id
      WHERE ws.server_id = ?
      ORDER BY w.name ASC
    `;

    const rows = userSettingsDb.prepare(query).all(serverId) as any[];
    return rows || [];
  }

  /**
   * 워크플로우의 모든 서버 연결 해제
   */
  static unlinkAllServers(workflowId: number): number {
    const info = userSettingsDb.prepare('DELETE FROM workflow_servers WHERE workflow_id = ?').run(workflowId);
    return info.changes;
  }

  /**
   * 워크플로우-서버 연결 활성화/비활성화
   */
  static toggleEnabled(workflowId: number, serverId: number, isEnabled: boolean): boolean {
    const info = userSettingsDb.prepare(
      'UPDATE workflow_servers SET is_enabled = ? WHERE workflow_id = ? AND server_id = ?'
    ).run(isEnabled ? 1 : 0, workflowId, serverId);
    return info.changes > 0;
  }

  /**
   * 워크플로우에 여러 서버 일괄 연결
   */
  static linkMultipleServers(workflowId: number, serverIds: number[]): number {
    let linkedCount = 0;

    for (const serverId of serverIds) {
      try {
        this.linkServer(workflowId, serverId, true);
        linkedCount++;
      } catch (error) {
        console.warn(`Failed to link server ${serverId} to workflow ${workflowId}:`, error);
      }
    }

    return linkedCount;
  }
}
