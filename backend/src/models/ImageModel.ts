import { db } from '../database/init';

export type ModelRole = 'base_model' | 'lora' | 'vae' | 'embedding';

export interface ImageModelRow {
  id: number;
  composite_hash: string;
  model_hash: string;
  model_role: ModelRole;
  weight: number | null;
  civitai_checked: number;
  civitai_failed: number;
  checked_at: string | null;
  created_at: string;
}

export interface CreateImageModelInput {
  composite_hash: string;
  model_hash: string;
  model_role: ModelRole;
  weight?: number;
}

/**
 * ImageModel - 이미지와 모델 해시 연결 관리
 */
export class ImageModel {
  /**
   * 이미지에 사용된 모델 목록 조회
   */
  static findByCompositeHash(compositeHash: string): ImageModelRow[] {
    return db.prepare(`
      SELECT * FROM image_models WHERE composite_hash = ?
      ORDER BY model_role, created_at
    `).all(compositeHash) as ImageModelRow[];
  }

  /**
   * 특정 해시를 사용하는 모든 이미지 조회
   */
  static findByModelHash(modelHash: string): ImageModelRow[] {
    return db.prepare(`
      SELECT * FROM image_models WHERE model_hash = ?
    `).all(modelHash.toUpperCase()) as ImageModelRow[];
  }

  /**
   * 이미지-모델 연결 생성
   */
  static create(input: CreateImageModelInput): number {
    const result = db.prepare(`
      INSERT OR IGNORE INTO image_models (
        composite_hash, model_hash, model_role, weight
      ) VALUES (?, ?, ?, ?)
    `).run(
      input.composite_hash,
      input.model_hash.toUpperCase(),
      input.model_role,
      input.weight ?? null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 여러 모델 연결 일괄 생성
   */
  static createMany(compositeHash: string, models: Omit<CreateImageModelInput, 'composite_hash'>[]): number {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO image_models (
        composite_hash, model_hash, model_role, weight
      ) VALUES (?, ?, ?, ?)
    `);

    let count = 0;
    const insertMany = db.transaction((items: typeof models) => {
      for (const model of items) {
        const result = stmt.run(
          compositeHash,
          model.model_hash.toUpperCase(),
          model.model_role,
          model.weight ?? null
        );
        if (result.changes > 0) count++;
      }
    });

    insertMany(models);
    return count;
  }

  /**
   * Civitai 조회가 필요한 레코드 조회
   */
  static getUncheckedModels(compositeHash?: string, limit = 50): ImageModelRow[] {
    if (compositeHash) {
      return db.prepare(`
        SELECT * FROM image_models
        WHERE composite_hash = ? AND civitai_checked = 0 AND civitai_failed = 0
        LIMIT ?
      `).all(compositeHash, limit) as ImageModelRow[];
    }
    return db.prepare(`
      SELECT * FROM image_models
      WHERE civitai_checked = 0 AND civitai_failed = 0
      LIMIT ?
    `).all(limit) as ImageModelRow[];
  }

  /**
   * Civitai 조회 완료 표시
   */
  static markAsChecked(id: number, failed = false): boolean {
    const result = db.prepare(`
      UPDATE image_models
      SET civitai_checked = 1, civitai_failed = ?, checked_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(failed ? 1 : 0, id);
    return result.changes > 0;
  }

  /**
   * 해시로 Civitai 조회 완료 표시 (동일 해시 모든 레코드)
   */
  static markHashAsChecked(modelHash: string, failed = false): number {
    const result = db.prepare(`
      UPDATE image_models
      SET civitai_checked = 1, civitai_failed = ?, checked_at = CURRENT_TIMESTAMP
      WHERE model_hash = ? AND civitai_checked = 0
    `).run(failed ? 1 : 0, modelHash.toUpperCase());
    return result.changes;
  }

  /**
   * 실패한 레코드 재시도 가능하게 리셋
   */
  static resetFailed(): number {
    const result = db.prepare(`
      UPDATE image_models
      SET civitai_checked = 0, civitai_failed = 0, checked_at = NULL
      WHERE civitai_failed = 1
    `).run();
    return result.changes;
  }

  /**
   * 이미지의 모든 모델 연결 삭제
   */
  static deleteByCompositeHash(compositeHash: string): number {
    const result = db.prepare(`DELETE FROM image_models WHERE composite_hash = ?`).run(compositeHash);
    return result.changes;
  }
}
