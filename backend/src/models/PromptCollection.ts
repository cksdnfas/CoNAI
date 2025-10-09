import { db } from '../database/init';
import {
  PromptCollectionRecord,
  NegativePromptCollectionRecord,
  PromptCollectionData,
  PromptSearchResult
} from '../types/promptCollection';

export class PromptCollectionModel {
  /**
   * 프롬프트 추가 또는 사용 횟수 증가
   */
  static addOrIncrement(prompt: string, group_id?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      // 먼저 기존 프롬프트가 있는지 확인
      db.get(
        'SELECT id, usage_count FROM prompt_collection WHERE prompt = ?',
        [prompt],
        (err, row: PromptCollectionRecord) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            // 기존 프롬프트가 있으면 사용 횟수 증가
            db.run(
              'UPDATE prompt_collection SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [row.id],
              function(err) {
                if (err) {
                  reject(err);
                } else {
                  resolve(row.id);
                }
              }
            );
          } else {
            // 새 프롬프트 추가
            const stmt = db.prepare(`
              INSERT INTO prompt_collection (prompt, usage_count, group_id)
              VALUES (?, 1, ?)
            `);

            stmt.run([prompt, group_id || null], function(err) {
              if (err) {
                reject(err);
              } else {
                resolve(this.lastID);
              }
            });

            stmt.finalize();
          }
        }
      );
    });
  }

  /**
   * 네거티브 프롬프트 추가 또는 사용 횟수 증가
   */
  static addOrIncrementNegative(prompt: string, group_id?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      // 먼저 기존 프롬프트가 있는지 확인
      db.get(
        'SELECT id, usage_count FROM negative_prompt_collection WHERE prompt = ?',
        [prompt],
        (err, row: NegativePromptCollectionRecord) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            // 기존 프롬프트가 있으면 사용 횟수 증가
            db.run(
              'UPDATE negative_prompt_collection SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [row.id],
              function(err) {
                if (err) {
                  reject(err);
                } else {
                  resolve(row.id);
                }
              }
            );
          } else {
            // 새 프롬프트 추가
            const stmt = db.prepare(`
              INSERT INTO negative_prompt_collection (prompt, usage_count, group_id)
              VALUES (?, 1, ?)
            `);

            stmt.run([prompt, group_id || null], function(err) {
              if (err) {
                reject(err);
              } else {
                resolve(this.lastID);
              }
            });

            stmt.finalize();
          }
        }
      );
    });
  }

  /**
   * 프롬프트 검색 (포지티브)
   */
  static searchPrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    return new Promise((resolve, reject) => {
      const searchPattern = `%${query}%`;
      const offset = (page - 1) * limit;

      // 총 개수 조회
      db.get(
        'SELECT COUNT(*) as total FROM prompt_collection WHERE prompt LIKE ?',
        [searchPattern],
        (err, countRow: any) => {
          if (err) {
            reject(err);
            return;
          }

          const total = countRow.total;

          // 데이터 조회
          db.all(
            `SELECT id, prompt, usage_count, group_id, synonyms
             FROM prompt_collection
             WHERE prompt LIKE ?
             ORDER BY ${sortBy} ${sortOrder}
             LIMIT ? OFFSET ?`,
            [searchPattern, limit, offset],
            (err, rows: PromptCollectionRecord[]) => {
              if (err) {
                reject(err);
              } else {
                const prompts: PromptSearchResult[] = rows.map(row => ({
                  id: row.id,
                  prompt: row.prompt,
                  usage_count: row.usage_count,
                  group_id: row.group_id,
                  synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
                  type: 'positive' as const
                }));
                resolve({ prompts, total });
              }
            }
          );
        }
      );
    });
  }

  /**
   * 네거티브 프롬프트 검색
   */
  static searchNegativePrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    return new Promise((resolve, reject) => {
      const searchPattern = `%${query}%`;
      const offset = (page - 1) * limit;

      // 총 개수 조회
      db.get(
        'SELECT COUNT(*) as total FROM negative_prompt_collection WHERE prompt LIKE ?',
        [searchPattern],
        (err, countRow: any) => {
          if (err) {
            reject(err);
            return;
          }

          const total = countRow.total;

          // 데이터 조회
          db.all(
            `SELECT id, prompt, usage_count, group_id, synonyms
             FROM negative_prompt_collection
             WHERE prompt LIKE ?
             ORDER BY ${sortBy} ${sortOrder}
             LIMIT ? OFFSET ?`,
            [searchPattern, limit, offset],
            (err, rows: NegativePromptCollectionRecord[]) => {
              if (err) {
                reject(err);
              } else {
                const prompts: PromptSearchResult[] = rows.map(row => ({
                  id: row.id,
                  prompt: row.prompt,
                  usage_count: row.usage_count,
                  group_id: row.group_id,
                  synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
                  type: 'negative' as const
                }));
                resolve({ prompts, total });
              }
            }
          );
        }
      );
    });
  }

  /**
   * 가장 많이 사용된 프롬프트 조회
   */
  static getMostUsedPrompts(limit: number = 10): Promise<PromptSearchResult[]> {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, prompt, usage_count, group_id, synonyms, 'positive' as type
         FROM prompt_collection
         ORDER BY usage_count DESC
         LIMIT ?`,
        [limit],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            const prompts: PromptSearchResult[] = rows.map(row => ({
              id: row.id,
              prompt: row.prompt,
              usage_count: row.usage_count,
              group_id: row.group_id,
              synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
              type: row.type
            }));
            resolve(prompts);
          }
        }
      );
    });
  }

  /**
   * 동의어 설정
   */
  static setSynonyms(id: number, synonyms: string[], type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
      const synonymsJson = JSON.stringify(synonyms);

      db.run(
        `UPDATE ${tableName} SET synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [synonymsJson, id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 그룹 ID 설정
   */
  static setGroupId(id: number, group_id: number | null, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.run(
        `UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [group_id, id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 프롬프트 사용 횟수 감소 (삭제 시)
   * 사용 횟수가 0이 되어도 그룹 정보와 사용자 설정 보존을 위해 레코드 삭제하지 않음
   */
  static decrementUsage(prompt: string, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      // 먼저 기존 프롬프트가 있는지 확인
      db.get(
        `SELECT id, usage_count FROM ${tableName} WHERE prompt = ?`,
        [prompt],
        (err, row: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            // 프롬프트가 존재하지 않으면 무시
            resolve(false);
            return;
          }

          // 사용 횟수가 0 이하가 되지 않도록 체크
          if (row.usage_count <= 0) {
            // 이미 0이면 감소하지 않음
            resolve(false);
            return;
          }

          // 사용 횟수 감소 (최소값 0으로 제한)
          db.run(
            `UPDATE ${tableName} SET usage_count = MAX(0, usage_count - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [row.id],
            function(err) {
              if (err) {
                reject(err);
              } else {
                resolve(this.changes > 0);
              }
            }
          );
        }
      );
    });
  }

  /**
   * 프롬프트 삭제 (사용자에 의한 수동 삭제만 허용)
   */
  static delete(id: number, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.run(
        `DELETE FROM ${tableName} WHERE id = ?`,
        [id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 모든 프롬프트 설정 내보내기 (JSON 공유용)
   */
  static exportAllSettings(type: 'positive' | 'negative' = 'positive'): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.all(
        `SELECT prompt, group_id, synonyms FROM ${tableName}
         WHERE group_id IS NOT NULL OR synonyms IS NOT NULL
         ORDER BY prompt`,
        [],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            const settings = rows.map(row => ({
              prompt: row.prompt,
              group_id: row.group_id,
              synonyms: row.synonyms ? JSON.parse(row.synonyms) : null
            }));
            resolve(settings);
          }
        }
      );
    });
  }

  /**
   * 프롬프트 설정 일괄 가져오기 (JSON 공유용)
   */
  static importSettings(settings: any[], type: 'positive' | 'negative' = 'positive'): Promise<number> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
      let updatedCount = 0;
      let completed = 0;

      if (settings.length === 0) {
        resolve(0);
        return;
      }

      settings.forEach(setting => {
        // 프롬프트가 존재하는지 확인 후 설정 업데이트
        db.get(
          `SELECT id FROM ${tableName} WHERE prompt = ?`,
          [setting.prompt],
          (err, row: any) => {
            if (err) {
              completed++;
              if (completed === settings.length) {
                reject(err);
              }
              return;
            }

            if (row) {
              // 기존 프롬프트가 있으면 설정 업데이트
              const synonymsJson = setting.synonyms ? JSON.stringify(setting.synonyms) : null;

              db.run(
                `UPDATE ${tableName} SET group_id = ?, synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [setting.group_id || null, synonymsJson, row.id],
                function(updateErr) {
                  completed++;
                  if (updateErr) {
                    if (completed === settings.length) {
                      reject(updateErr);
                    }
                  } else {
                    if (this.changes > 0) updatedCount++;
                    if (completed === settings.length) {
                      resolve(updatedCount);
                    }
                  }
                }
              );
            } else {
              // 프롬프트가 없으면 생성 (usage_count = 0으로)
              const synonymsJson = setting.synonyms ? JSON.stringify(setting.synonyms) : null;

              db.run(
                `INSERT INTO ${tableName} (prompt, usage_count, group_id, synonyms) VALUES (?, 0, ?, ?)`,
                [setting.prompt, setting.group_id || null, synonymsJson],
                function(insertErr) {
                  completed++;
                  if (insertErr) {
                    if (completed === settings.length) {
                      reject(insertErr);
                    }
                  } else {
                    updatedCount++;
                    if (completed === settings.length) {
                      resolve(updatedCount);
                    }
                  }
                }
              );
            }
          }
        );
      });
    });
  }
}