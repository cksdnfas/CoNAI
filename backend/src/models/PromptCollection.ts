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
  static async addOrIncrement(prompt: string, group_id?: number): Promise<number> {
    const row = db.prepare('SELECT id, usage_count FROM prompt_collection WHERE prompt = ?').get(prompt) as PromptCollectionRecord | undefined;

    if (row) {
      db.prepare('UPDATE prompt_collection SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
      return row.id;
    } else {
      const info = db.prepare(`
        INSERT INTO prompt_collection (prompt, usage_count, group_id)
        VALUES (?, 1, ?)
      `).run(prompt, group_id || null);
      return info.lastInsertRowid as number;
    }
  }

  /**
   * 네거티브 프롬프트 추가 또는 사용 횟수 증가
   */
  static async addOrIncrementNegative(prompt: string, group_id?: number): Promise<number> {
    const row = db.prepare('SELECT id, usage_count FROM negative_prompt_collection WHERE prompt = ?').get(prompt) as NegativePromptCollectionRecord | undefined;

    if (row) {
      db.prepare('UPDATE negative_prompt_collection SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
      return row.id;
    } else {
      const info = db.prepare(`
        INSERT INTO negative_prompt_collection (prompt, usage_count, group_id)
        VALUES (?, 1, ?)
      `).run(prompt, group_id || null);
      return info.lastInsertRowid as number;
    }
  }

  /**
   * 프롬프트 검색 (포지티브)
   */
  static async searchPrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    const searchPattern = `%${query}%`;
    const offset = (page - 1) * limit;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM prompt_collection WHERE prompt LIKE ?').get(searchPattern) as { total: number };
    const total = countRow.total;

    const rows = db.prepare(
      `SELECT id, prompt, usage_count, group_id, synonyms
       FROM prompt_collection
       WHERE prompt LIKE ?
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`
    ).all(searchPattern, limit, offset) as PromptCollectionRecord[];

    const prompts: PromptSearchResult[] = rows.map(row => ({
      id: row.id,
      prompt: row.prompt,
      usage_count: row.usage_count,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
      type: 'positive' as const
    }));

    return { prompts, total };
  }

  /**
   * 네거티브 프롬프트 검색
   */
  static async searchNegativePrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    const searchPattern = `%${query}%`;
    const offset = (page - 1) * limit;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM negative_prompt_collection WHERE prompt LIKE ?').get(searchPattern) as { total: number };
    const total = countRow.total;

    const rows = db.prepare(
      `SELECT id, prompt, usage_count, group_id, synonyms
       FROM negative_prompt_collection
       WHERE prompt LIKE ?
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`
    ).all(searchPattern, limit, offset) as NegativePromptCollectionRecord[];

    const prompts: PromptSearchResult[] = rows.map(row => ({
      id: row.id,
      prompt: row.prompt,
      usage_count: row.usage_count,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
      type: 'negative' as const
    }));

    return { prompts, total };
  }

  /**
   * 가장 많이 사용된 프롬프트 조회
   */
  static async getMostUsedPrompts(limit: number = 10): Promise<PromptSearchResult[]> {
    const rows = db.prepare(
      `SELECT id, prompt, usage_count, group_id, synonyms, 'positive' as type
       FROM prompt_collection
       ORDER BY usage_count DESC
       LIMIT ?`
    ).all(limit) as any[];

    const prompts: PromptSearchResult[] = rows.map(row => ({
      id: row.id,
      prompt: row.prompt,
      usage_count: row.usage_count,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
      type: row.type
    }));

    return prompts;
  }

  /**
   * 동의어 설정
   */
  static async setSynonyms(id: number, synonyms: string[], type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
    const synonymsJson = JSON.stringify(synonyms);

    const info = db.prepare(`UPDATE ${tableName} SET synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(synonymsJson, id);
    return info.changes > 0;
  }

  /**
   * 그룹 ID 설정
   */
  static async setGroupId(id: number, group_id: number | null, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

    const info = db.prepare(`UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(group_id, id);
    return info.changes > 0;
  }

  /**
   * 프롬프트 사용 횟수 감소 (삭제 시)
   * 사용 횟수가 0이 되어도 그룹 정보와 사용자 설정 보존을 위해 레코드 삭제하지 않음
   */
  static async decrementUsage(prompt: string, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

    const row = db.prepare(`SELECT id, usage_count FROM ${tableName} WHERE prompt = ?`).get(prompt) as any;

    if (!row) {
      return false;
    }

    if (row.usage_count <= 0) {
      return false;
    }

    const info = db.prepare(`UPDATE ${tableName} SET usage_count = MAX(0, usage_count - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
    return info.changes > 0;
  }

  /**
   * 프롬프트 삭제 (사용자에 의한 수동 삭제만 허용)
   */
  static async delete(id: number, type: 'positive' | 'negative' = 'positive'): Promise<boolean> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

    const info = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /**
   * 모든 프롬프트 설정 내보내기 (JSON 공유용)
   */
  static async exportAllSettings(type: 'positive' | 'negative' = 'positive'): Promise<any[]> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';

    const rows = db.prepare(
      `SELECT prompt, group_id, synonyms FROM ${tableName}
       WHERE group_id IS NOT NULL OR synonyms IS NOT NULL
       ORDER BY prompt`
    ).all() as any[];

    const settings = rows.map(row => ({
      prompt: row.prompt,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : null
    }));

    return settings;
  }

  /**
   * 프롬프트 설정 일괄 가져오기 (JSON 공유용)
   */
  static async importSettings(settings: any[], type: 'positive' | 'negative' = 'positive'): Promise<number> {
    const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
    let updatedCount = 0;

    if (settings.length === 0) {
      return 0;
    }

    for (const setting of settings) {
      const row = db.prepare(`SELECT id FROM ${tableName} WHERE prompt = ?`).get(setting.prompt) as any;

      if (row) {
        const synonymsJson = setting.synonyms ? JSON.stringify(setting.synonyms) : null;
        const info = db.prepare(`UPDATE ${tableName} SET group_id = ?, synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(setting.group_id || null, synonymsJson, row.id);
        if (info.changes > 0) updatedCount++;
      } else {
        const synonymsJson = setting.synonyms ? JSON.stringify(setting.synonyms) : null;
        db.prepare(`INSERT INTO ${tableName} (prompt, usage_count, group_id, synonyms) VALUES (?, 0, ?, ?)`).run(setting.prompt, setting.group_id || null, synonymsJson);
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
