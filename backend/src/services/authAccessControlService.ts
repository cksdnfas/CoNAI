import { getAuthDb } from '../database/authDb';

export interface ResolvedAuthAccessRecord {
  groupKeys: string[];
  permissionKeys: string[];
}

/** Resolve inherited groups and effective permissions for one account. */
export class AuthAccessControlService {
  /** Resolve effective access for one built-in group key. */
  static resolveForGroupKey(groupKey: string | null | undefined): ResolvedAuthAccessRecord {
    if (!groupKey) {
      return { groupKeys: [], permissionKeys: [] };
    }

    const db = getAuthDb();
    const groupRow = db.prepare(`
      SELECT id, group_key, parent_group_id
      FROM auth_permission_groups
      WHERE group_key = ?
    `).get(groupKey) as { id: number; group_key: string; parent_group_id: number | null } | undefined;

    if (!groupRow) {
      return { groupKeys: [], permissionKeys: [] };
    }

    return this.resolveFromMembershipRows([groupRow]);
  }

  /** Resolve full bootstrap access when no local auth is configured yet. */
  static resolveBootstrapAccess(): ResolvedAuthAccessRecord {
    const db = getAuthDb();
    const permissionKeys = (db.prepare(`
      SELECT permission_key
      FROM auth_permissions
      ORDER BY permission_key ASC
    `).all() as Array<{ permission_key: string }>).map((row) => row.permission_key);

    return {
      groupKeys: ['bootstrap'],
      permissionKeys,
    };
  }

  /** Resolve effective access for one account id. */
  static resolveForAccountId(accountId: number | null | undefined): ResolvedAuthAccessRecord {
    if (typeof accountId !== 'number') {
      return { groupKeys: [], permissionKeys: [] };
    }

    const db = getAuthDb();
    const membershipRows = db.prepare(`
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
    const db = getAuthDb();
    const inheritedGroups = this.expandInheritedGroups(membershipRows);
    const groupIds = inheritedGroups.map((group) => group.id);
    const permissionKeys = groupIds.length === 0
      ? []
      : (db.prepare(`
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
    const db = getAuthDb();
    const seenGroupIds = new Set<number>();
    const resolved: Array<{ id: number; group_key: string; parent_group_id: number | null }> = [];
    const selectGroupById = db.prepare('SELECT id, group_key, parent_group_id FROM auth_permission_groups WHERE id = ?');

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
