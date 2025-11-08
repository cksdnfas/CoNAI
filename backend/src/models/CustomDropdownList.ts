import { userSettingsDb } from '../database/userSettingsDb';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

export interface CustomDropdownListRecord {
  id: number;
  name: string;
  description: string | null;
  items: string; // JSON string array
  created_date: string;
  updated_date: string;
}

export interface CustomDropdownListCreateData {
  name: string;
  description?: string;
  items: string[]; // Array of strings
}

export interface CustomDropdownListUpdateData {
  name?: string;
  description?: string;
  items?: string[];
}

export interface CustomDropdownListWithParsedItems extends Omit<CustomDropdownListRecord, 'items'> {
  items: string[];
}

export class CustomDropdownListModel {
  /**
   * 새 커스텀 드롭다운 목록 생성
   */
  static async create(listData: CustomDropdownListCreateData): Promise<number> {
    const itemsJson = JSON.stringify(listData.items);

    const info = userSettingsDb.prepare(`
      INSERT INTO custom_dropdown_lists (
        name, description, items
      ) VALUES (?, ?, ?)
    `).run(
      listData.name,
      listData.description || null,
      itemsJson
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 커스텀 드롭다운 목록 조회 (ID)
   */
  static async findById(id: number): Promise<CustomDropdownListWithParsedItems | null> {
    const row = userSettingsDb.prepare(
      'SELECT * FROM custom_dropdown_lists WHERE id = ?'
    ).get(id) as CustomDropdownListRecord | undefined;

    if (!row) return null;

    return {
      ...row,
      items: JSON.parse(row.items) as string[]
    };
  }

  /**
   * 커스텀 드롭다운 목록 조회 (이름)
   */
  static async findByName(name: string): Promise<CustomDropdownListWithParsedItems | null> {
    const row = userSettingsDb.prepare(
      'SELECT * FROM custom_dropdown_lists WHERE name = ?'
    ).get(name) as CustomDropdownListRecord | undefined;

    if (!row) return null;

    return {
      ...row,
      items: JSON.parse(row.items) as string[]
    };
  }

  /**
   * 모든 커스텀 드롭다운 목록 조회
   */
  static async findAll(): Promise<CustomDropdownListWithParsedItems[]> {
    const rows = userSettingsDb.prepare(
      'SELECT * FROM custom_dropdown_lists ORDER BY created_date DESC'
    ).all() as CustomDropdownListRecord[];

    return rows.map(row => ({
      ...row,
      items: JSON.parse(row.items) as string[]
    }));
  }

  /**
   * 커스텀 드롭다운 목록 업데이트
   */
  static async update(id: number, listData: CustomDropdownListUpdateData): Promise<boolean> {
    // items는 JSON.stringify 처리
    const cleanData: Record<string, any> = {
      ...listData,
      items: listData.items !== undefined ? JSON.stringify(listData.items) : undefined
    };

    const updates = filterDefined(cleanData);

    if (Object.keys(updates).length === 0) {
      return false;
    }

    // updated_date는 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...updates,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery('custom_dropdown_lists', finalUpdates, { id });
    const info = userSettingsDb.prepare(sql).run(...values);
    return info.changes > 0;
  }

  /**
   * 커스텀 드롭다운 목록 삭제
   */
  static async delete(id: number): Promise<boolean> {
    const info = userSettingsDb.prepare(
      'DELETE FROM custom_dropdown_lists WHERE id = ?'
    ).run(id);
    return info.changes > 0;
  }

  /**
   * 이름 중복 확인
   */
  static async existsByName(name: string, excludeId?: number): Promise<boolean> {
    let query = 'SELECT 1 FROM custom_dropdown_lists WHERE name = ?';
    const params: any[] = [name];

    if (excludeId !== undefined) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const row = userSettingsDb.prepare(query).get(...params);
    return !!row;
  }

  /**
   * 목록 개수 조회
   */
  static async count(): Promise<number> {
    const result = userSettingsDb.prepare(
      'SELECT COUNT(*) as count FROM custom_dropdown_lists'
    ).get() as { count: number };
    return result.count;
  }
}
