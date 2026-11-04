import { db } from '../database/init';
import { PromptCollectionModel } from '../models/PromptCollection';
import { normalizeSearchTerm } from '@conai/shared';

export class SynonymService {
  private static getTableName(type: 'positive' | 'negative' | 'auto'): string {
    if (type === 'positive') return 'prompt_collection';
    if (type === 'negative') return 'negative_prompt_collection';
    return 'auto_prompt_collection';
  }

  /**
   * 동의어 설정 및 병합 처리
   * 메인 프롬프트에 동의어들을 할당하고, 동의어 데이터를 메인 프롬프트로 병합
   */
  static async setSynonymsAndMerge(
    mainPrompt: string,
    synonyms: string[],
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<{ success: boolean; mergedCount: number; mainPromptId: number }> {
    try {
      const normalizedMain = normalizeSearchTerm(mainPrompt);
      const tableName = this.getTableName(type);
      return db.transaction(() => {
        const find = db.prepare(`SELECT id, usage_count FROM ${tableName} WHERE prompt = ? COLLATE NOCASE`);
        const merge = db.prepare(`UPDATE ${tableName} SET usage_count = usage_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        const mainRecord = find.get(normalizedMain) as { id: number } | undefined;
        let mainPromptId = mainRecord?.id;
        if (mainPromptId === undefined) {
          if (type === 'positive') mainPromptId = PromptCollectionModel.addOrIncrement(normalizedMain);
          else if (type === 'auto') mainPromptId = PromptCollectionModel.addOrIncrementAuto(normalizedMain);
          else mainPromptId = PromptCollectionModel.addOrIncrementNegative(normalizedMain);
        }

        let mergedCount = 0;
        const processedSynonyms: string[] = [];
        const mainKey = normalizedMain.toLowerCase();
        for (const synonym of synonyms) {
          const normalizedSynonym = normalizeSearchTerm(synonym);
          if (normalizedSynonym.toLowerCase() === mainKey) continue;
          const record = find.get(normalizedSynonym) as { id: number; usage_count: number } | undefined;
          if (record) {
            merge.run(record.usage_count, mainPromptId);
            PromptCollectionModel.delete(record.id, type);
            mergedCount++;
          }
          processedSynonyms.push(normalizedSynonym);
        }
        PromptCollectionModel.setSynonyms(mainPromptId, processedSynonyms, type);
        return { success: true, mergedCount, mainPromptId };
      }).immediate();
    } catch (error) {
      console.error('Error in setSynonymsAndMerge:', error);
      throw error;
    }
  }

  /**
   * 동의어 그룹에서 프롬프트 검색
   * 메인 프롬프트와 모든 동의어를 고려하여 검색
   */
  static async findInSynonymGroup(
    searchTerm: string,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<any | null> {
    try {
      const normalizedSearch = normalizeSearchTerm(searchTerm);
      const tableName = this.getTableName(type);

      // 1. 메인 프롬프트에서 직접 검색
      const directMatch = db.prepare(`SELECT * FROM ${tableName} WHERE prompt = ? COLLATE NOCASE`).get(normalizedSearch) as any | undefined;

      if (directMatch) {
        return directMatch;
      }

      // 2. 동의어에서 검색
      const rows = db.prepare(`SELECT * FROM ${tableName} WHERE synonyms IS NOT NULL`).all() as any[];

      for (const row of rows) {
        try {
          const synonyms = JSON.parse(row.synonyms || '[]');
          const normalizedSynonyms = synonyms.map((s: string) => s.toLowerCase());

          if (normalizedSynonyms.includes(normalizedSearch.toLowerCase())) {
            return row;
          }
        } catch (parseError) {
          // JSON 파싱 오류 무시
          continue;
        }
      }

      return null;

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
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<boolean> {
    try {
      const tableName = this.getTableName(type);

      // 현재 동의어 목록 가져오기
      const row = db.prepare(`SELECT synonyms FROM ${tableName} WHERE id = ?`).get(mainPromptId) as { synonyms: string } | undefined;

      if (!row || !row.synonyms) {
        return false;
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

        const info = db.prepare(`UPDATE ${tableName}
               SET synonyms = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`).run(updatedSynonymsJson, mainPromptId);

        return info.changes > 0;

      } catch (parseError) {
        throw parseError;
      }

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
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<any[]> {
    const tableName = this.getTableName(type);

    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE group_id = ? ORDER BY usage_count DESC`).all(groupId) as any[];
    return rows || [];
  }
}
