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
    return new Promise((resolve, reject) => {
      db.get<RatingWeights>(
        'SELECT * FROM rating_weights WHERE id = 1',
        [],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * 가중치 설정 업데이트
   */
  static async updateWeights(weights: RatingWeightsUpdate): Promise<RatingWeights> {
    return new Promise((resolve, reject) => {
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
        reject(new Error('No fields to update'));
        return;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');

      const sql = `UPDATE rating_weights SET ${fields.join(', ')} WHERE id = 1`;

      db.run(sql, values, function (err) {
        if (err) {
          reject(err);
          return;
        }

        // 업데이트 후 데이터 조회
        RatingScoreModel.getWeights()
          .then((result) => {
            if (result) {
              resolve(result);
            } else {
              reject(new Error('Failed to retrieve updated weights'));
            }
          })
          .catch(reject);
      });
    });
  }

  /**
   * 모든 등급 조회 (tier_order 순서대로)
   */
  static async getAllTiers(): Promise<RatingTier[]> {
    return new Promise((resolve, reject) => {
      db.all<RatingTier>(
        'SELECT * FROM rating_tiers ORDER BY tier_order ASC',
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * 특정 등급 조회
   */
  static async getTierById(id: number): Promise<RatingTier | null> {
    return new Promise((resolve, reject) => {
      db.get<RatingTier>(
        'SELECT * FROM rating_tiers WHERE id = ?',
        [id],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * 점수로 등급 찾기
   * @param score 계산된 점수
   * @returns 해당하는 등급 (없으면 null)
   */
  static async getTierByScore(score: number): Promise<RatingTier | null> {
    return new Promise((resolve, reject) => {
      db.get<RatingTier>(
        `
        SELECT * FROM rating_tiers
        WHERE min_score <= ?
          AND (max_score IS NULL OR max_score > ?)
        ORDER BY tier_order ASC
        LIMIT 1
        `,
        [score, score],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * 등급 생성
   */
  static async createTier(tierData: RatingTierInput): Promise<RatingTier> {
    return new Promise((resolve, reject) => {
      db.run(
        `
        INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          tierData.tier_name,
          tierData.min_score,
          tierData.max_score,
          tierData.tier_order,
          tierData.color || null
        ],
        function (err) {
          if (err) {
            reject(err);
            return;
          }

          // 생성된 데이터 조회
          RatingScoreModel.getTierById(this.lastID)
            .then((result) => {
              if (result) {
                resolve(result);
              } else {
                reject(new Error('Failed to retrieve created tier'));
              }
            })
            .catch(reject);
        }
      );
    });
  }

  /**
   * 등급 수정
   */
  static async updateTier(id: number, tierData: Partial<RatingTierInput>): Promise<RatingTier> {
    return new Promise((resolve, reject) => {
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
        reject(new Error('No fields to update'));
        return;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      const sql = `UPDATE rating_tiers SET ${fields.join(', ')} WHERE id = ?`;

      db.run(sql, values, function (err) {
        if (err) {
          reject(err);
          return;
        }

        // 업데이트 후 데이터 조회
        RatingScoreModel.getTierById(id)
          .then((result) => {
            if (result) {
              resolve(result);
            } else {
              reject(new Error('Failed to retrieve updated tier'));
            }
          })
          .catch(reject);
      });
    });
  }

  /**
   * 등급 삭제
   */
  static async deleteTier(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM rating_tiers WHERE id = ?',
        [id],
        function (err) {
          if (err) {
            reject(err);
          } else if (this.changes === 0) {
            reject(new Error('Tier not found'));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 모든 등급 일괄 업데이트 (트랜잭션)
   */
  static async updateAllTiers(tiers: RatingTierInput[]): Promise<RatingTier[]> {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // 기존 등급 모두 삭제
        db.run('DELETE FROM rating_tiers', (err) => {
          if (err) {
            db.run('ROLLBACK');
            reject(err);
            return;
          }
        });

        // 새 등급들 삽입
        let insertedCount = 0;
        let hasError = false;

        if (tiers.length === 0) {
          db.run('COMMIT', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve([]);
            }
          });
          return;
        }

        tiers.forEach((tier) => {
          db.run(
            `
            INSERT INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
            VALUES (?, ?, ?, ?, ?)
            `,
            [tier.tier_name, tier.min_score, tier.max_score, tier.tier_order, tier.color || null],
            (err) => {
              if (err && !hasError) {
                hasError = true;
                db.run('ROLLBACK');
                reject(err);
                return;
              }

              insertedCount++;
              if (insertedCount === tiers.length && !hasError) {
                db.run('COMMIT', (err) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  // 커밋 후 모든 등급 조회
                  RatingScoreModel.getAllTiers()
                    .then(resolve)
                    .catch(reject);
                });
              }
            }
          );
        });
      });
    });
  }
}
