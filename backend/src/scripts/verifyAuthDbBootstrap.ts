import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-auth-db-'))
process.env.RUNTIME_DATABASE_DIR = path.join(process.env.RUNTIME_BASE_PATH, 'database')

type AuthDbModule = typeof import('../database/authDb')

const requiredTables = [
  'auth_credentials',
  'sessions',
  'auth_accounts',
  'auth_permission_groups',
  'auth_permissions',
  'auth_group_permissions',
  'auth_account_group_memberships',
]

function getCount(db: Database.Database, sql: string, ...params: unknown[]) {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined
  return row?.count ?? 0
}

function getRequiredRow<T>(db: Database.Database, sql: string, ...params: unknown[]) {
  const row = db.prepare(sql).get(...params) as T | undefined
  assert.ok(row, `Expected row for query: ${sql}`)
  return row
}

function createLegacyUserDb(databaseDir: string) {
  fs.mkdirSync(databaseDir, { recursive: true })

  const legacyDb = new Database(path.join(databaseDir, 'user.db'))
  try {
    legacyDb.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
    `)

    legacyDb.prepare(`
      INSERT INTO auth_credentials (id, username, password_hash, created_at, updated_at)
      VALUES (1, 'legacy-admin', 'hashed-password', '2026-05-14 00:00:00', '2026-05-14 00:01:00')
    `).run()
    legacyDb.prepare(`
      INSERT INTO sessions (sid, sess, expire)
      VALUES ('legacy-session', '{"cookie":{}}', 4102444800000)
    `).run()
  } finally {
    legacyDb.close()
  }
}

function getTableNames(db: Database.Database) {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  )
}

function assertCoreTablesExist(db: Database.Database) {
  const tableNames = getTableNames(db)
  for (const tableName of requiredTables) {
    assert.ok(tableNames.has(tableName), `Missing auth table: ${tableName}`)
  }
}

function assertSeededAccessControl(db: Database.Database) {
  const groups = db.prepare(`
    SELECT id, group_key, parent_group_id, system_group
    FROM auth_permission_groups
    ORDER BY priority ASC
  `).all() as Array<{ id: number; group_key: string; parent_group_id: number | null; system_group: number }>

  assert.deepEqual(groups.map((group) => group.group_key), ['anonymous', 'guest', 'admin'])
  assert.ok(groups.every((group) => group.system_group === 1), 'Built-in groups must stay marked as system groups')

  const groupIdByKey = new Map(groups.map((group) => [group.group_key, group.id]))
  assert.equal(groups.find((group) => group.group_key === 'guest')?.parent_group_id, groupIdByKey.get('anonymous'))
  assert.equal(groups.find((group) => group.group_key === 'admin')?.parent_group_id, groupIdByKey.get('guest'))

  const permissionCount = getCount(db, 'SELECT COUNT(*) AS count FROM auth_permissions')
  assert.ok(permissionCount > 0, 'Permission catalog must be seeded')

  const adminGroupId = groupIdByKey.get('admin')
  assert.equal(
    getCount(db, 'SELECT COUNT(*) AS count FROM auth_group_permissions WHERE group_id = ? AND allowed = 1', adminGroupId),
    permissionCount,
    'Admin group must receive every seeded permission',
  )
}

function assertLegacyMigration(db: Database.Database, databaseDir: string) {
  const credential = getRequiredRow<{ username: string; password_hash: string }>(
    db,
    'SELECT username, password_hash FROM auth_credentials WHERE id = 1',
  )
  assert.equal(credential.username, 'legacy-admin')
  assert.equal(credential.password_hash, 'hashed-password')
  assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM sessions WHERE sid = ?', 'legacy-session'), 1)

  const legacyDb = new Database(path.join(databaseDir, 'user.db'))
  try {
    const legacyTables = getTableNames(legacyDb)
    assert.equal(legacyTables.has('auth_credentials'), false, 'Legacy auth_credentials table must be removed after migration')
    assert.equal(legacyTables.has('sessions'), false, 'Legacy sessions table must be removed after migration')
  } finally {
    legacyDb.close()
  }
}

function assertLegacyAdminSynced(db: Database.Database) {
  const account = getRequiredRow<{ id: number; username: string; account_type: string; status: string }>(
    db,
    'SELECT id, username, account_type, status FROM auth_accounts WHERE sync_key = ?',
    'legacy-admin',
  )
  assert.equal(account.username, 'legacy-admin')
  assert.equal(account.account_type, 'admin')
  assert.equal(account.status, 'active')

  const adminGroup = getRequiredRow<{ id: number }>(
    db,
    'SELECT id FROM auth_permission_groups WHERE group_key = ?',
    'admin',
  )
  assert.equal(
    getCount(
      db,
      'SELECT COUNT(*) AS count FROM auth_account_group_memberships WHERE account_id = ? AND group_id = ?',
      account.id,
      adminGroup.id,
    ),
    1,
  )
}

function assertIdempotentBootstrap(authDbModule: AuthDbModule, databaseDir: string) {
  authDbModule.getAuthDb().close()
  authDbModule.initializeAuthDb()

  const db = authDbModule.getAuthDb()
  assertCoreTablesExist(db)
  assertSeededAccessControl(db)
  assertLegacyMigration(db, databaseDir)
  assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM auth_accounts WHERE sync_key = ?', 'legacy-admin'), 1)
  assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM auth_permission_groups'), 3)
}

function grantDirectPermission(db: Database.Database, groupKey: string, permissionKey: string) {
  const group = getRequiredRow<{ id: number }>(
    db,
    'SELECT id FROM auth_permission_groups WHERE group_key = ?',
    groupKey,
  )
  const permission = getRequiredRow<{ id: number }>(
    db,
    'SELECT id FROM auth_permissions WHERE permission_key = ?',
    permissionKey,
  )

  db.prepare(`
    INSERT INTO auth_group_permissions (group_id, permission_id, allowed, created_at, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, permission_id) DO UPDATE SET
      allowed = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(group.id, permission.id)
}

function assertDirectPermission(db: Database.Database, groupKey: string, permissionKey: string) {
  assert.equal(
    getCount(
      db,
      `
        SELECT COUNT(*) AS count
        FROM auth_group_permissions gp
        INNER JOIN auth_permission_groups g ON g.id = gp.group_id
        INNER JOIN auth_permissions p ON p.id = gp.permission_id
        WHERE g.group_key = ? AND p.permission_key = ? AND gp.allowed = 1
      `,
      groupKey,
      permissionKey,
    ),
    1,
    `${groupKey} direct permission must preserve ${permissionKey}`,
  )
}

function assertAnonymousBootstrapDoesNotRewriteConfiguredAccess(authDbModule: AuthDbModule) {
  const db = authDbModule.getAuthDb()
  grantDirectPermission(db, 'anonymous', 'page.home.view')
  grantDirectPermission(db, 'anonymous', 'page.wildcards.view')

  authDbModule.getAuthDb().close()
  authDbModule.initializeAuthDb()

  const refreshedDb = authDbModule.getAuthDb()
  assertDirectPermission(refreshedDb, 'anonymous', 'page.home.view')
  assertDirectPermission(refreshedDb, 'anonymous', 'page.wildcards.view')
}

function assertLegacySyncedAdminCleanup(authDbModule: AuthDbModule) {
  const db = authDbModule.getAuthDb()
  db.prepare('DELETE FROM auth_credentials WHERE id = 1').run()

  authDbModule.syncLegacyAuthCredentialToAccessControl()

  assert.equal(
    getCount(db, 'SELECT COUNT(*) AS count FROM auth_accounts WHERE sync_key = ?', 'legacy-admin'),
    0,
    'Mirrored legacy admin account must be removed when the legacy credential disappears',
  )
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
}

function assertTrustedBootstrapAdminMode() {
  const authHelpers = require('../routes/auth-route-helpers') as typeof import('../routes/auth-route-helpers')
  const authMiddleware = require('../middleware/authMiddleware') as typeof import('../middleware/authMiddleware')
  authHelpers.invalidateConfiguredAuthCache()

  assert.equal(authHelpers.hasConfiguredAuth(), false, 'Auth must be unconfigured after auth.db credentials are removed')

  const statusRequest = { session: {} }
  const statusPayload = authHelpers.buildAuthStatusPayload(statusRequest as any)
  assert.equal(statusPayload.hasCredentials, false)
  assert.equal(statusPayload.authenticated, true, 'Bootstrap mode must behave as an authenticated trusted session')
  assert.equal(statusPayload.accountType, 'admin', 'Bootstrap mode must advertise admin-equivalent account type')
  assert.equal(statusPayload.isAdmin, true, 'Bootstrap mode must expose admin-equivalent UI state')
  assert.ok(statusPayload.permissionKeys.includes('page.settings.view'))

  const adminRequest = { session: {} }
  const adminResponse = createMockResponse()
  let nextCalled = false
  authMiddleware.requireAdmin(adminRequest as any, adminResponse as any, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true, 'requireAdmin must allow trusted bootstrap mode')
  assert.equal(adminResponse.statusCode, 200)
}

function main() {
  const tempRoot = process.env.RUNTIME_BASE_PATH
  assert.ok(tempRoot, 'Expected temporary runtime root')
  const databaseDir = process.env.RUNTIME_DATABASE_DIR ?? path.join(tempRoot, 'database')

  createLegacyUserDb(databaseDir)

  const authDbModule = require('../database/authDb') as AuthDbModule
  authDbModule.initializeAuthDb()

  try {
    const db = authDbModule.getAuthDb()
    assert.equal(path.resolve(authDbModule.getAuthDbPath()), path.resolve(databaseDir, 'auth.db'))
    assertCoreTablesExist(db)
    assertSeededAccessControl(db)
    assertLegacyMigration(db, databaseDir)
    assertLegacyAdminSynced(db)
    assertIdempotentBootstrap(authDbModule, databaseDir)
    assertAnonymousBootstrapDoesNotRewriteConfiguredAccess(authDbModule)
    assertLegacySyncedAdminCleanup(authDbModule)
    assertTrustedBootstrapAdminMode()
  } finally {
    authDbModule.getAuthDb().close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('✅ Auth DB bootstrap contracts verified')
}

main()
