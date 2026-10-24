import { db } from '../database/init';
import { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } from '../utils/sqlLike';
import { PromptCollectionRecord,
PromptCollectionData,
PromptSearchResult,
PAGINATION } from '@conai/shared';
import { getPromptCollectionTableName as getTableName, type PromptTableType } from '../utils/promptTables';

type PromptSearchRow = Pick<PromptCollectionRecord, 'id' | 'prompt' | 'usage_count' | 'group_id' | 'synonyms'>
  & Pick<PromptSearchResult, 'type'>;

function addOrIncrementPrompt(type: PromptTableType, prompt: string, group_id?: number): number {
  const tableName = getTableName(type);
  const row = db.prepare(`SELECT id, usage_count FROM ${tableName} WHERE prompt = ?`).get(prompt) as PromptCollectionRecord | undefined;

  if (row) {
    db.prepare(`UPDATE ${tableName} SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
    return row.id;
  } else {
    const info = db.prepare(`
      INSERT INTO ${tableName} (prompt, usage_count, group_id)
      VALUES (?, 1, ?)
    `).run(prompt, group_id || null);
    return info.lastInsertRowid as number;
  }
}

function batchAddOrIncrementPrompts(type: PromptTableType, prompts: PromptCollectionData[]): number {
  if (!prompts || prompts.length === 0) {
    return 0;
  }

  const tableName = getTableName(type);
  let processedCount = 0;
  const transaction = db.transaction(() => {
    const selectStmt = db.prepare(`SELECT id, usage_count FROM ${tableName} WHERE prompt = ?`);
    const updateStmt = db.prepare(`UPDATE ${tableName} SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    const insertStmt = db.prepare(`INSERT INTO ${tableName} (prompt, usage_count, group_id) VALUES (?, 1, ?)`);

    for (const item of prompts) {
      const row = selectStmt.get(item.prompt) as PromptCollectionRecord | undefined;
      if (row) {
        updateStmt.run(row.id);
      } else {
        insertStmt.run(item.prompt, item.group_id || null);
      }
      processedCount++;
    }
  });

  // IMMEDIATE: the batch reads before it writes, and a deferred read transaction cannot be upgraded
  // (SQLITE_BUSY at once, busy_timeout ignored) once another connection has written.
  transaction.immediate();
  return processedCount;
}

export class PromptCollectionModel {
  /**
   * 프롬프트 추가 또는 사용 횟수 증가
   */
  static addOrIncrement(prompt: string, group_id?: number): number {
    return addOrIncrementPrompt('positive', prompt, group_id);
  }

  /**
   * 네거티브 프롬프트 추가 또는 사용 횟수 증가
   */
  static addOrIncrementNegative(prompt: string, group_id?: number): number {
    return addOrIncrementPrompt('negative', prompt, group_id);
  }

  /**
   * 자동 프롬프트(태그) 추가 또는 사용 횟수 증가
   */
  static addOrIncrementAuto(prompt: string, group_id?: number): number {
    return addOrIncrementPrompt('auto', prompt, group_id);
  }

  /**
   * 배치 프롬프트 추가 또는 사용 횟수 증가 (성능 최적화)
   * @param prompts - 프롬프트와 그룹 ID 배열
   * @returns 처리된 프롬프트 수
   */
  static batchAddOrIncrement(prompts: Array<{ prompt: string; group_id?: number }>): number {
    return batchAddOrIncrementPrompts('positive', prompts);
  }

  /**
   * 배치 네거티브 프롬프트 추가 또는 사용 횟수 증가 (성능 최적화)
   * @param prompts - 프롬프트와 그룹 ID 배열
   * @returns 처리된 프롬프트 수
   */
  static batchAddOrIncrementNegative(prompts: Array<{ prompt: string; group_id?: number }>): number {
    return batchAddOrIncrementPrompts('negative', prompts);
  }

  /**
   * 배치 자동 프롬프트 추가 또는 사용 횟수 증가
   */
  static batchAddOrIncrementAuto(prompts: Array<{ prompt: string; group_id?: number }>): number {
    return batchAddOrIncrementPrompts('auto', prompts);
  }

