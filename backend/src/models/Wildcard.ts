import { getUserSettingsDb } from '../database/userSettingsDb';
import { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } from '../utils/sqlLike';
import { attachPromptItems, buildPromptTree, deletePromptTreeNode, readPromptTreeRows } from './promptLibraryTree';

/**
 * Wildcard 인터페이스
 */
export interface Wildcard {
  id: number;
  name: string;
  description?: string;
  parent_id: number | null;
  include_children: number; // 0 or 1: 하위 와일드카드 자동 포함 여부
  only_children: number; // 0 or 1: 하위 와일드카드만 사용 여부 (자신 제외)
  type: 'wildcard' | 'chain';
  chain_option: 'replace' | 'append';
  created_date: string;
  updated_date: string;
}

/**
 * WildcardItem 인터페이스
 */
export type WildcardTool = 'general' | 'comfyui' | 'nai';

const WILDCARD_TOOLS: WildcardTool[] = ['general', 'nai', 'comfyui'];

export interface WildcardItem {
  id: number;
  wildcard_id: number;
  tool: WildcardTool;
  content: string;
  weight: number;
  order_index: number;
  created_date: string;
}

/**
 * 도구별 항목 데이터
 */
export interface ToolItems {
  general: Array<{ content: string; weight: number }>;
  comfyui: Array<{ content: string; weight: number }>;
  nai: Array<{ content: string; weight: number }>;
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
  include_children?: number; // 하위 와일드카드 자동 포함 여부 (기본값 0)
  only_children?: number; // 하위 와일드카드만 사용 여부 (기본값 0)
  type?: 'wildcard' | 'chain';
  chain_option?: 'replace' | 'append';
}

/**
 * 와일드카드 업데이트 데이터
 */
