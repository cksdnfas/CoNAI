import { db } from '../database/init';
import { RatingWeights, RatingWeightsUpdate, RatingTier, RatingTierInput } from '../types/rating';

/**
 * RatingScoreModel
 * Rating 가중치 및 등급 관리 모델
 */
export class RatingScoreModel {
  /**
   * 가중치 설정 조회
   */
  static async getWeights(): Promise<RatingWeights | null> {
    const row = db.prepare('SELECT * FROM rating_weights WHERE id = 1').get() as RatingWeights | undefined;
    return row || null;
  }

  /**
   * 가중치 설정 업데이트
   */
  static async updateWeights(weights: RatingWeightsUpdate): Promise<RatingWeights> {
    const fields: string[] = [];
    const values: number[] = [];

    if (weights.general_weight !== undefined) {
      fields.push('general_weight = ?');
      values.push(weights.general_weight);
    }
    if (weights.sensitive_weight !== undefined) {
      fields.push('sensitive_weight = ?');
      values.push(weights.sensitive_weight);
    }
    if (weights.questionable_weight !== undefined) {
      fields.push('questionable_weight = ?');
      values.push(weights.questionable_weight);
    }
    if (weights.explicit_weight !== undefined) {
      fields.push('explicit_weight = ?');
      values.push(weights.explicit_weight);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const sql = `UPDATE rating_weights SET ${fields.join(', ')} WHERE id = 1`;
    db.prepare(sql).run(...values);

    const result = await this.getWeights();
    if (!result) {
      throw new Error('Failed to retrieve updated weights');
    }
    return result;
  }

  /**
   * 모든 등급 조회 (tier_order 순서대로)
   */
  static async getAllTiers(): Promise<RatingTier[]> {
    const rows = db.prepare('SELECT * FROM rating_tiers ORDER BY tier_order ASC').all() as RatingTier[];
    return rows || [];
  }

  /**
   * 특정 등급 조회
   */
  static async getTierById(id: number): Promise<RatingTier | null> {
    const row = db.prepare('SELECT * FROM rating_tiers WHERE id = ?').get(id) as RatingTier | undefined;
    return row || null;
  }

  /**
   * 점수로 등급 찾기
   * @param score 계산된 점수
   * @returns 해당하는 등급 (없으면 null)
   */
  static async getTierByScore(score: number): Promise<RatingTier | null> {
    const row = db.prepare(`
      SELECT * FROM rating_tiers
      WHERE min_score <= ?
        AND (max_score IS NULL OR max_score > ?)
      ORDER BY tier_order ASC
      LIMIT 1
    `).get(score, score) as RatingTier | undefined;
    return row || null;
  }

  /**
   * 등급 생성
   */
  static async createTier(tierData: RatingTierInput): Promise<RatingTier> {
    const info = db.prepare(`
      INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      tierData.tier_name,
      tierData.min_score,
      tierData.max_score,
      tierData.tier_order,
      tierData.color || null
    );

    const result = await this.getTierById(info.lastInsertRowid as number);
    if (!result) {
      throw new Error('Failed to retrieve created tier');
    }
    return result;
  }

  /**
   * 등급 수정
   */
  static async updateTier(id: number, tierData: Partial<RatingTierInput>): Promise<RatingTier> {
    const fields: string[] = [];
    const values: any[] = [];

    if (tierData.tier_name !== undefined) {
      fields.push('tier_name = ?');
      values.push(tierData.tier_name);
    }
    if (tierData.min_score !== undefined) {
      fields.push('min_score = ?');
      values.push(tierData.min_score);
    }
    if (tierData.max_score !== undefined) {
      fields.push('max_score = ?');
      values.push(tierData.max_score);
    }
    if (tierData.tier_order !== undefined) {
      fields.push('tier_order = ?');
      values.push(tierData.tier_order);
    }
    if (tierData.color !== undefined) {
      fields.push('color = ?');
      values.push(tierData.color);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE rating_tiers SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);

    const result = await this.getTierById(id);
    if (!result) {
      throw new Error('Failed to retrieve updated tier');
    }
    return result;
  }

  /**
   * 등급 삭제
   */
  static async deleteTier(id: number): Promise<void> {
    const info = db.prepare('DELETE FROM rating_tiers WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new Error('Tier not found');
    }
  }

  /**
   * 모든 등급 일괄 업데이트 (트랜잭션)
   */
  static async updateAllTiers(tiers: RatingTierInput[]): Promise<RatingTier[]> {
    const transaction = db.transaction(() => {
      // 기존 등급 모두 삭제
      db.prepare('DELETE FROM rating_tiers').run();

      // 새 등급들 삽입
      const insertStmt = db.prepare(`
        INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const tier of tiers) {
        insertStmt.run(
          tier.tier_name,
          tier.min_score,
          tier.max_score,
          tier.tier_order,
          tier.color || null
        );
      }
    });

    transaction();
    return this.getAllTiers();
  }
}
