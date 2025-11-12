import { Database } from 'better-sqlite3';
import { getDb } from '../database';

/**
 * 그룹 계층 구조 관리 서비스
 * - 순환 참조 방지
 * - 최대 깊이 제한 (5단계)
 * - 재귀 쿼리로 조상/자손 조회
 */

const MAX_DEPTH = 5;

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

  constructor() {
    this.db = getDb();
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
    const query = `
      WITH RECURSIVE descendants AS (
        SELECT id, parent_id, name, 0 as depth
        FROM groups
        WHERE id = ?
        UNION ALL
        SELECT g.id, g.parent_id, g.name, d.depth + 1
        FROM groups g
        INNER JOIN descendants d ON g.parent_id = d.id
      )
      SELECT * FROM descendants
      WHERE id != ?
      ORDER BY depth ASC
    `;

    return this.db.prepare(query).all(groupId, groupId) as AncestorNode[];
  }

  /**
   * 직속 자식 그룹 ID 목록 조회
   * @param parentId 부모 그룹 ID
   * @returns 자식 그룹 ID 배열
   */
  getChildrenIds(parentId: number | null): number[] {
    const query = parentId === null
      ? `SELECT id FROM groups WHERE parent_id IS NULL`
      : `SELECT id FROM groups WHERE parent_id = ?`;

    const params = parentId === null ? [] : [parentId];
    const rows = this.db.prepare(query).all(...params) as Array<{ id: number }>;
    return rows.map(row => row.id);
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

    // 순환 참조 검증: newParentId가 groupId의 자손인지 확인
    const descendants = this.getDescendants(groupId);
    const isDescendant = descendants.some(d => d.id === newParentId);

    if (isDescendant) {
      return {
        valid: false,
        error: 'Circular reference detected: Cannot set descendant as parent'
      };
    }

    // 깊이 제한 검증
    const parentDepth = this.calculateDepth(newParentId);
    const descendants_of_group = this.getDescendants(groupId);
    const maxDescendantDepth = descendants_of_group.length > 0
      ? Math.max(...descendants_of_group.map(d => d.depth))
      : 0;

    // 새 위치에서의 최대 깊이 = 부모 깊이 + 1 + 현재 그룹의 최대 자손 깊이
    const newMaxDepth = parentDepth + 1 + maxDescendantDepth;

    if (newMaxDepth >= MAX_DEPTH) {
      return {
        valid: false,
        error: `Maximum depth (${MAX_DEPTH}) exceeded`,
        current_depth: newMaxDepth,
        max_depth: MAX_DEPTH
      };
    }

    return { valid: true };
  }

  /**
   * 그룹의 자식 개수 조회
   * @param groupId 그룹 ID
   * @returns 직속 자식 개수
   */
  getChildCount(groupId: number): number {
    const query = `SELECT COUNT(*) as count FROM groups WHERE parent_id = ?`;
    const result = this.db.prepare(query).get(groupId) as { count: number };
    return result.count;
  }

  /**
   * 여러 그룹의 자식 개수 조회 (배치)
   * @param groupIds 그룹 ID 배열
   * @returns Map<groupId, childCount>
   */
  getChildCountBatch(groupIds: number[]): Map<number, number> {
    if (groupIds.length === 0) return new Map();

    const placeholders = groupIds.map(() => '?').join(',');
    const query = `
      SELECT parent_id, COUNT(*) as count
      FROM groups
      WHERE parent_id IN (${placeholders})
      GROUP BY parent_id
    `;

    const results = this.db.prepare(query).all(...groupIds) as Array<{ parent_id: number; count: number }>;

    const map = new Map<number, number>();
    results.forEach(row => {
      map.set(row.parent_id, row.count);
    });

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