export interface WildcardUpdateData {
  name?: string;
  description?: string;
  items?: ToolItems; // 도구별 항목 배열
  parent_id?: number | null; // 부모 와일드카드 ID
  include_children?: number; // 하위 와일드카드 자동 포함 여부
  only_children?: number; // 하위 와일드카드만 사용 여부
  type?: 'wildcard' | 'chain';
  chain_option?: 'replace' | 'append';
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

export interface WildcardSummary extends Wildcard {
  item_counts: Record<WildcardTool, number>;
  children?: WildcardSummary[];
}

/** The caller owns the transaction: a manual create writes one row, a LoRA rescan replaces a whole set. */
export function prepareWildcardInsert() {
  const db = getUserSettingsDb();
  const insert = db.prepare(`INSERT INTO wildcards
    (id, name, description, parent_id, include_children, only_children, type, chain_option, is_auto_collected, lora_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const item = db.prepare('INSERT INTO wildcard_items (wildcard_id, tool, content, weight, order_index) VALUES (?, ?, ?, ?, ?)');
  return (data: WildcardCreateData, scanWeight?: number): number => {
    const id = Number(insert.run(data.customId || null, data.name, data.description || null, data.parent_id ?? null,
      data.include_children ?? 0, data.only_children ?? 0, data.type || 'wildcard', data.chain_option || 'replace',
      scanWeight === undefined ? 0 : 1, scanWeight ?? 1).lastInsertRowid);
    for (const tool of WILDCARD_TOOLS) {
      (data.items[tool] ?? []).forEach((entry, index) => item.run(id, tool, entry.content, entry.weight, index));
    }
    return id;
  };
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
      return WildcardModel.findById(prepareWildcardInsert()(data));
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
      if (data.include_children !== undefined) {
        updates.push('include_children = ?');
        params.push(data.include_children);
      }
      if (data.only_children !== undefined) {
        updates.push('only_children = ?');
        params.push(data.only_children);
      }
      if (data.type !== undefined) {
        updates.push('type = ?');
        params.push(data.type);
      }
      if (data.chain_option !== undefined) {
        updates.push('chain_option = ?');
        params.push(data.chain_option);
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

        const insertItem = db.prepare(`
          INSERT INTO wildcard_items (wildcard_id, tool, content, weight, order_index)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const tool of WILDCARD_TOOLS) {
          const items = data.items[tool] ?? [];
          items.forEach((item, index) => {
            insertItem.run(id, tool, item.content, item.weight, index);
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
   * @param id 삭제할 와일드카드 ID
   * @param cascade true인 경우 모든 하위 와일드카드도 함께 삭제, false인 경우 자식들의 parent_id를 현재 와일드카드의 parent_id로 변경
   */
  static delete(id: number, cascade: boolean = false): boolean {
    return deletePromptTreeNode('wildcards', id, cascade);
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
    return WildcardModel.withItems(WildcardModel.findAll());
  }

  /** Load only named roots and children that can participate in their item selection. */
  static findForResolution(names: string[]): Wildcard[] {
    if (names.length === 0) return [];
    const db = getUserSettingsDb();
    return db.prepare(`
      WITH RECURSIVE referenced(id) AS (
        SELECT id FROM wildcards WHERE name IN (SELECT value FROM json_each(?))
        UNION
        SELECT child.id FROM wildcards child
        JOIN wildcards parent ON child.parent_id = parent.id
        JOIN referenced ON referenced.id = parent.id
        WHERE parent.include_children = 1 OR parent.only_children = 1
      )
      SELECT * FROM wildcards WHERE id IN (SELECT id FROM referenced) ORDER BY name
    `).all(JSON.stringify(names)) as Wildcard[];
  }

  /** Attach items in one batch, retaining the per-wildcard order used by weighted picks. */
  static withItems(wildcards: Wildcard[], itemWildcardIds = wildcards.map(wildcard => wildcard.id)): WildcardWithItems[] {
    return attachPromptItems(wildcards, WildcardItemModel.findByWildcardIds(itemWildcardIds), item => item.wildcard_id);
  }

  /**
   * 와일드카드 검색 (이름 LIKE 검색 + 페이지네이션)
   */
  static search(query: string, page: number = 1, limit: number = 50): { wildcards: Wildcard[]; total: number } {
    const db = getUserSettingsDb();
    const offset = (page - 1) * limit;
    const pattern = buildSqlContainsPattern(query);

    const total = (db.prepare(
      `SELECT COUNT(*) as count FROM wildcards WHERE name LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`
    ).get(pattern) as { count: number }).count;

    const wildcards = db.prepare(
      `SELECT * FROM wildcards WHERE name LIKE ?${SQL_LIKE_ESCAPE_CLAUSE} ORDER BY name LIMIT ? OFFSET ?`
    ).all(pattern, limit, offset) as Wildcard[];

    return { wildcards, total };
  }

  /**
   * 특정 부모의 자식 수 조회
   */
  static countChildren(parentId: number | null): number {
    const db = getUserSettingsDb();
    if (parentId === null) {
      return (db.prepare(
        'SELECT COUNT(*) as count FROM wildcards WHERE parent_id IS NULL'
      ).get() as { count: number }).count;
    }
    return (db.prepare(
      'SELECT COUNT(*) as count FROM wildcards WHERE parent_id = ?'
    ).get(parentId) as { count: number }).count;
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
    return getUserSettingsDb().transaction(() =>
      buildPromptTree(this.withItems(readPromptTreeRows<Wildcard>('wildcards', parentId)), parentId))();
  }

  /** Browsing projection: aggregate counts in SQL without reading any item content. */
  static findHierarchySummary(): WildcardSummary[] {
    const db = getUserSettingsDb();
    const rows = db.prepare(`
      SELECT w.*, COALESCE(c.general_count, 0) AS general_count,
        COALESCE(c.nai_count, 0) AS nai_count, COALESCE(c.comfyui_count, 0) AS comfyui_count
      FROM wildcards w
      LEFT JOIN (
        SELECT wildcard_id, SUM(tool = 'general') AS general_count,
          SUM(tool = 'nai') AS nai_count, SUM(tool = 'comfyui') AS comfyui_count
        FROM wildcard_items GROUP BY wildcard_id
      ) c ON c.wildcard_id = w.id
      ORDER BY w.name
    `).all() as Array<Wildcard & { general_count: number; nai_count: number; comfyui_count: number }>;
    const nodes = rows.map(({ general_count, nai_count, comfyui_count, ...wildcard }): WildcardSummary => ({
      ...wildcard, item_counts: { general: general_count, nai: nai_count, comfyui: comfyui_count },
    }));
    return buildPromptTree(nodes);
  }

  /**
   * 특정 와일드카드의 전체 경로 조회 (루트부터 현재까지)
   * CTE 재귀 쿼리로 O(1) 성능 - N+1 문제 해결
   */
  static getFullPath(wildcardId: number): Wildcard[] {
    const db = getUserSettingsDb();

    const query = `
      WITH RECURSIVE ancestor_path AS (
        -- Base case: 시작 노드 (현재 와일드카드)
        SELECT
          id, name, description, parent_id, include_children,
          only_children, type, chain_option, created_date, updated_date,
          0 as depth
        FROM wildcards
        WHERE id = ?

        UNION ALL

        -- Recursive case: 부모 노드들
        SELECT
          w.id, w.name, w.description, w.parent_id, w.include_children,
          w.only_children, w.type, w.chain_option, w.created_date, w.updated_date,
          ap.depth + 1
        FROM wildcards w
        INNER JOIN ancestor_path ap ON w.id = ap.parent_id
      )
      SELECT
        id, name, description, parent_id, include_children,
        only_children, type, chain_option, created_date, updated_date
      FROM ancestor_path
      ORDER BY depth DESC
    `;

    return db.prepare(query).all(wildcardId) as Wildcard[];
  }

  /**
   * 모든 자식 와일드카드 재귀 조회 (자기 자신 미포함)
   * CTE 재귀 쿼리로 O(1) 성능 - N+1 문제 해결
   */
  static getAllDescendants(wildcardId: number): Wildcard[] {
    const db = getUserSettingsDb();

    const query = `
      WITH RECURSIVE descendants AS (
        -- Base case: 시작 노드 (현재 와일드카드)
        SELECT
          id, name, description, parent_id, include_children,
          only_children, type, chain_option, created_date, updated_date,
          0 as depth
        FROM wildcards
        WHERE id = ?

        UNION ALL

        -- Recursive case: 자식 노드들
        SELECT
          w.id, w.name, w.description, w.parent_id, w.include_children,
          w.only_children, w.type, w.chain_option, w.created_date, w.updated_date,
          d.depth + 1
        FROM wildcards w
        INNER JOIN descendants d ON w.parent_id = d.id
      )
      SELECT
        id, name, description, parent_id, include_children,
        only_children, type, chain_option, created_date, updated_date
      FROM descendants
      WHERE id != ?
      ORDER BY depth ASC
    `;

    return db.prepare(query).all(wildcardId, wildcardId) as Wildcard[];
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
  static findByWildcardIds(wildcardIds: number[]): WildcardItem[] {
    if (wildcardIds.length === 0) return [];
    const db = getUserSettingsDb();
    return db.prepare(`
      SELECT * FROM wildcard_items
      WHERE wildcard_id IN (SELECT value FROM json_each(?))
      ORDER BY wildcard_id, order_index, id
    `).all(JSON.stringify(wildcardIds)) as WildcardItem[];
  }

  /**
   * 와일드카드 ID로 항목 조회
   */
  static findByWildcardId(wildcardId: number): WildcardItem[] {
    const db = getUserSettingsDb();
    return db.prepare(`
      SELECT * FROM wildcard_items
      WHERE wildcard_id = ?
      ORDER BY order_index, id
    `).all(wildcardId) as WildcardItem[];
  }

  /**
   * 특정 도구의 항목만 조회
   */
  static findByWildcardIdAndTool(wildcardId: number, tool: WildcardTool): WildcardItem[] {
    const db = getUserSettingsDb();
    return db.prepare(`
      SELECT * FROM wildcard_items
      WHERE wildcard_id = ? AND tool = ?
      ORDER BY order_index
    `).all(wildcardId, tool) as WildcardItem[];
  }

}
