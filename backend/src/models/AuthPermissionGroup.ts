import crypto from 'crypto';
import { getAuthDb } from '../database/authDb';

export type BuiltInPermissionGroupKey = 'anonymous' | 'guest' | 'admin';

export interface PagePermissionRecord {
  permission_key: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface PermissionGroupPageAccessRecord {
  group_key: BuiltInPermissionGroupKey;
  name: string;
  description: string | null;
  permission_keys: string[];
}

export interface PermissionGroupSummaryRecord {
  id: number;
  group_key: string;
  name: string;
  description: string | null;
  parent_group_id: number | null;
  parent_group_key: string | null;
  priority: number;
  system_group: boolean;
  direct_permission_keys: string[];
  member_count: number;
}

export interface PermissionGroupMemberRecord {
  id: number;
  username: string;
  account_type: 'admin' | 'guest';
  status: 'active' | 'disabled';
}

/** Resolve and update built-in permission-group access records. */
export class AuthPermissionGroup {
  /** List the current page-view permission catalog in stable order. */
  static listPagePermissions(): PagePermissionRecord[] {
    const db = getAuthDb();
    return db.prepare(`
      SELECT permission_key, resource, action, description
      FROM auth_permissions
      WHERE permission_key LIKE 'page.%'
      ORDER BY id ASC
    `).all() as PagePermissionRecord[];
  }