  /**
   * 프롬프트 검색 (포지티브)
   */
  static searchPrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    type: 'positive' | 'negative' | 'auto' | 'both' = 'positive'
  ): { prompts: PromptSearchResult[], total: number } {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('page and limit must be positive integers');
    }
    limit = Math.min(limit, PAGINATION.MAX_LIMIT);
    const searchPattern = buildSqlContainsPattern(query);
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      throw new RangeError('page is too large');
    }

    const types: Array<PromptSearchResult['type']> = type === 'both' ? ['positive', 'negative']
      : [type === 'auto' ? 'auto' : type === 'negative' ? 'negative' : 'positive'];
    const orderBy = sortBy === 'created_at' ? 'created_at' : sortBy === 'prompt' ? 'prompt' : 'usage_count';
    const orderDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const where = `WHERE prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`;
    const patterns = types.map(() => searchPattern);
    const countQuery = types.map(promptType => `SELECT COUNT(*) AS total FROM ${getTableName(promptType)} ${where}`).join(' UNION ALL ');
    const countRow = db.prepare(`SELECT SUM(total) AS total FROM (${countQuery})`).get(...patterns) as { total: number };
    const total = countRow.total;

    const localeSort = type === 'both' && orderBy === 'prompt';
    const selectQuery = types.map(promptType => {
      const select = `SELECT id, prompt, usage_count, group_id, synonyms, created_at, '${promptType}' AS type
        FROM ${getTableName(promptType)} ${where}`;
      return localeSort ? `SELECT * FROM (${select} ORDER BY prompt ${orderDirection})` : select;
    }).join(' UNION ALL ');

    let rows: PromptSearchRow[];
    if (localeSort) {
      // "both" historically uses localeCompare, unlike single-type SQLite BINARY ordering.
      // Stream matches and retain only a bounded prefix rather than materializing the whole collection.
      const prefixSize = Math.min(offset + limit, total);
      const compare = (a: PromptSearchRow, b: PromptSearchRow) => orderDirection === 'DESC'
        ? b.prompt.localeCompare(a.prompt) : a.prompt.localeCompare(b.prompt);
      rows = [];
      if (offset < total) {
        for (const row of db.prepare(selectQuery).iterate(...patterns) as Iterable<PromptSearchRow>) {
          rows.push(row);
          if (rows.length === prefixSize * 2) {
            rows.sort(compare);
            rows.length = prefixSize;
          }
        }
        rows.sort(compare);
        rows = rows.slice(offset, offset + limit);
      }
    } else {
      rows = db.prepare(
        `SELECT * FROM (${selectQuery}) ORDER BY ${orderBy} ${orderDirection}${type === 'both' ? ', type ASC, id ASC' : ''} LIMIT ? OFFSET ?`
      ).all(...patterns, limit, offset) as PromptSearchRow[];
    }

    const prompts: PromptSearchResult[] = rows.map(row => ({
      id: row.id,
      prompt: row.prompt,
      usage_count: row.usage_count,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
      type: row.type
    }));

    return { prompts, total };
  }

  /**
   * 자동 프롬프트 검색
   */
  static searchAutoPrompts(
    query: string,
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): { prompts: PromptSearchResult[], total: number } {
    return this.searchPrompts(query, page, limit, sortBy, sortOrder, 'auto');
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
  ): { prompts: PromptSearchResult[], total: number } {
    return this.searchPrompts(query, page, limit, sortBy, sortOrder, 'negative');
  }

  /**
   * 가장 많이 사용된 프롬프트 조회
   */
  static getMostUsedPrompts(limit: number = 10): PromptSearchResult[] {
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
  static setSynonyms(id: number, synonyms: string[], type: 'positive' | 'negative' | 'auto' = 'positive'): boolean {
    const tableName = getTableName(type);
    const synonymsJson = JSON.stringify(synonyms);

    const info = db.prepare(`UPDATE ${tableName} SET synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(synonymsJson, id);
    return info.changes > 0;
  }

  /**
   * 그룹 ID 설정
   */
  static setGroupId(id: number, group_id: number | null, type: 'positive' | 'negative' | 'auto' = 'positive'): boolean {
    const tableName = getTableName(type);

    const info = db.prepare(`UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(group_id, id);
    return info.changes > 0;
  }

  /**
   * 프롬프트 사용 횟수 감소 (삭제 시)
   * 사용 횟수가 0이 되어도 그룹 정보와 사용자 설정 보존을 위해 레코드 삭제하지 않음
   */
  static decrementUsage(prompt: string, type: 'positive' | 'negative' | 'auto' = 'positive'): boolean {
    const tableName = getTableName(type);

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
   * 그룹에 속한 전체 프롬프트 조회
   */
  static getPromptsByGroupId(groupId: number | null, type: 'positive' | 'negative' | 'auto' = 'positive'): any[] {
    const tableName = getTableName(type);
    const rows = groupId === null
      ? db.prepare(`SELECT * FROM ${tableName} WHERE group_id IS NULL ORDER BY usage_count DESC, prompt ASC`).all() as any[]
      : db.prepare(`SELECT * FROM ${tableName} WHERE group_id = ? ORDER BY usage_count DESC, prompt ASC`).all(groupId) as any[];

    return rows.map((row) => ({
      ...row,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
    }));
  }

  /**
   * ID로 프롬프트 조회
   */
  static findById(id: number, type: 'positive' | 'negative' | 'auto' = 'positive'): any | null {
    const tableName = getTableName(type);
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as any;
    return row || null;
  }

  /**
   * 프롬프트 삭제 (사용자에 의한 수동 삭제만 허용)
   */
  static delete(id: number, type: 'positive' | 'negative' | 'auto' = 'positive'): boolean {
    const tableName = getTableName(type);

    const info = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /**
   * 모든 프롬프트 전체 내보내기 (백업용 - usage_count 포함)
   */
  static exportAllPrompts(type: 'positive' | 'negative' | 'auto' = 'positive'): any[] {
    const tableName = getTableName(type);

    const rows = db.prepare(
      `SELECT prompt, usage_count, group_id, synonyms FROM ${tableName} ORDER BY prompt`
    ).all() as any[];

    return rows.map(row => ({
      prompt: row.prompt,
      usage_count: row.usage_count,
      group_id: row.group_id,
      synonyms: row.synonyms ? JSON.parse(row.synonyms) : null
    }));
  }

  /**
   * 모든 프롬프트 설정 내보내기 (JSON 공유용)
   */
  static exportAllSettings(type: 'positive' | 'negative' | 'auto' = 'positive'): any[] {
    const tableName = getTableName(type);

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
  static importSettings(settings: any[], type: 'positive' | 'negative' | 'auto' = 'positive'): number {
    const tableName = getTableName(type);
    let updatedCount = 0;

    if (settings.length === 0) {
      return 0;
    }

    for (const setting of settings) {
      const row = db.prepare(`SELECT id FROM ${tableName} WHERE prompt = ?`).get(setting.prompt) as any;
      const synonymsJson = setting.synonyms ? JSON.stringify(setting.synonyms) : null;
      const usageCount = typeof setting.usage_count === 'number' && Number.isFinite(setting.usage_count)
        ? Math.max(0, Math.trunc(setting.usage_count))
        : 0;

      if (row) {
        const info = db.prepare(`UPDATE ${tableName} SET usage_count = ?, group_id = ?, synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          usageCount,
          setting.group_id ?? null,
          synonymsJson,
          row.id
        );
        if (info.changes > 0) updatedCount++;
      } else {
        db.prepare(`INSERT INTO ${tableName} (prompt, usage_count, group_id, synonyms) VALUES (?, ?, ?, ?)`).run(
          setting.prompt,
          usageCount,
          setting.group_id ?? null,
          synonymsJson
        );
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
