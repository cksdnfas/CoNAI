import { db } from '../database/init';
import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptCollectionRecord, NegativePromptCollectionRecord } from '../types/promptCollection';
import { normalizeSearchTerm } from '../utils/promptParser';

export class SynonymService {
  /**
   * 동의어 설정 및 병합 처리
   * 메인 프롬프트에 동의어들을 할당하고, 동의어 데이터를 메인 프롬프트로 병합
   */
  static async setSynonymsAndMerge(
    mainPrompt: string,
    synonyms: string[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; mergedCount: number; mainPromptId: number }> {
    try {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
      const normalizedMain = normalizeSearchTerm(mainPrompt);

      // 1. 메인 프롬프트가 존재하는지 확인, 없으면 생성
      let mainPromptId: number;
      const mainRecord = await this.findPromptByNormalizedText(normalizedMain, type);

      if (mainRecord) {
        mainPromptId = mainRecord.id;
      } else {
        // 메인 프롬프트 생성
        if (type === 'positive') {
          mainPromptId = await PromptCollectionModel.addOrIncrement(normalizedMain);
        } else {
          mainPromptId = await PromptCollectionModel.addOrIncrementNegative(normalizedMain);
        }
      }

      let mergedCount = 0;
      const processedSynonyms: string[] = [];

      // 2. 각 동의어를 처리
      for (const synonym of synonyms) {
        const normalizedSynonym = normalizeSearchTerm(synonym);

        // 동의어가 메인 프롬프트와 같으면 스킵
        if (normalizedSynonym.toLowerCase() === normalizedMain.toLowerCase()) {
          continue;
        }

        // 동의어가 이미 존재하는지 확인
        const synonymRecord = await this.findPromptByNormalizedText(normalizedSynonym, type);

        if (synonymRecord) {
          // 기존 동의어의 사용 횟수를 메인 프롬프트에 추가
          await this.mergeUsageCount(mainPromptId, synonymRecord.usage_count, type);

          // 기존 동의어 삭제 (동의어의 group_id는 무시됨 - 메인 프롬프트의 group_id가 우선)
          await PromptCollectionModel.delete(synonymRecord.id, type);
          mergedCount++;

          console.log(`🔄 Merged synonym "${synonymRecord.prompt}" (group_id: ${synonymRecord.group_id}) into main prompt "${normalizedMain}"`);
        }

        processedSynonyms.push(normalizedSynonym);
      }

      // 3. 메인 프롬프트에 동의어 목록 설정
      await PromptCollectionModel.setSynonyms(mainPromptId, processedSynonyms, type);

      // 그룹 ID는 동의어와 별개 기능이므로 자동 설정하지 않음

      return {
        success: true,
        mergedCount,
        mainPromptId
      };

    } catch (error) {
      console.error('Error in setSynonymsAndMerge:', error);
      throw error;
    }
  }

  /**
   * 정규화된 텍스트로 프롬프트 찾기
   */
  private static findPromptByNormalizedText(
    normalizedText: string,
    type: 'positive' | 'negative'
  ): Promise<PromptCollectionRecord | NegativePromptCollectionRecord | null> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.get(
        `SELECT * FROM ${tableName} WHERE prompt = ? COLLATE NOCASE`,
        [normalizedText],
        (err, row: PromptCollectionRecord | NegativePromptCollectionRecord | undefined) => {
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
   * 사용 횟수 병합
   */
  private static mergeUsageCount(
    mainPromptId: number,
    additionalCount: number,
    type: 'positive' | 'negative'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.run(
        `UPDATE ${tableName}
         SET usage_count = usage_count + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [additionalCount, mainPromptId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 동의어 그룹에서 프롬프트 검색
   * 메인 프롬프트와 모든 동의어를 고려하여 검색
   */
  static async findInSynonymGroup(
    searchTerm: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionRecord | NegativePromptCollectionRecord | null> {
    try {
      const normalizedSearch = normalizeSearchTerm(searchTerm);
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      return new Promise((resolve, reject) => {
        // 1. 메인 프롬프트에서 직접 검색
        db.get(
          `SELECT * FROM ${tableName} WHERE prompt = ? COLLATE NOCASE`,
          [normalizedSearch],
          (err, directMatch: PromptCollectionRecord | NegativePromptCollectionRecord | undefined) => {
            if (err) {
              reject(err);
              return;
            }

            if (directMatch) {
              resolve(directMatch);
              return;
            }

            // 2. 동의어에서 검색
            db.all(
              `SELECT * FROM ${tableName} WHERE synonyms IS NOT NULL`,
              [],
              (err, rows: (PromptCollectionRecord | NegativePromptCollectionRecord)[]) => {
                if (err) {
                  reject(err);
                  return;
                }

                for (const row of rows) {
                  try {
                    const synonyms = JSON.parse(row.synonyms || '[]');
                    const normalizedSynonyms = synonyms.map((s: string) => s.toLowerCase());

                    if (normalizedSynonyms.includes(normalizedSearch.toLowerCase())) {
                      resolve(row);
                      return;
                    }
                  } catch (parseError) {
                    // JSON 파싱 오류 무시
                    continue;
                  }
                }

                resolve(null);
              }
            );
          }
        );
      });

    } catch (error) {
      console.error('Error in findInSynonymGroup:', error);
      throw error;
    }
  }

  /**
   * 동의어 제거
   */
  static async removeSynonym(
    mainPromptId: number,
    synonymToRemove: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    try {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      return new Promise((resolve, reject) => {
        // 현재 동의어 목록 가져오기
        db.get(
          `SELECT synonyms FROM ${tableName} WHERE id = ?`,
          [mainPromptId],
          (err, row: { synonyms: string } | undefined) => {
            if (err) {
              reject(err);
              return;
            }

            if (!row || !row.synonyms) {
              resolve(false);
              return;
            }

            try {
              const synonyms = JSON.parse(row.synonyms);
              const normalizedToRemove = normalizeSearchTerm(synonymToRemove).toLowerCase();

              // 동의어 제거
              const updatedSynonyms = synonyms.filter(
                (s: string) => normalizeSearchTerm(s).toLowerCase() !== normalizedToRemove
              );

              // 업데이트된 동의어 목록 저장
              const updatedSynonymsJson = JSON.stringify(updatedSynonyms);

              db.run(
                `UPDATE ${tableName}
                 SET synonyms = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [updatedSynonymsJson, mainPromptId],
                function(err) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(this.changes > 0);
                  }
                }
              );

            } catch (parseError) {
              reject(parseError);
            }
          }
        );
      });

    } catch (error) {
      console.error('Error in removeSynonym:', error);
      throw error;
    }
  }

  /**
   * 그룹의 모든 프롬프트 조회
   */
  static async getGroupPrompts(
    groupId: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<(PromptCollectionRecord | NegativePromptCollectionRecord)[]> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

      db.all(
        `SELECT * FROM ${tableName} WHERE group_id = ? ORDER BY usage_count DESC`,
        [groupId],
        (err, rows: (PromptCollectionRecord | NegativePromptCollectionRecord)[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
}