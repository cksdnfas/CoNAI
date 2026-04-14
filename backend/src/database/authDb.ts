import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';
import { createAuthTables } from './authDbSchema';
import { seedAccessControlDefaults } from './authDbSeed';

const AUTH_DB_PATH = path.join(runtimePaths.databaseDir, 'auth.db');
const LEGACY_ADMIN_SYNC_KEY = 'legacy-admin';

interface LegacyAuthCredentialRecord {
  username: string;
  password_hash: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Authentication Database Instance
 * Separated from the unified user database for easy account recovery.
 *
 * Recovery: Simply delete auth.db and restart server.
 */
export let authDb: Database.Database;

/**
 * Initialize authentication storage and seed access-control foundations.
 */
export function initializeAuthDb(): void {
  try {
    const dbDir = path.dirname(AUTH_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const isNewDatabase = !fs.existsSync(AUTH_DB_PATH);
    authDb = new Database(AUTH_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New authentication database created');
    } else {
      console.log('✅ Connected to existing authentication database');
    }

    createAuthTables(authDb);
    migrateFromLegacyUserDbs();
    seedAccessControlDefaults(authDb);
    syncLegacyAuthCredentialToAccessControl();
  } catch (error) {
    console.error('Failed to initialize authentication database:', error);
    throw error;
  }
}

/** Resolve one permission-group id by its stable key. */
function getPermissionGroupIdByKey(groupKey: string): number | null {
  const row = authDb.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?').get(groupKey) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Mirror the legacy single-admin credential into the new account model.
 */
export function syncLegacyAuthCredentialToAccessControl(): void {
  try {
    const legacyCredential = authDb.prepare(
      'SELECT username, password_hash, created_at, updated_at FROM auth_credentials WHERE id = 1'
    ).get() as LegacyAuthCredentialRecord | undefined;

    if (!legacyCredential) {
      removeLegacySyncedAdminAccount();
      return;
    }

    const adminGroupId = getPermissionGroupIdByKey('admin');
    if (adminGroupId === null) {
      return;
    }

    const existingAccount = authDb.prepare(
      'SELECT id FROM auth_accounts WHERE sync_key = ?'
    ).get(LEGACY_ADMIN_SYNC_KEY) as { id: number } | undefined;

    let accountId = existingAccount?.id ?? null;

    if (existingAccount) {
      authDb.prepare(`
        UPDATE auth_accounts
        SET username = ?, password_hash = ?, account_type = 'admin', status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(legacyCredential.username, legacyCredential.password_hash, existingAccount.id);
    } else {
      const insertResult = authDb.prepare(`
        INSERT INTO auth_accounts (
          username, password_hash, account_type, status, sync_key, created_at, updated_at
        ) VALUES (?, ?, 'admin', 'active', ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      `).run(
        legacyCredential.username,
        legacyCredential.password_hash,
        LEGACY_ADMIN_SYNC_KEY,
        legacyCredential.created_at ?? null,
        legacyCredential.updated_at ?? null,
      );

      accountId = insertResult.lastInsertRowid as number;
    }

    if (accountId !== null) {
      authDb.prepare(`
        INSERT OR IGNORE INTO auth_account_group_memberships (account_id, group_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(accountId, adminGroupId);
    }
  } catch (error) {
    console.error('  ⚠️  Failed to sync the legacy auth credential into access-control tables:', error);
  }
}

/**
 * Remove the mirrored legacy admin account when no legacy credential remains.
 */
function removeLegacySyncedAdminAccount(): void {
  const row = authDb.prepare('SELECT id FROM auth_accounts WHERE sync_key = ?').get(LEGACY_ADMIN_SYNC_KEY) as { id: number } | undefined;
  if (!row) {
    return;
  }

  authDb.prepare('DELETE FROM auth_account_group_memberships WHERE account_id = ?').run(row.id);
  authDb.prepare('DELETE FROM auth_accounts WHERE id = ?').run(row.id);
}

/**
 * Migrate authentication data from legacy user database files to auth.db.
 * This checks both user.db and user-settings.db so upgrades stay safe and idempotent.
 */
function migrateFromLegacyUserDbs(): void {
  try {
    const candidatePaths = [
      path.join(runtimePaths.databaseDir, 'user.db'),
      path.join(runtimePaths.databaseDir, 'user-settings.db'),
    ];

    for (const candidatePath of candidatePaths) {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const userSettingsDb = new Database(candidatePath);

      try {
        const tables = userSettingsDb.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='auth_credentials'
        `).all();

        if (tables.length === 0) {
          continue;
        }

        const authData = userSettingsDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get() as any;
        if (!authData) {
          continue;
        }

        const existingAuth = authDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get();
        if (existingAuth) {
          console.log(`  ℹ️  Authentication data already exists in auth.db, skipping migration from ${path.basename(candidatePath)}`);
          continue;
        }

        console.log(`🔄 Migrating authentication data from ${path.basename(candidatePath)} to auth.db...`);
        authDb.prepare(`
          INSERT INTO auth_credentials (id, username, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(authData.id, authData.username, authData.password_hash, authData.created_at, authData.updated_at);

        const sessions = userSettingsDb.prepare('SELECT * FROM sessions').all();
        if (sessions.length > 0) {
          const insertSession = authDb.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
          const insertMany = authDb.transaction((sessionList: any[]) => {
            for (const session of sessionList) {
              insertSession.run(session.sid, session.sess, session.expire);
            }
          });
          insertMany(sessions);
          console.log(`  ✅ Migrated ${sessions.length} session(s)`);
        }

        console.log('  ✅ Authentication data migrated successfully');
        console.log(`  🧹 Removing old authentication tables from ${path.basename(candidatePath)}...`);
        userSettingsDb.exec('DROP TABLE IF EXISTS auth_credentials');
        userSettingsDb.exec('DROP TABLE IF EXISTS sessions');
        console.log('  ✅ Old authentication tables removed');
        return;
      } finally {
        userSettingsDb.close();
      }
    }
  } catch (error) {
    console.error('  ⚠️  Error during authentication data migration:', error);
  }
}

/**
 * Close database connection.
 */
export function closeAuthDb(): void {
  if (authDb) {
    authDb.close();
    console.log('Authentication database connection closed');
  }
}

/**
 * Get the live authentication database instance.
 */
export function getAuthDb(): Database.Database {
  if (!authDb) {
    throw new Error('Authentication database not initialized');
  }
  return authDb;
}

/**
 * Get the auth database file path.
 */
export function getAuthDbPath(): string {
  return AUTH_DB_PATH;
}
