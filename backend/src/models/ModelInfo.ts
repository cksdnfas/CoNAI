import { db } from '../database/init';

export interface ModelInfoRow {
  id: number;
  model_hash: string;
  model_name: string | null;
  model_version_id: string | null;
  civitai_model_id: number | null;
  model_type: string | null;
  civitai_data: string | null;
  thumbnail_path: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateModelInfoInput {
  model_hash: string;
  model_name?: string;
  model_version_id?: string;
  civitai_model_id?: number;
  model_type?: string;
  civitai_data?: string;
  thumbnail_path?: string;
}

/**
 * ModelInfo - Civitai 모델 정보 캐시 관리
 */
export class ModelInfo {
  /**
   * 해시로 모델 정보 조회
   */
  static findByHash(modelHash: string): ModelInfoRow | null {
    const row = db.prepare(`
      SELECT * FROM model_info WHERE model_hash = ?
    `).get(modelHash.toUpperCase()) as ModelInfoRow | undefined;
    return row || null;
  }

  /**
   * 모델 정보 생성
   */
  static create(input: CreateModelInfoInput): number {
    const result = db.prepare(`
      INSERT INTO model_info (
        model_hash, model_name, model_version_id, civitai_model_id,
        model_type, civitai_data, thumbnail_path, last_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      input.model_hash.toUpperCase(),
      input.model_name || null,
      input.model_version_id || null,
      input.civitai_model_id || null,
      input.model_type || null,
      input.civitai_data || null,
      input.thumbnail_path || null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 모델 정보 업데이트
   */
  static update(modelHash: string, input: Partial<CreateModelInfoInput>): boolean {
    const updates: string[] = [];
    const values: any[] = [];

    if (input.model_name !== undefined) {
      updates.push('model_name = ?');
      values.push(input.model_name);
    }
    if (input.model_version_id !== undefined) {
      updates.push('model_version_id = ?');
      values.push(input.model_version_id);
    }
    if (input.civitai_model_id !== undefined) {
      updates.push('civitai_model_id = ?');
      values.push(input.civitai_model_id);
    }
    if (input.model_type !== undefined) {
      updates.push('model_type = ?');
      values.push(input.model_type);
    }
    if (input.civitai_data !== undefined) {
      updates.push('civitai_data = ?');
      values.push(input.civitai_data);
    }
    if (input.thumbnail_path !== undefined) {
      updates.push('thumbnail_path = ?');
      values.push(input.thumbnail_path);
    }

    if (updates.length === 0) return false;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    updates.push('last_checked_at = CURRENT_TIMESTAMP');
    values.push(modelHash.toUpperCase());

    const result = db.prepare(`
      UPDATE model_info SET ${updates.join(', ')} WHERE model_hash = ?
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * 모든 캐시된 모델 정보 조회
   */
  static findAll(limit = 100, offset = 0): ModelInfoRow[] {
    return db.prepare(`
      SELECT * FROM model_info
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ModelInfoRow[];
  }

  /**
   * 타입별 모델 조회
   */
  static findByType(modelType: string): ModelInfoRow[] {
    return db.prepare(`
      SELECT * FROM model_info WHERE model_type = ?
      ORDER BY model_name ASC
    `).all(modelType) as ModelInfoRow[];
  }

  /**
   * 모델 정보 삭제
   */
  static delete(modelHash: string): boolean {
    const result = db.prepare(`DELETE FROM model_info WHERE model_hash = ?`).run(modelHash.toUpperCase());
    return result.changes > 0;
  }

  /**
   * 전체 캐시 삭제
   */
  static clearAll(): number {
    const result = db.prepare(`DELETE FROM model_info`).run();
    return result.changes;
  }
}
