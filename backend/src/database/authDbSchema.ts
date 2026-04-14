import type Database from 'better-sqlite3';

/** Create authentication and access-control tables. */
export function createAuthTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('admin', 'guest')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      sync_key TEXT UNIQUE,
      created_by_account_id INTEGER,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_account_id) REFERENCES auth_accounts(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_permission_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      parent_group_id INTEGER,
      priority INTEGER NOT NULL DEFAULT 0,
      system_group INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_group_id) REFERENCES auth_permission_groups(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permission_key TEXT NOT NULL UNIQUE,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_group_permissions (
      group_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, permission_id),
      FOREIGN KEY (group_id) REFERENCES auth_permission_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES auth_permissions(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_account_group_memberships (
      account_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, group_id),
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES auth_permission_groups(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_accounts_status ON auth_accounts(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_permission_groups_parent ON auth_permission_groups(parent_group_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_group_permissions_permission ON auth_group_permissions(permission_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_account_group_memberships_group ON auth_account_group_memberships(group_id)
  `);
}
