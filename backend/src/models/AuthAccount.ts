import { getAuthDb } from '../database/authDb';
import { AuthService } from '../services/authService';

export type AuthAccountType = 'admin' | 'guest';
export type AuthAccountStatus = 'active' | 'disabled';
export type AssignableSystemGroupKey = 'admin' | 'guest';

export interface AuthAccountRecord {
  id: number;
  username: string;
  password_hash: string;
  account_type: AuthAccountType;
  status: AuthAccountStatus;
  sync_key: string | null;
  created_by_account_id: number | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthAccountListRecord {
  id: number;
  username: string;
  account_type: AuthAccountType;
  status: AuthAccountStatus;
  sync_key: string | null;
  created_by_account_id: number | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  group_keys: string[];
}

/** Resolve and mutate local auth accounts in the new access-control model. */
export class AuthAccount {
  /** Check whether any local auth account exists. */
  static exists(): boolean {
    const db = getAuthDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM auth_accounts').get() as { count: number };
    return result.count > 0;
  }

  /** Find one auth account by its id. */
  static findById(accountId: number): AuthAccountRecord | null {
    const db = getAuthDb();
    const row = db.prepare('SELECT * FROM auth_accounts WHERE id = ?').get(accountId) as AuthAccountRecord | undefined;
    return row ?? null;
  }

  /** Find one auth account by its username. */
  static findByUsername(username: string): AuthAccountRecord | null {
    const db = getAuthDb();
    const row = db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get(username) as AuthAccountRecord | undefined;
    return row ?? null;
  }

