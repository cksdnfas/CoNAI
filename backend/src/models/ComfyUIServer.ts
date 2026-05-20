import { userSettingsDb } from '../database/userSettingsDb';
import { apiGenDb } from '../database/apiGenerationDb';
import {
  ComfyUIServerRecord,
  ComfyUIServerCreateData,
  ComfyUIServerUpdateData,
  WorkflowServerRecord,
  type ComfyUIBackendType,
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

function normalizeBackendType(value: unknown): ComfyUIBackendType {
  return value === 'modal' ? 'modal' : 'comfyui';
}

function normalizeCapacity(value: unknown, backendType: ComfyUIBackendType): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return backendType === 'modal' ? 10 : 1;
  }
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function normalizeBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value === true || value === 1 || value === '1';
}

function normalizeServerFields<T extends { backend_type?: unknown; capacity?: unknown; routing_tags_json?: unknown; is_active?: unknown; is_default?: unknown }>(row: T) {
  const backendType = normalizeBackendType(row.backend_type);

  return {
    ...row,
    backend_type: backendType,
    capacity: normalizeCapacity(row.capacity, backendType),
    routing_tags: parseRoutingTagsJson(row.routing_tags_json),
    is_active: normalizeBooleanFlag(row.is_active, true),
    is_default: backendType === 'modal' ? false : normalizeBooleanFlag(row.is_default, false),
  };
}

function normalizeServerRecord(row: ComfyUIServerRecord | undefined | null): ComfyUIServerRecord | null {
  if (!row) {
    return null;
  }

  return normalizeServerFields(row);
}

export class ComfyUIServerModel {
  /**
   * 새 서버 생성
   */
  static create(serverData: ComfyUIServerCreateData): number {
    const backendType = normalizeBackendType(serverData.backend_type);
    const capacity = normalizeCapacity(serverData.capacity, backendType);
    const isDefault = backendType !== 'modal' && serverData.is_default === true;

    const createServer = userSettingsDb.transaction(() => {
      if (isDefault) {
        userSettingsDb.prepare(`
          UPDATE comfyui_servers
          SET is_default = 0, updated_date = CURRENT_TIMESTAMP
          WHERE is_default = 1
        `).run();
      }

      const info = userSettingsDb.prepare(`
        INSERT INTO comfyui_servers (
          name, endpoint, backend_type, capacity, description, routing_tags_json, is_active, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        serverData.name,
        serverData.endpoint,
        backendType,
        capacity,
        serverData.description || null,
        serverData.routing_tags_json ?? null,
        serverData.is_active !== undefined ? (serverData.is_active ? 1 : 0) : 1,
        isDefault ? 1 : 0
      );

      return info.lastInsertRowid as number;
    });

    return createServer();
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
   * 현재 대표 서버 조회
   */
  static findDefault(): ComfyUIServerRecord | null {
    const row = userSettingsDb.prepare(
      'SELECT * FROM comfyui_servers WHERE is_default = 1 AND backend_type != \'modal\' ORDER BY updated_date DESC, id DESC LIMIT 1'
    ).get() as ComfyUIServerRecord | undefined;
    return normalizeServerRecord(row);
  }

  /**
   * 현재 활성 대표 서버 조회
   */
  static findDefaultActive(): ComfyUIServerRecord | null {
    const row = userSettingsDb.prepare(
      'SELECT * FROM comfyui_servers WHERE is_default = 1 AND is_active = 1 AND backend_type != \'modal\' ORDER BY updated_date DESC, id DESC LIMIT 1'
    ).get() as ComfyUIServerRecord | undefined;
    return normalizeServerRecord(row);
  }

  /**
   * 대표 서버 지정. 기존 대표는 같은 트랜잭션에서 해제한다.
   */
  static setDefault(id: number): boolean {
    const setDefaultServer = userSettingsDb.transaction((serverId: number) => {
      const existing = userSettingsDb.prepare('SELECT id, backend_type FROM comfyui_servers WHERE id = ?').get(serverId) as { id: number; backend_type?: unknown } | undefined;
      if (!existing || normalizeBackendType(existing.backend_type) === 'modal') {
        return false;
      }

      userSettingsDb.prepare(`
        UPDATE comfyui_servers
        SET is_default = 0, updated_date = CURRENT_TIMESTAMP
        WHERE id != ? AND is_default = 1
      `).run(serverId);

      const info = userSettingsDb.prepare(`
        UPDATE comfyui_servers
        SET is_default = 1, updated_date = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(serverId);
      return info.changes > 0;
    });

    return setDefaultServer(id);
  }

  /**
   * 서버 업데이트
   */
  static update(id: number, serverData: ComfyUIServerUpdateData): boolean {
    const updateServer = userSettingsDb.transaction((serverId: number, nextData: ComfyUIServerUpdateData) => {
      const existing = userSettingsDb.prepare('SELECT id, backend_type FROM comfyui_servers WHERE id = ?').get(serverId) as { id: number; backend_type?: unknown } | undefined;
      if (!existing) {
        return false;
      }

      const backendType = nextData.backend_type !== undefined ? normalizeBackendType(nextData.backend_type) : undefined;
      const nextBackendType = backendType ?? normalizeBackendType(existing.backend_type);
      if (nextData.is_default === true && nextBackendType === 'modal') {
        return false;
      }

      if (nextData.is_default === true) {
        userSettingsDb.prepare(`
          UPDATE comfyui_servers
          SET is_default = 0, updated_date = CURRENT_TIMESTAMP
          WHERE id != ? AND is_default = 1
        `).run(serverId);
      }

      const cleanData: Record<string, any> = {
        ...nextData,
        backend_type: backendType,
        capacity: nextData.capacity !== undefined ? normalizeCapacity(nextData.capacity, nextBackendType) : undefined,
        is_active: nextData.is_active !== undefined ? (nextData.is_active ? 1 : 0) : undefined,
        is_default: nextBackendType === 'modal'
          ? 0
          : nextData.is_default !== undefined
            ? (nextData.is_default ? 1 : 0)
            : undefined
      };

      const updates = filterDefined(cleanData);

      if (Object.keys(updates).length === 0) {
        return false;
      }

      const finalUpdates = {
        ...updates,
        updated_date: sqlLiteral('CURRENT_TIMESTAMP')
      };

      const { sql, values } = buildUpdateQuery('comfyui_servers', finalUpdates, { id: serverId });
      const info = userSettingsDb.prepare(sql).run(...values);
      return info.changes > 0;
    });

    return updateServer(id, serverData);
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
    return (rows || []).map((row) => normalizeServerFields(row));
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
