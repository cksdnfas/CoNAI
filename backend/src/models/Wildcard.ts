import { getUserSettingsDb } from '../database/userSettingsDb';

/**
 * Wildcard 인터페이스
 */
export interface Wildcard {
  id: number;
  name: string;
  description?: string;
  created_date: string;
  updated_date: string;
}

/**
 * WildcardItem 인터페이스
 */
export interface WildcardItem {
  id: number;
  wildcard_id: number;
  tool: 'comfyui' | 'nai';
  content: string;
  order_index: number;
  created_date: string;
}

/**
 * 도구별 항목 데이터
 */
export interface ToolItems {
  comfyui: string[];
  nai: string[];
}

/**
 * 와일드카드 생성 데이터
 */
export interface WildcardCreateData {
  name: string;
  description?: string;
  items: ToolItems; // 도구별 항목 배열
}

/**
 * 와일드카드 업데이트 데이터
 */
export interface WildcardUpdateData {
  name?: string;
  description?: string;
  items?: ToolItems; // 도구별 항목 배열
}

/**
 * 항목을 포함한 와일드카드
 */
export interface WildcardWithItems extends Wildcard {
  items: WildcardItem[];
}

/**
 * Wildcard Model
 * user-settings.db의 wildcards 테이블 관리
 */
export class WildcardModel {
  /**
   * 모든 와일드카드 조회
   */
  static findAll(): Wildcard[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcards ORDER BY name').all() as Wildcard[];
  }

  /**
   * ID로 와일드카드 조회
   */
  static findById(id: number): Wildcard | undefined {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcards WHERE id = ?').get(id) as Wildcard | undefined;
  }

  /**
   * 이름으로 와일드카드 조회
   */
  static findByName(name: string): Wildcard | undefined {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcards WHERE name = ?').get(name) as Wildcard | undefined;
  }

  /**
   * 와일드카드 생성
   */
  static create(data: WildcardCreateData): Wildcard {
    const db = getUserSettingsDb();

    // 트랜잭션으로 와일드카드와 항목 동시 생성
    const result = db.transaction(() => {
      // 와일드카드 생성
      const wildcardResult = db.prepare(`
        INSERT INTO wildcards (name, description)
        VALUES (?, ?)
      `).run(data.name, data.description || null);

      const wildcardId = wildcardResult.lastInsertRowid as number;

      // ComfyUI 항목 생성
      if (data.items.comfyui && data.items.comfyui.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO wildcard_items (wildcard_id, tool, content, order_index)
          VALUES (?, ?, ?, ?)
        `);

        data.items.comfyui.forEach((content, index) => {
          insertItem.run(wildcardId, 'comfyui', content, index);
        });
      }

      // NAI 항목 생성
      if (data.items.nai && data.items.nai.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO wildcard_items (wildcard_id, tool, content, order_index)
          VALUES (?, ?, ?, ?)
        `);

        data.items.nai.forEach((content, index) => {
          insertItem.run(wildcardId, 'nai', content, index);
        });
      }

      return WildcardModel.findById(wildcardId);
    })();

    if (!result) {
      throw new Error('Failed to create wildcard');
    }

    return result;
  }

  /**
   * 와일드카드 업데이트
   */
  static update(id: number, data: WildcardUpdateData): Wildcard {
    const db = getUserSettingsDb();

    const result = db.transaction(() => {
      // 와일드카드 기본 정보 업데이트
      const updates: string[] = [];
      const params: any[] = [];

      if (data.name !== undefined) {
        updates.push('name = ?');
        params.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push('description = ?');
        params.push(data.description);
      }

      updates.push('updated_date = CURRENT_TIMESTAMP');
      params.push(id);

      if (updates.length > 0) {
        db.prepare(`
          UPDATE wildcards
          SET ${updates.join(', ')}
          WHERE id = ?
        `).run(...params);
      }

      // 항목 업데이트 (있는 경우)
      if (data.items !== undefined) {
        // 기존 항목 삭제
        db.prepare('DELETE FROM wildcard_items WHERE wildcard_id = ?').run(id);

        // ComfyUI 항목 삽입
        if (data.items.comfyui && data.items.comfyui.length > 0) {
          const insertItem = db.prepare(`
            INSERT INTO wildcard_items (wildcard_id, tool, content, order_index)
            VALUES (?, ?, ?, ?)
          `);

          data.items.comfyui.forEach((content, index) => {
            insertItem.run(id, 'comfyui', content, index);
          });
        }

        // NAI 항목 삽입
        if (data.items.nai && data.items.nai.length > 0) {
          const insertItem = db.prepare(`
            INSERT INTO wildcard_items (wildcard_id, tool, content, order_index)
            VALUES (?, ?, ?, ?)
          `);

          data.items.nai.forEach((content, index) => {
            insertItem.run(id, 'nai', content, index);
          });
        }
      }

      return WildcardModel.findById(id);
    })();

    if (!result) {
      throw new Error('Failed to update wildcard');
    }

    return result;
  }

  /**
   * 와일드카드 삭제
   */
  static delete(id: number): boolean {
    const db = getUserSettingsDb();
    const result = db.prepare('DELETE FROM wildcards WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 항목을 포함한 와일드카드 조회
   */
  static findByIdWithItems(id: number): WildcardWithItems | undefined {
    const wildcard = WildcardModel.findById(id);
    if (!wildcard) return undefined;

    const items = WildcardItemModel.findByWildcardId(id);
    return { ...wildcard, items };
  }

  /**
   * 항목을 포함한 모든 와일드카드 조회
   */
  static findAllWithItems(): WildcardWithItems[] {
    const wildcards = WildcardModel.findAll();
    return wildcards.map(wildcard => {
      const items = WildcardItemModel.findByWildcardId(wildcard.id);
      return { ...wildcard, items };
    });
  }
}

/**
 * WildcardItem Model
 * user-settings.db의 wildcard_items 테이블 관리
 */
export class WildcardItemModel {
  /**
   * 와일드카드 ID로 항목 조회
   */
  static findByWildcardId(wildcardId: number): WildcardItem[] {
    const db = getUserSettingsDb();
    return db.prepare(`
      SELECT * FROM wildcard_items
      WHERE wildcard_id = ?
      ORDER BY order_index
    `).all(wildcardId) as WildcardItem[];
  }

  /**
   * 항목 ID로 조회
   */
  static findById(id: number): WildcardItem | undefined {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcard_items WHERE id = ?').get(id) as WildcardItem | undefined;
  }

  /**
   * 항목 생성
   */
  static create(wildcardId: number, tool: 'comfyui' | 'nai', content: string, orderIndex: number): WildcardItem {
    const db = getUserSettingsDb();
    const result = db.prepare(`
      INSERT INTO wildcard_items (wildcard_id, tool, content, order_index)
      VALUES (?, ?, ?, ?)
    `).run(wildcardId, tool, content, orderIndex);

    const item = WildcardItemModel.findById(result.lastInsertRowid as number);
    if (!item) {
      throw new Error('Failed to create wildcard item');
    }

    return item;
  }

  /**
   * 특정 도구의 항목만 조회
   */
  static findByWildcardIdAndTool(wildcardId: number, tool: 'comfyui' | 'nai'): WildcardItem[] {
    const db = getUserSettingsDb();
    return db.prepare(`
      SELECT * FROM wildcard_items
      WHERE wildcard_id = ? AND tool = ?
      ORDER BY order_index
    `).all(wildcardId, tool) as WildcardItem[];
  }

  /**
   * 항목 삭제
   */
  static delete(id: number): boolean {
    const db = getUserSettingsDb();
    const result = db.prepare('DELETE FROM wildcard_items WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
