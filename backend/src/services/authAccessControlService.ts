import type Database from 'better-sqlite3';
import { getAuthDb } from '../database/authDb';

export interface ResolvedAuthAccessRecord {
  groupKeys: string[];
  permissionKeys: string[];
}

const RESOLVED_ACCESS_CACHE_TTL_MS = 60_000;

// Group/permission tables change rarely but are read on every request, so
// resolutions are memoized with a short TTL plus explicit invalidation.
const resolvedAccessCache = new Map<string, { record: ResolvedAuthAccessRecord; expiresAt: number }>();

// Session-cached access data lives in the session store, so it cannot be cleared from here.
// Every invalidation bumps this epoch instead, and sessions stamped with an older epoch
// re-resolve on their next request so revocations apply immediately.
let resolvedAccessEpoch = 0;

// Prepared statements are hoisted here and created lazily because the auth DB
// only opens during startup, after this module is imported.
const preparedStatements = new Map<string, Database.Statement>();
let preparedStatementsDb: Database.Database | null = null;

function prepared(sql: string): Database.Statement {
  const db = getAuthDb();
  if (db !== preparedStatementsDb) {
    preparedStatements.clear();
    preparedStatementsDb = db;
  }

  let statement = preparedStatements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    preparedStatements.set(sql, statement);
  }

  return statement;
}

function getCachedResolvedAccess(cacheKey: string, resolve: () => ResolvedAuthAccessRecord): ResolvedAuthAccessRecord {
  const cached = resolvedAccessCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.record;
  }

  const record = resolve();
  resolvedAccessCache.set(cacheKey, { record, expiresAt: Date.now() + RESOLVED_ACCESS_CACHE_TTL_MS });
  return record;
}

/** Read the current access epoch so session-cached access data can detect invalidations. */
export function getResolvedAuthAccessEpoch(): number {
  return resolvedAccessEpoch;
}

/** Drop memoized access resolutions after permission/group mutations. */
export function invalidateResolvedAuthAccessCache(): void {
  resolvedAccessCache.clear();
  resolvedAccessEpoch += 1;
}

/** Resolve inherited groups and effective permissions for one account. */
export class AuthAccessControlService {
  /** Resolve effective access for one built-in group key. */
  static resolveForGroupKey(groupKey: string | null | undefined): ResolvedAuthAccessRecord {
    if (!groupKey) {
      return { groupKeys: [], permissionKeys: [] };
    }

    return getCachedResolvedAccess(`group:${groupKey}`, () => {
      const groupRow = prepared(`
        SELECT id, group_key, parent_group_id
        FROM auth_permission_groups
        WHERE group_key = ?
      `).get(groupKey) as { id: number; group_key: string; parent_group_id: number | null } | undefined;

      if (!groupRow) {
        return { groupKeys: [], permissionKeys: [] };
      }

      return this.resolveFromMembershipRows([groupRow]);
    });
  }

  /** Resolve full bootstrap access when no local auth is configured yet. */
  static resolveBootstrapAccess(): ResolvedAuthAccessRecord {
    return getCachedResolvedAccess('bootstrap', () => {
      const permissionKeys = (prepared(`
        SELECT permission_key
        FROM auth_permissions
        ORDER BY permission_key ASC
      `).all() as Array<{ permission_key: string }>).map((row) => row.permission_key);

      return {
        groupKeys: ['bootstrap'],
        permissionKeys,
      };
    });
  }

  /** Resolve effective access for one account id. */
  static resolveForAccountId(accountId: number | null | undefined): ResolvedAuthAccessRecord {
    if (typeof accountId !== 'number') {
      return { groupKeys: [], permissionKeys: [] };
    }

    const membershipRows = prepared(`
      SELECT g.id, g.group_key, g.parent_group_id
      FROM auth_account_group_memberships agm
      INNER JOIN auth_permission_groups g ON g.id = agm.group_id
      WHERE agm.account_id = ?
      ORDER BY g.priority ASC, g.id ASC
    `).all(accountId) as Array<{ id: number; group_key: string; parent_group_id: number | null }>;

    return this.resolveFromMembershipRows(membershipRows);
  }

  /** Check whether one account currently has one permission key. */
  static hasPermission(accountId: number | null | undefined, permissionKey: string): boolean {
    if (!permissionKey) {
      return false;
    }

    const resolved = this.resolveForAccountId(accountId);
    return resolved.permissionKeys.includes(permissionKey);
  }

  /** Resolve access from one or more direct membership rows. */
  private static resolveFromMembershipRows(
    membershipRows: Array<{ id: number; group_key: string; parent_group_id: number | null }>,
  ): ResolvedAuthAccessRecord {
    const inheritedGroups = this.expandInheritedGroups(membershipRows);
    const groupIds = inheritedGroups.map((group) => group.id);
    const permissionKeys = groupIds.length === 0
      ? []
      : (prepared(`
          SELECT DISTINCT p.permission_key
          FROM auth_group_permissions gp
          INNER JOIN auth_permissions p ON p.id = gp.permission_id
          WHERE gp.group_id IN (${groupIds.map(() => '?').join(', ')}) AND gp.allowed = 1
          ORDER BY p.permission_key ASC
        `).all(...groupIds) as Array<{ permission_key: string }>).map((row) => row.permission_key);

    return {
      groupKeys: inheritedGroups.map((group) => group.group_key),
      permissionKeys,
    };
  }

  /** Expand direct memberships through parent inheritance. */
  private static expandInheritedGroups(
    membershipRows: Array<{ id: number; group_key: string; parent_group_id: number | null }>,
  ): Array<{ id: number; group_key: string; parent_group_id: number | null }> {
    const seenGroupIds = new Set<number>();
    const resolved: Array<{ id: number; group_key: string; parent_group_id: number | null }> = [];
    const selectGroupById = prepared('SELECT id, group_key, parent_group_id FROM auth_permission_groups WHERE id = ?');

    const visitGroup = (group: { id: number; group_key: string; parent_group_id: number | null }) => {
      if (seenGroupIds.has(group.id)) {
        return;
      }

      seenGroupIds.add(group.id);

      if (group.parent_group_id !== null) {
        const parentGroup = selectGroupById.get(group.parent_group_id) as { id: number; group_key: string; parent_group_id: number | null } | undefined;
        if (parentGroup) {
          visitGroup(parentGroup);
        }
      }

      resolved.push(group);
    };

    membershipRows.forEach(visitGroup);
    return resolved;
  }
}
