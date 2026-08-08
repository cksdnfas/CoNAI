import { db } from '../database/init';
import { RatingWeights, RatingWeightsUpdate, RatingTier, RatingTierInput } from '../types/rating';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

/**
 * 티어 캐시.
 *
 * 티어는 사실상 정적 설정인데, 가시성 조건을 만드는 쿼리 빌더 9곳이 목록 요청마다
 * `getAllTiers` 를 호출하고(유사도 쿼리 빌더는 1회 빌드에 5콜), 미디어 서빙 가드가
 * Range 요청마다 `getTierByScore` 를 호출한다 — 전부 매번 prepare+실행이었다.
 * 티어 뮤테이션은 전부 이 모델을 경유하므로 여기서 무효화하면 정합이 보장된다.
 */
let cachedTiersInOrder: RatingTier[] | null = null;

function invalidateRatingTierCache(): void {
  cachedTiersInOrder = null;
}

function getTiersInOrderCached(): RatingTier[] {
  if (!cachedTiersInOrder) {
    cachedTiersInOrder = db.prepare('SELECT * FROM rating_tiers ORDER BY tier_order ASC').all() as RatingTier[];
  }
  return cachedTiersInOrder;
}

/**
 * RatingScoreModel
 * Rating 가중치 및 등급 관리 모델
 */
export class RatingScoreModel {
  /**
   * 가중치 설정 조회
   */
  static getWeights(): RatingWeights | null {
    const row = db.prepare('SELECT * FROM rating_weights WHERE id = 1').get() as RatingWeights | undefined;
    return row || null;
  }

  /**
   * 가중치 설정 업데이트
   */
  static updateWeights(weights: RatingWeightsUpdate): RatingWeights {
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

    const result = this.getWeights();
    if (!result) {
      throw new Error('Failed to retrieve updated weights');
    }
    return result;
  }

  /**
   * 모든 등급 조회 (tier_order 순서대로)
   */
  static getAllTiers(): RatingTier[] {
    // 호출부가 배열을 변형해도 캐시가 오염되지 않도록 사본을 준다 (티어는 소수라 비용 무시 가능).
    return [...getTiersInOrderCached()];
  }

  /**
   * 특정 등급 조회
   */
  static getTierById(id: number): RatingTier | null {
    const row = db.prepare('SELECT * FROM rating_tiers WHERE id = ?').get(id) as RatingTier | undefined;
    return row || null;
  }

  /**
   * 점수로 등급 찾기
   * @param score 계산된 점수
   * @returns 해당하는 등급 (없으면 null)
   */
  static getTierByScore(score: number): RatingTier | null {
    // 캐시는 tier_order ASC 정렬 상태이므로 첫 매치가 종전 SQL(ORDER BY tier_order LIMIT 1)과 동일하다.
    const tier = getTiersInOrderCached().find((candidate) => (
      candidate.min_score <= score
      && (candidate.max_score === null || candidate.max_score === undefined || candidate.max_score > score)
    ));
    return tier ?? null;
  }

  /**
   * 등급 생성
   */
  static createTier(tierData: RatingTierInput): RatingTier {
    const info = db.prepare(`
      INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color, feed_visibility)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tierData.tier_name,
      tierData.min_score,
      tierData.max_score,
      tierData.tier_order,
      tierData.color || null,
      tierData.feed_visibility || 'show'
    );

    invalidateRatingTierCache();
    const result = this.getTierById(info.lastInsertRowid as number);
    if (!result) {
      throw new Error('Failed to retrieve created tier');
    }
    return result;
  }

  /**
   * 등급 수정
   */
  static updateTier(id: number, tierData: Partial<RatingTierInput>): RatingTier {
    const updates = filterDefined(tierData);

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields to update');
    }

    // updated_at은 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...updates,
      updated_at: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery('rating_tiers', finalUpdates, { id });
    db.prepare(sql).run(...values);

    invalidateRatingTierCache();
    const result = this.getTierById(id);
    if (!result) {
      throw new Error('Failed to retrieve updated tier');
    }
    return result;
  }

  /**
   * 등급 삭제
   */
  static deleteTier(id: number): void {
    const info = db.prepare('DELETE FROM rating_tiers WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new Error('Tier not found');
    }
    invalidateRatingTierCache();
  }

  /**
   * 모든 등급 일괄 업데이트 (트랜잭션)
   */
  static updateAllTiers(tiers: RatingTierInput[]): RatingTier[] {
    const transaction = db.transaction(() => {
      // 기존 등급 모두 삭제
      db.prepare('DELETE FROM rating_tiers').run();

      // 새 등급들 삽입
      const insertStmt = db.prepare(`
        INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color, feed_visibility)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const tier of tiers) {
        insertStmt.run(
          tier.tier_name,
          tier.min_score,
          tier.max_score,
          tier.tier_order,
          tier.color || null,
          tier.feed_visibility || 'show'
        );
      }
    });

    transaction();
    invalidateRatingTierCache();
    return this.getAllTiers();
  }
}