  /** List all accounts with their current permission-group memberships. */
  static listAll(): AuthAccountListRecord[] {
    const db = getAuthDb();
    const rows = db.prepare(`
      SELECT
        a.id,
        a.username,
        a.account_type,
        a.status,
        a.sync_key,
        a.created_by_account_id,
        a.last_login_at,
        a.created_at,
        a.updated_at,
        GROUP_CONCAT(g.group_key) as group_keys_csv
      FROM auth_accounts a
      LEFT JOIN auth_account_group_memberships agm ON agm.account_id = a.id
      LEFT JOIN auth_permission_groups g ON g.id = agm.group_id
      GROUP BY a.id
      ORDER BY
        CASE a.account_type WHEN 'admin' THEN 0 ELSE 1 END,
        a.created_at ASC,
        a.id ASC
    `).all() as Array<AuthAccountRecord & { group_keys_csv: string | null }>;

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      account_type: row.account_type,
      status: row.status,
      sync_key: row.sync_key,
      created_by_account_id: row.created_by_account_id,
      last_login_at: row.last_login_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      group_keys: row.group_keys_csv ? row.group_keys_csv.split(',').filter(Boolean) : [],
    }));
  }

  /** Create a new guest account and attach the guest system group. */
  static async createGuest(username: string, password: string, createdByAccountId: number | null = null): Promise<AuthAccountRecord> {
    const db = getAuthDb();
    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      throw new Error('Username is required');
    }
    if (!password) {
      throw new Error('Password is required');
    }
    if (this.findByUsername(normalizedUsername)) {
      throw new Error('Username already exists');
    }

    const passwordHash = await AuthService.hashPassword(password);
    const guestGroupId = this.getPermissionGroupIdByKey('guest');
    if (guestGroupId === null) {
      throw new Error('Guest group is not initialized');
    }

    const createTransaction = db.transaction(() => {
      const insertResult = db.prepare(`
        INSERT INTO auth_accounts (
          username, password_hash, account_type, status, created_by_account_id, created_at, updated_at
        ) VALUES (?, ?, 'guest', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(normalizedUsername, passwordHash, createdByAccountId);

      const accountId = insertResult.lastInsertRowid as number;
      db.prepare(`
        INSERT INTO auth_account_group_memberships (account_id, group_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(accountId, guestGroupId);

      return accountId;
    });

    const accountId = createTransaction();
    const account = this.findById(accountId);
    if (!account) {
      throw new Error('Failed to create guest account');
    }

    return account;
  }

  /** Verify one username and password against the multi-account table. */
  static async verify(username: string, password: string): Promise<AuthAccountRecord | null> {
    const account = this.findByUsername(username.trim());
    if (!account || account.status !== 'active') {
      return null;
    }

    const isValid = await AuthService.verifyPassword(account.password_hash, password);
    return isValid ? account : null;
  }

  /** Update the last login timestamp for one account. */
  static touchLastLogin(accountId: number): void {
    const db = getAuthDb();
    db.prepare(`
      UPDATE auth_accounts
      SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(accountId);
  }

  /** Change the current system group assignment for one account. */
  static assignSystemGroup(accountId: number, groupKey: AssignableSystemGroupKey): AuthAccountRecord {
    const db = getAuthDb();
    const account = this.findById(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const targetGroupId = this.getPermissionGroupIdByKey(groupKey);
    if (targetGroupId === null) {
      throw new Error('Target group not found');
    }

    const systemGroupIds = this.getSystemAssignableGroupIds();
    const updateTransaction = db.transaction(() => {
      if (systemGroupIds.length > 0) {
        const placeholders = systemGroupIds.map(() => '?').join(', ');
        db.prepare(`
          DELETE FROM auth_account_group_memberships
          WHERE account_id = ? AND group_id IN (${placeholders})
        `).run(accountId, ...systemGroupIds);
      }

      db.prepare(`
        INSERT OR IGNORE INTO auth_account_group_memberships (account_id, group_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(accountId, targetGroupId);

      db.prepare(`
        UPDATE auth_accounts
        SET account_type = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(groupKey, accountId);
    });

    updateTransaction();

    const updatedAccount = this.findById(accountId);
    if (!updatedAccount) {
      throw new Error('Failed to update account group');
    }

    return updatedAccount;
  }

  /** Change one removable account password from the admin UI. */
  static async updatePassword(accountId: number, password: string): Promise<AuthAccountRecord> {
    const db = getAuthDb();
    const account = this.findById(accountId);
    if (!account) {
      throw new Error('Account not found');
    }
    if (!password.trim()) {
      throw new Error('Password is required');
    }
    if (account.sync_key) {
      throw new Error('Synced legacy admin passwords must be changed from the main credentials form');
    }

    const passwordHash = await AuthService.hashPassword(password);
    db.prepare(`
      UPDATE auth_accounts
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, accountId);

    const updatedAccount = this.findById(accountId);
    if (!updatedAccount) {
      throw new Error('Failed to update account password');
    }

    return updatedAccount;
  }

  /** Delete one removable local account and its memberships. */
  static delete(accountId: number): void {
    const db = getAuthDb();
    const account = this.findById(accountId);
    if (!account) {
      throw new Error('Account not found');
    }
    if (account.sync_key) {
      throw new Error('Synced legacy admin accounts cannot be deleted');
    }
    if (account.account_type === 'admin' && account.status === 'active' && this.countActiveAdmins() <= 1) {
      throw new Error('At least one active admin account must remain');
    }

    const deleteTransaction = db.transaction(() => {
      db.prepare('DELETE FROM auth_account_group_memberships WHERE account_id = ?').run(accountId);
      db.prepare('DELETE FROM auth_accounts WHERE id = ?').run(accountId);
    });

    deleteTransaction();
  }

  /** Count active admin accounts for lockout protection. */
  static countActiveAdmins(): number {
    const db = getAuthDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM auth_accounts
      WHERE account_type = 'admin' AND status = 'active'
    `).get() as { count: number };
    return result.count;
  }

  /** List built-in assignable groups for the first admin UI slice. */
  static listAssignableSystemGroups(): Array<{ group_key: AssignableSystemGroupKey; name: string }> {
    const db = getAuthDb();
    return db.prepare(`
      SELECT group_key, name
      FROM auth_permission_groups
      WHERE group_key IN ('guest', 'admin')
      ORDER BY priority ASC, id ASC
    `).all() as Array<{ group_key: AssignableSystemGroupKey; name: string }>;
  }

  /** Resolve a permission-group id by key. */
  private static getPermissionGroupIdByKey(groupKey: string): number | null {
    const db = getAuthDb();
    const row = db.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?').get(groupKey) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** Collect the current ids of built-in assignable system groups. */
  private static getSystemAssignableGroupIds(): number[] {
    const db = getAuthDb();
    const rows = db.prepare(`
      SELECT id
      FROM auth_permission_groups
      WHERE group_key IN ('guest', 'admin')
    `).all() as Array<{ id: number }>;

    return rows.map((row) => row.id);
  }
}
