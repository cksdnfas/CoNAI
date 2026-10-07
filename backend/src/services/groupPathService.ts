import type Database from 'better-sqlite3'
import { db } from '../database/init';
import { getGroupHierarchyService } from './groupHierarchyService';

/**
 * `프로젝트/이펙트` 같은 슬래시 경로를 그룹 계층으로 해석한다.
 *
 * - 형제 이름 비교는 migration 036 의 고유 인덱스와 같은 규칙(대소문자 무시, 앞뒤 공백 무시)을 쓴다.
 * - 루트부터 한 단계씩 내려가며 찾고, `create` 이면 없는 단계만 만든다.
 * - 동시 생성은 `INSERT ... ON CONFLICT DO NOTHING` 후 재조회로 흡수한다(다른 프로세스 포함).
 */

export const GROUP_PATH_MAX_DEPTH = 5;
export const GROUP_NAME_MAX_LENGTH = 255;

export class GroupPathError extends Error {
  constructor(message: string, readonly code: 'invalid_path' | 'too_deep' | 'not_found') {
    super(message);
    this.name = 'GroupPathError';
  }
}

export interface ResolvedGroupPath {
  groupId: number;
  /** DB 에 저장된 실제 이름으로 다시 조립한 경로 */
  path: string;
  segments: Array<{ id: number; name: string }>;
  createdGroupIds: number[];
}

/** 경로 문자열을 정규화된 세그먼트 배열로 나눈다. 잘못된 입력이면 GroupPathError. */
export function parseGroupPath(input: unknown): string[] {
  if (typeof input !== 'string') {
    throw new GroupPathError('Group path must be a string', 'invalid_path');
  }

  const segments = input
    .split(/[/\\]/)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new GroupPathError('Group path is empty', 'invalid_path');
  }

  if (segments.length > GROUP_PATH_MAX_DEPTH) {
    throw new GroupPathError(`Group path exceeds maximum depth (${GROUP_PATH_MAX_DEPTH})`, 'too_deep');
  }

  for (const segment of segments) {
    if (segment.length > GROUP_NAME_MAX_LENGTH) {
      throw new GroupPathError(`Group name is too long: ${segment.slice(0, 32)}…`, 'invalid_path');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(segment)) {
      throw new GroupPathError('Group name contains control characters', 'invalid_path');
    }
  }

  return segments;
}

type GroupRow = { id: number; name: string };

function findChild(database: Database.Database, parentId: number | null, name: string): GroupRow | null {
  const row = database.prepare(`
    SELECT id, name FROM groups
    WHERE COALESCE(parent_id, 0) = ?
      AND TRIM(name) = ? COLLATE NOCASE
    ORDER BY (name = ?) DESC, id ASC
    LIMIT 1
  `).get(parentId ?? 0, name, name) as GroupRow | undefined;
  return row ?? null;
}

function insertChild(database: Database.Database, parentId: number | null, name: string): boolean {
  const info = database.prepare(`
    INSERT INTO groups (name, parent_id) VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `).run(name, parentId);
  return info.changes > 0;
}

function resolveTransaction(database: Database.Database, segments: string[], create: boolean): ResolvedGroupPath | null {
  return database.transaction((): ResolvedGroupPath | null => {
    const resolved: GroupRow[] = [];
    const createdGroupIds: number[] = [];
    let parentId: number | null = null;

    for (const segment of segments) {
      let row = findChild(database, parentId, segment);
      if (!row) {
        if (!create) {
          return null;
        }
        insertChild(database, parentId, segment);
        row = findChild(database, parentId, segment);
        if (!row) {
          throw new Error(`Failed to create group "${segment}"`);
        }
        createdGroupIds.push(row.id);
      }
      resolved.push(row);
      parentId = row.id;
    }

    const leaf = resolved[resolved.length - 1];
    return {
      groupId: leaf.id,
      path: resolved.map((row) => row.name).join('/'),
      segments: resolved.map((row) => ({ id: row.id, name: row.name })),
      createdGroupIds,
    };
  }).immediate();
}

export class GroupPathService {
  /**
   * 경로를 그룹으로 해석한다. `create: false` 이고 경로가 없으면 null.
   * 세그먼트 수가 곧 깊이이므로 GROUP_PATH_MAX_DEPTH 로 깊이 제한이 보장된다.
   */
  static resolve(path: unknown, options: { create: boolean }, database: Database.Database = db): ResolvedGroupPath | null {
    const segments = parseGroupPath(path);
    const result = resolveTransaction(database, segments, options.create);
    if (result && result.createdGroupIds.length > 0) {
      console.log(`📁 Created group path "${result.path}" (${result.createdGroupIds.length} new)`);
    }
    return result;
  }

  /** 없으면 만들어서라도 그룹 id 를 돌려준다. */
  static resolveOrCreate(path: unknown, database: Database.Database = db): ResolvedGroupPath {
    const result = this.resolve(path, { create: true }, database);
    if (!result) {
      throw new GroupPathError('Failed to resolve group path', 'not_found');
    }
    return result;
  }

  /** 그룹 id 의 전체 경로 문자열(루트/…/그룹). 그룹이 없으면 null. */
  static getPathLabel(groupId: number): string | null {
    const ancestors = getGroupHierarchyService().getAncestorPath(groupId);
    if (ancestors.length === 0) {
      return null;
    }
    return ancestors.map((node) => node.name).join('/');
  }

  /** 같은 부모 아래에서 비어 있는 이름을 찾는다. 충돌이 없으면 입력 그대로. */
  static findAvailableSiblingName(parentId: number | null, baseName: string, excludeGroupId?: number): string {
    const taken = db.prepare(`
      SELECT 1 FROM groups
      WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND id != ?
      LIMIT 1
    `);
    const exclude = excludeGroupId ?? 0;
    if (!taken.get(parentId ?? 0, baseName, exclude)) {
      return baseName;
    }
    let suffix = 2;
    while (taken.get(parentId ?? 0, `${baseName} (${suffix})`, exclude)) {
      suffix += 1;
    }
    return `${baseName} (${suffix})`;
  }
}

export const GROUP_NAME_CONFLICT_MESSAGE = 'A group with the same name already exists in this location';

/** 형제 이름 고유 인덱스(또는 레거시 전역 UNIQUE) 위반인지 판별한다. */
export function isGroupNameConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('UNIQUE') && (message.includes('groups.name') || message.includes('idx_groups_parent_name_nocase'));
}
