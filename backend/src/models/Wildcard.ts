import { getUserSettingsDb } from '../database/userSettingsDb';

/**
 * Wildcard 인터페이스
 */
export interface Wildcard {
  id: number;
  name: string;
  description?: string;
  parent_id: number | null;
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
  customId?: number; // 자동 LORA용 커스텀 ID (선택적)
  parent_id?: number | null; // 부모 와일드카드 ID
}

/**
 * 와일드카드 업데이트 데이터
 */
export interface WildcardUpdateData {
  name?: string;
  description?: string;
  items?: ToolItems; // 도구별 항목 배열
  parent_id?: number | null; // 부모 와일드카드 ID
}

/**
 * 항목을 포함한 와일드카드
 */
export interface WildcardWithItems extends Wildcard {
  items: WildcardItem[];
}

/**
 * 계층 구조를 포함한 와일드카드
 */
export interface WildcardWithHierarchy extends WildcardWithItems {
  children?: WildcardWithHierarchy[];
  parent?: Wildcard;
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
      // 와일드카드 생성 (커스텀 ID 지원)
      let wildcardId: number;

      if (data.customId) {
        // 커스텀 ID로 생성 (자동 LORA용)
        db.prepare(`
          INSERT INTO wildcards (id, name, description, parent_id)
          VALUES (?, ?, ?, ?)
        `).run(data.customId, data.name, data.description || null, data.parent_id ?? null);
        wildcardId = data.customId;
      } else {
        // 기본 자동 증가 ID
        const wildcardResult = db.prepare(`
          INSERT INTO wildcards (name, description, parent_id)
          VALUES (?, ?, ?)
        `).run(data.name, data.description || null, data.parent_id ?? null);
        wildcardId = wildcardResult.lastInsertRowid as number;
      }

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
      if (data.parent_id !== undefined) {
        updates.push('parent_id = ?');
        params.push(data.parent_id);
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

  /**
   * 루트 와일드카드만 조회 (parent_id가 NULL인 것들)
   */
  static findRoots(): Wildcard[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcards WHERE parent_id IS NULL ORDER BY name').all() as Wildcard[];
  }

  /**
   * 특정 부모의 자식 와일드카드 조회
   */
  static findByParentId(parentId: number): Wildcard[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM wildcards WHERE parent_id = ? ORDER BY name').all(parentId) as Wildcard[];
  }

  /**
   * 계층 구조로 모든 와일드카드 조회 (재귀)
   */
  static findHierarchy(parentId: number | null = null): WildcardWithHierarchy[] {
    const db = getUserSettingsDb();
    const wildcards = parentId === null
      ? db.prepare('SELECT * FROM wildcards WHERE parent_id IS NULL ORDER BY name').all() as Wildcard[]
      : db.prepare('SELECT * FROM wildcards WHERE parent_id = ? ORDER BY name').all(parentId) as Wildcard[];

    return wildcards.map(wildcard => {
      const items = WildcardItemModel.findByWildcardId(wildcard.id);
      const children = WildcardModel.findHierarchy(wildcard.id);
      return { ...wildcard, items, children: children.length > 0 ? children : undefined };
    });
  }

  /**
   * 특정 와일드카드의 전체 경로 조회 (루트부터 현재까지)
   */
  static getFullPath(wildcardId: number): Wildcard[] {
    const path: Wildcard[] = [];
    let currentId: number | null = wildcardId;

    while (currentId !== null) {
      const wildcard = WildcardModel.findById(currentId);
      if (!wildcard) break;
      path.unshift(wildcard);
      currentId = wildcard.parent_id;
    }

    return path;
  }

  /**
   * 모든 자식 와일드카드 재귀 조회 (자기 자신 미포함)
   */
  static getAllDescendants(wildcardId: number): Wildcard[] {
    const descendants: Wildcard[] = [];
    const directChildren = WildcardModel.findByParentId(wildcardId);

    for (const child of directChildren) {
      descendants.push(child);
      descendants.push(...WildcardModel.getAllDescendants(child.id));
    }

    return descendants;
  }

  /**
   * 순환 참조 검사 (parent_id 설정 전 호출)
   */
  static checkCircularReference(wildcardId: number, targetParentId: number): boolean {
    if (wildcardId === targetParentId) return true;

    let currentId: number | null = targetParentId;
    const visited = new Set<number>();

    while (currentId !== null) {
      if (visited.has(currentId) || currentId === wildcardId) {
        return true; // 순환 참조 발견
      }
      visited.add(currentId);
      const parent = WildcardModel.findById(currentId);
      currentId = parent?.parent_id ?? null;
    }

    return false;
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
