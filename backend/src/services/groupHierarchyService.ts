import { Database } from 'better-sqlite3';
import { db } from '../database/init';
import { chunkSqliteValues, sqliteInPlaceholders } from '../utils/sqliteBatch';

/**
 * 그룹 계층 구조 관리 서비스
 * - 순환 참조 방지
 * - 최대 깊이 제한 (5단계)
 * - 재귀 쿼리로 조상/자손 조회
 */

export const GROUP_MAX_DEPTH = 5;

const SUBTREE = `WITH RECURSIVE subtree(id, depth) AS (
  SELECT id, 0 FROM groups WHERE id = ?
  UNION ALL SELECT g.id, s.depth + 1 FROM groups g JOIN subtree s ON g.parent_id = s.id
)`;

export interface AncestorNode {
  id: number;
  parent_id: number | null;
  name: string;
  depth: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  current_depth?: number;
  max_depth?: number;
}

export class GroupHierarchyService {
  private db: Database;

  constructor(database: Database = db) {
    this.db = database;
  }

  /**
   * 조상 경로 조회 (현재 그룹에서 루트까지)
   * @param groupId 그룹 ID
   * @returns 조상 노드 배열 (루트부터 현재까지)
   */
  getAncestorPath(groupId: number): AncestorNode[] {
    const query = `
      WITH RECURSIVE ancestor_path AS (
        SELECT id, parent_id, name, 0 as depth
        FROM groups
        WHERE id = ?
        UNION ALL
        SELECT g.id, g.parent_id, g.name, ap.depth + 1
        FROM groups g
        INNER JOIN ancestor_path ap ON g.id = ap.parent_id
      )
      SELECT * FROM ancestor_path
      ORDER BY depth DESC
    `;

    return this.db.prepare(query).all(groupId) as AncestorNode[];
  }

  /**
   * 모든 자손 그룹 조회 (재귀)
   * @param groupId 그룹 ID
   * @returns 자손 노드 배열
   */
  getDescendants(groupId: number): AncestorNode[] {
    return this.db.prepare(`${SUBTREE} SELECT g.id, g.parent_id, g.name, s.depth
      FROM subtree s JOIN groups g ON g.id = s.id WHERE s.depth > 0 ORDER BY s.depth`).all(groupId) as AncestorNode[];
  }

  /**
   * 현재 깊이 계산
   * @param groupId 그룹 ID
   * @returns 깊이 (루트 = 0)
   */
  calculateDepth(groupId: number): number {
    const ancestors = this.getAncestorPath(groupId);
    // depth는 조상의 개수 - 1 (자기 자신 제외)
    return ancestors.length - 1;
  }

  /**
   * 계층 구조 검증
   * @param groupId 이동할 그룹 ID
   * @param newParentId 새 부모 그룹 ID (null이면 루트로 이동)
   * @returns 검증 결과
   */
  validateHierarchy(groupId: number, newParentId: number | null): ValidationResult {
    // null이면 루트로 이동 - 항상 허용
    if (newParentId === null) {
      return { valid: true };
    }

    // 자기 자신을 부모로 설정 불가
    if (groupId === newParentId) {
      return {
        valid: false,
        error: 'Cannot set self as parent'
      };
    }

    const parentPath = this.getAncestorPath(newParentId);
    if (!parentPath.length) return { valid: false, error: 'Target parent group not found' };
    if (parentPath.some(node => node.id === groupId)) {
      return {
        valid: false,
        error: 'Circular reference detected: Cannot set descendant as parent'
      };
    }

    // 깊이 제한 검증
    const parentDepth = parentPath.length - 1;
    const maxDescendantDepth = this.db.prepare(`${SUBTREE} SELECT COALESCE(MAX(depth), 0) FROM subtree`).pluck().get(groupId) as number;

    // 새 위치에서의 최대 깊이 = 부모 깊이 + 1 + 현재 그룹의 최대 자손 깊이
    const newMaxDepth = parentDepth + 1 + maxDescendantDepth;

    if (newMaxDepth >= GROUP_MAX_DEPTH) {
      return {
        valid: false,
        error: `Maximum depth (${GROUP_MAX_DEPTH}) exceeded`,
        current_depth: newMaxDepth,
        max_depth: GROUP_MAX_DEPTH
      };
    }

    return { valid: true };
  }

  /**
   * 여러 그룹의 자식 개수 조회 (배치)
   * @param groupIds 그룹 ID 배열
   * @returns Map<groupId, childCount>
   */
  getChildCountBatch(groupIds: number[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const page of chunkSqliteValues(groupIds)) {
      const rows = this.db.prepare(`SELECT parent_id, COUNT(*) AS count FROM groups
        WHERE parent_id IN (${sqliteInPlaceholders(page)}) GROUP BY parent_id`).all(...page) as Array<{ parent_id: number; count: number }>;
      for (const row of rows) map.set(row.parent_id, row.count);
    }
    return map;
  }
}

// 싱글톤 인스턴스
let instance: GroupHierarchyService | null = null;

export function getGroupHierarchyService(): GroupHierarchyService {
  if (!instance) {
    instance = new GroupHierarchyService();
  }
  return instance;
}