  /** List all permission groups for one group-centered management UI. */
  static listAllGroups(): PermissionGroupSummaryRecord[] {
    const db = getAuthDb();
    const rows = db.prepare(`
      SELECT
        g.id,
        g.group_key,
        g.name,
        g.description,
        g.parent_group_id,
        parent.group_key as parent_group_key,
        g.priority,
        g.system_group,
        GROUP_CONCAT(DISTINCT p.permission_key) as permission_keys_csv,
        COUNT(DISTINCT agm.account_id) as member_count
      FROM auth_permission_groups g
      LEFT JOIN auth_permission_groups parent ON parent.id = g.parent_group_id
      LEFT JOIN auth_group_permissions gp ON gp.group_id = g.id AND gp.allowed = 1
      LEFT JOIN auth_permissions p ON p.id = gp.permission_id AND p.permission_key LIKE 'page.%'
      LEFT JOIN auth_account_group_memberships agm ON agm.group_id = g.id
      GROUP BY g.id
      ORDER BY g.priority ASC, g.id ASC
    `).all() as Array<{
      id: number;
      group_key: string;
      name: string;
      description: string | null;
      parent_group_id: number | null;
      parent_group_key: string | null;
      priority: number;
      system_group: number;
      permission_keys_csv: string | null;
      member_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      group_key: row.group_key,
      name: row.name,
      description: row.description,
      parent_group_id: row.parent_group_id,
      parent_group_key: row.parent_group_key,
      priority: row.priority,
      system_group: row.system_group === 1,
      direct_permission_keys: row.permission_keys_csv ? row.permission_keys_csv.split(',').filter(Boolean) : [],
      member_count: row.member_count,
    }));
  }

  /** Find one permission group summary by id. */
  static findGroupById(groupId: number): PermissionGroupSummaryRecord | null {
    return this.listAllGroups().find((group) => group.id === groupId) ?? null;
  }

  /** List one or more built-in groups with their assigned page-view permissions. */
  static listBuiltInPageAccess(groupKeys: BuiltInPermissionGroupKey[]): PermissionGroupPageAccessRecord[] {
    const db = getAuthDb();
    const placeholders = groupKeys.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT
        g.group_key,
        g.name,
        g.description,
        GROUP_CONCAT(p.permission_key) as permission_keys_csv
      FROM auth_permission_groups g
      LEFT JOIN auth_group_permissions gp ON gp.group_id = g.id AND gp.allowed = 1
      LEFT JOIN auth_permissions p ON p.id = gp.permission_id AND p.permission_key LIKE 'page.%'
      WHERE g.group_key IN (${placeholders})
      GROUP BY g.id
      ORDER BY g.priority ASC, g.id ASC
    `).all(...groupKeys) as Array<{
      group_key: BuiltInPermissionGroupKey;
      name: string;
      description: string | null;
      permission_keys_csv: string | null;
    }>;

    return rows.map((row) => ({
      group_key: row.group_key,
      name: row.name,
      description: row.description,
      permission_keys: row.permission_keys_csv ? row.permission_keys_csv.split(',').filter(Boolean) : [],
    }));
  }

  /** Create one custom permission group with direct page permissions. */
  static createCustomGroup(input: { name: string; description?: string | null; permissionKeys?: string[] }): PermissionGroupSummaryRecord {
    const db = getAuthDb();
    const normalizedName = input.name.trim();
    const description = input.description?.trim() || null;
    const normalizedPermissionKeys = this.normalizePagePermissionKeys(input.permissionKeys ?? []);

    if (!normalizedName) {
      throw new Error('Group name is required');
    }

    const createTransaction = db.transaction(() => {
      const insertResult = db.prepare(`
        INSERT INTO auth_permission_groups (
          group_key, name, description, parent_group_id, priority, system_group, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 1000, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(this.buildCustomGroupKey(normalizedName), normalizedName, description);

      const groupId = insertResult.lastInsertRowid as number;
      this.syncDirectPagePermissions(groupId, normalizedPermissionKeys);
      return groupId;
    });

    const groupId = createTransaction();
    const group = this.findGroupById(groupId);
    if (!group) {
      throw new Error('Failed to load created permission group');
    }

    return group;
  }

  /** Update one custom permission group and replace its direct page permissions. */
  static updateCustomGroup(groupId: number, input: { name: string; description?: string | null; permissionKeys?: string[] }): PermissionGroupSummaryRecord {
    const db = getAuthDb();
    const group = this.requireGroupById(groupId);
    this.assertCustomGroupEditable(group);

    const normalizedName = input.name.trim();
    const description = input.description?.trim() || null;
    const normalizedPermissionKeys = this.normalizePagePermissionKeys(input.permissionKeys ?? []);

    if (!normalizedName) {
      throw new Error('Group name is required');
    }

    const updateTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE auth_permission_groups
        SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(normalizedName, description, groupId);

      this.syncDirectPagePermissions(groupId, normalizedPermissionKeys);
    });

    updateTransaction();

    const updatedGroup = this.findGroupById(groupId);
    if (!updatedGroup) {
      throw new Error('Failed to refresh permission group');
    }

    return updatedGroup;
  }

  /** Delete one custom permission group. */
  static deleteCustomGroup(groupId: number): void {
    const db = getAuthDb();
    const group = this.requireGroupById(groupId);
    this.assertCustomGroupEditable(group);
    db.prepare('DELETE FROM auth_permission_groups WHERE id = ?').run(groupId);
  }

  /** List the current account members of one permission group. */
  static listGroupMembers(groupId: number): PermissionGroupMemberRecord[] {
    const db = getAuthDb();
    this.requireGroupById(groupId);
    return db.prepare(`
      SELECT a.id, a.username, a.account_type, a.status
      FROM auth_account_group_memberships agm
      INNER JOIN auth_accounts a ON a.id = agm.account_id
      WHERE agm.group_id = ?
      ORDER BY CASE a.account_type WHEN 'admin' THEN 0 ELSE 1 END, a.username COLLATE NOCASE ASC, a.id ASC
    `).all(groupId) as PermissionGroupMemberRecord[];
  }

  /** Add one account membership to one custom permission group. */
  static addAccountMembership(groupId: number, accountId: number): void {
    const db = getAuthDb();
    const group = this.requireGroupById(groupId);
    this.assertCustomGroupEditable(group);
    this.requireAccountById(accountId);

    db.prepare(`
      INSERT OR IGNORE INTO auth_account_group_memberships (account_id, group_id, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(accountId, groupId);
  }

  /** Remove one account membership from one custom permission group. */
  static removeAccountMembership(groupId: number, accountId: number): void {
    const db = getAuthDb();
    const group = this.requireGroupById(groupId);
    this.assertCustomGroupEditable(group);
    this.requireAccountById(accountId);

    db.prepare(`
      DELETE FROM auth_account_group_memberships
      WHERE account_id = ? AND group_id = ?
    `).run(accountId, groupId);
  }

  /** Replace the directly assigned page-view permissions for one built-in group. */
  static replaceBuiltInPageAccess(groupKey: 'anonymous' | 'guest', permissionKeys: string[]): PermissionGroupPageAccessRecord {
    const db = getAuthDb();
    const normalizedPermissionKeys = this.normalizePagePermissionKeys(permissionKeys, groupKey);

    const groupRow = db.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?').get(groupKey) as { id: number } | undefined;
    if (!groupRow) {
      throw new Error('Permission group not found');
    }

    this.syncDirectPagePermissions(groupRow.id, normalizedPermissionKeys);

    const updatedGroup = this.listBuiltInPageAccess([groupKey])[0];
    if (!updatedGroup) {
      throw new Error('Failed to refresh permission group');
    }

    return updatedGroup;
  }

  /** Normalize and validate one direct page-permission list. */
  private static normalizePagePermissionKeys(permissionKeys: string[], groupKey?: string): string[] {
    const normalizedPermissionKeys = Array.from(new Set(permissionKeys.map((value) => value.trim()).filter(Boolean)));

    if (groupKey === 'anonymous') {
      const allowedAnonymousPermissionKeys = new Set(['page.wallpaper.runtime.view']);
      if (normalizedPermissionKeys.some((permissionKey) => !allowedAnonymousPermissionKeys.has(permissionKey))) {
        throw new Error('Anonymous access can only include the wallpaper runtime page');
      }
    }

    const allowedPermissionRows = this.listPagePermissions();
    const allowedPermissionKeySet = new Set(allowedPermissionRows.map((permission) => permission.permission_key));
    if (normalizedPermissionKeys.some((permissionKey) => !allowedPermissionKeySet.has(permissionKey))) {
      throw new Error('One or more permission keys are invalid');
    }

    return normalizedPermissionKeys;
  }

  /** Replace the direct page-permission rows for one group. */
  private static syncDirectPagePermissions(groupId: number, permissionKeys: string[]): void {
    const db = getAuthDb();
    const pagePermissionIds = db.prepare(`
      SELECT id, permission_key
      FROM auth_permissions
      WHERE permission_key LIKE 'page.%'
    `).all() as Array<{ id: number; permission_key: string }>;
    const selectedPermissionIds = pagePermissionIds
      .filter((permission) => permissionKeys.includes(permission.permission_key))
      .map((permission) => permission.id);

    if (pagePermissionIds.length > 0) {
      const placeholders = pagePermissionIds.map(() => '?').join(', ');
      db.prepare(`
        DELETE FROM auth_group_permissions
        WHERE group_id = ? AND permission_id IN (${placeholders})
      `).run(groupId, ...pagePermissionIds.map((permission) => permission.id));
    }

    if (selectedPermissionIds.length > 0) {
      const insertPermission = db.prepare(`
        INSERT INTO auth_group_permissions (
          group_id, permission_id, allowed, created_at, updated_at
        ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, permission_id) DO UPDATE SET
          allowed = 1,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const permissionId of selectedPermissionIds) {
        insertPermission.run(groupId, permissionId);
      }
    }
  }

  /** Require one permission group summary by id. */
  private static requireGroupById(groupId: number): PermissionGroupSummaryRecord {
    const group = this.findGroupById(groupId);
    if (!group) {
      throw new Error('Permission group not found');
    }
    return group;
  }

  /** Block destructive or membership edits on system groups in the first pass. */
  private static assertCustomGroupEditable(group: PermissionGroupSummaryRecord): void {
    if (group.system_group) {
      throw new Error('System groups cannot be modified through this endpoint');
    }
  }

  /** Require one auth account id before mutating group membership. */
  private static requireAccountById(accountId: number): void {
    const db = getAuthDb();
    const row = db.prepare('SELECT id FROM auth_accounts WHERE id = ?').get(accountId) as { id: number } | undefined;
    if (!row) {
      throw new Error('Account not found');
    }
  }

  /** Build one stable custom group key from a readable name plus a short suffix. */
  private static buildCustomGroupKey(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'group';

    return `custom-${slug}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
}
