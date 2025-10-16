import { db } from '../database/init';
import {
  ComfyUIServerRecord,
  ComfyUIServerCreateData,
  ComfyUIServerUpdateData,
  WorkflowServerRecord
} from '../types/comfyuiServer';

export class ComfyUIServerModel {
  /**
   * 새 서버 생성
   */
  static async create(serverData: ComfyUIServerCreateData): Promise<number> {
    const info = db.prepare(`
      INSERT INTO comfyui_servers (
        name, endpoint, description, is_active, priority, max_concurrent_jobs
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      serverData.name,
      serverData.endpoint,
      serverData.description || null,
      serverData.is_active !== undefined ? (serverData.is_active ? 1 : 0) : 1,
      serverData.priority || 0,
      serverData.max_concurrent_jobs || 1
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 서버 조회 (ID)
   */
  static async findById(id: number): Promise<ComfyUIServerRecord | null> {
    const row = db.prepare('SELECT * FROM comfyui_servers WHERE id = ?').get(id) as ComfyUIServerRecord | undefined;
    return row || null;
  }

  /**
   * 모든 서버 조회
   */
  static async findAll(activeOnly: boolean = false): Promise<ComfyUIServerRecord[]> {
    let query = 'SELECT * FROM comfyui_servers';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY priority DESC, created_date DESC';

    const rows = db.prepare(query).all() as ComfyUIServerRecord[];
    return rows || [];
  }

  /**
   * 활성화된 서버만 조회 (우선순위 순)
   */
  static async findActiveServers(): Promise<ComfyUIServerRecord[]> {
    const rows = db.prepare(
      'SELECT * FROM comfyui_servers WHERE is_active = 1 ORDER BY priority DESC, id ASC'
    ).all() as ComfyUIServerRecord[];
    return rows || [];
  }

  /**
   * 서버 업데이트
   */
  static async update(id: number, serverData: ComfyUIServerUpdateData): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (serverData.name !== undefined) {
      fields.push('name = ?');
      values.push(serverData.name);
    }
    if (serverData.endpoint !== undefined) {
      fields.push('endpoint = ?');
      values.push(serverData.endpoint);
    }
    if (serverData.description !== undefined) {
      fields.push('description = ?');
      values.push(serverData.description);
    }
    if (serverData.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(serverData.is_active ? 1 : 0);
    }
    if (serverData.priority !== undefined) {
      fields.push('priority = ?');
      values.push(serverData.priority);
    }
    if (serverData.max_concurrent_jobs !== undefined) {
      fields.push('max_concurrent_jobs = ?');
      values.push(serverData.max_concurrent_jobs);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE comfyui_servers SET ${fields.join(', ')} WHERE id = ?`;
    const info = db.prepare(query).run(...values);
    return info.changes > 0;
  }

  /**
   * 서버 삭제
   */
  static async delete(id: number): Promise<boolean> {
    // workflow_servers와 generation_history는 CASCADE/SET NULL로 자동 처리됨
    const info = db.prepare('DELETE FROM comfyui_servers WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 서버 이름 중복 확인
   */
  static async existsByName(name: string, excludeId?: number): Promise<boolean> {
    let query = 'SELECT 1 FROM comfyui_servers WHERE name = ?';
    const params: any[] = [name];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = db.prepare(query).get(...params);
    return !!row;
  }

  /**
   * 서버별 생성 통계 조회
   */
  static async getStatsByServer(serverId: number): Promise<{
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
      WHERE server_id = ?
    `;

    const row = db.prepare(query).get(serverId) as any;
    return {
      total: row.total || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      pending: row.pending || 0,
      processing: row.processing || 0
    };
  }
}

export class WorkflowServerModel {
  /**
   * 워크플로우에 서버 연결
   */
  static async linkServer(workflowId: number, serverId: number, isEnabled: boolean = true): Promise<number> {
    const info = db.prepare(`
      INSERT OR REPLACE INTO workflow_servers (workflow_id, server_id, is_enabled)
      VALUES (?, ?, ?)
    `).run(workflowId, serverId, isEnabled ? 1 : 0);

    return info.lastInsertRowid as number;
  }

  /**
   * 워크플로우에서 서버 연결 해제
   */
  static async unlinkServer(workflowId: number, serverId: number): Promise<boolean> {
    const info = db.prepare(
      'DELETE FROM workflow_servers WHERE workflow_id = ? AND server_id = ?'
    ).run(workflowId, serverId);
    return info.changes > 0;
  }

  /**
   * 워크플로우의 연결된 서버 목록 조회
   */
  static async findServersByWorkflow(workflowId: number, enabledOnly: boolean = false): Promise<any[]> {
    let query = `
      SELECT ws.*, s.*
      FROM workflow_servers ws
      INNER JOIN comfyui_servers s ON ws.server_id = s.id
      WHERE ws.workflow_id = ?
    `;

    if (enabledOnly) {
      query += ' AND ws.is_enabled = 1 AND s.is_active = 1';
    }

    query += ' ORDER BY s.priority DESC, s.id ASC';

    const rows = db.prepare(query).all(workflowId) as any[];
    return rows || [];
  }

  /**
   * 서버를 사용하는 워크플로우 목록 조회
   */
  static async findWorkflowsByServer(serverId: number): Promise<any[]> {
    const query = `
      SELECT ws.*, w.*
      FROM workflow_servers ws
      INNER JOIN workflows w ON ws.workflow_id = w.id
      WHERE ws.server_id = ?
      ORDER BY w.name ASC
    `;

    const rows = db.prepare(query).all(serverId) as any[];
    return rows || [];
  }

  /**
   * 워크플로우의 모든 서버 연결 해제
   */
  static async unlinkAllServers(workflowId: number): Promise<number> {
    const info = db.prepare('DELETE FROM workflow_servers WHERE workflow_id = ?').run(workflowId);
    return info.changes;
  }

  /**
   * 워크플로우-서버 연결 활성화/비활성화
   */
  static async toggleEnabled(workflowId: number, serverId: number, isEnabled: boolean): Promise<boolean> {
    const info = db.prepare(
      'UPDATE workflow_servers SET is_enabled = ? WHERE workflow_id = ? AND server_id = ?'
    ).run(isEnabled ? 1 : 0, workflowId, serverId);
    return info.changes > 0;
  }

  /**
   * 워크플로우에 여러 서버 일괄 연결
   */
  static async linkMultipleServers(workflowId: number, serverIds: number[]): Promise<number> {
    let linkedCount = 0;

    for (const serverId of serverIds) {
      try {
        await this.linkServer(workflowId, serverId, true);
        linkedCount++;
      } catch (error) {
        console.warn(`Failed to link server ${serverId} to workflow ${workflowId}:`, error);
      }
    }

    return linkedCount;
  }
}
