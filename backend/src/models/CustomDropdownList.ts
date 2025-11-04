import { userSettingsDb } from '../database/userSettingsDb';

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
    const fields: string[] = [];
    const values: any[] = [];

    if (listData.name !== undefined) {
      fields.push('name = ?');
      values.push(listData.name);
    }
    if (listData.description !== undefined) {
      fields.push('description = ?');
      values.push(listData.description);
    }
    if (listData.items !== undefined) {
      fields.push('items = ?');
      values.push(JSON.stringify(listData.items));
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE custom_dropdown_lists SET ${fields.join(', ')} WHERE id = ?`;
    const info = userSettingsDb.prepare(query).run(...values);
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
