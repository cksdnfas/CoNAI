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
  'auth_seed_state',
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

  assertDirectPermission(db, 'anonymous', 'auth.guest.create')
  assert.equal(
    getCount(db, 'SELECT COUNT(*) AS count FROM auth_seed_state WHERE seed_key = ?', 'anonymous_guest_signup_enabled_v1'),
    1,
    'Anonymous guest-signup default must be recorded exactly once',
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
  db.prepare(`
    DELETE FROM auth_group_permissions
    WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous')
      AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'auth.guest.create')
  `).run()

  authDbModule.getAuthDb().close()
  authDbModule.initializeAuthDb()

  const refreshedDb = authDbModule.getAuthDb()
  assertDirectPermission(refreshedDb, 'anonymous', 'page.home.view')
  assertDirectPermission(refreshedDb, 'anonymous', 'page.wildcards.view')
  assert.equal(
    getCount(
      refreshedDb,
      `
        SELECT COUNT(*) AS count
        FROM auth_group_permissions gp
        INNER JOIN auth_permission_groups g ON g.id = gp.group_id
        INNER JOIN auth_permissions p ON p.id = gp.permission_id
        WHERE g.group_key = 'anonymous' AND p.permission_key = 'auth.guest.create' AND gp.allowed = 1
      `,
    ),
    0,
    'Bootstrap must preserve an administrator choice to disable guest signup after the default seed',
  )
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

function assertAuthConfigurationRequiresUsableAdmin(authDbModule: AuthDbModule) {
  const authHelpers = require('../routes/auth-route-helpers') as typeof import('../routes/auth-route-helpers')
  const db = authDbModule.getAuthDb()
  const guestGroup = getRequiredRow<{ id: number }>(
    db,
    'SELECT id FROM auth_permission_groups WHERE group_key = ?',
    'guest',
  )

  const guestAccountId = db.prepare(`
    INSERT INTO auth_accounts (
      username, password_hash, account_type, status, created_at, updated_at
    ) VALUES ('orphan-guest', 'hashed-password', 'guest', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run().lastInsertRowid as number

  db.prepare(`
    INSERT INTO auth_account_group_memberships (account_id, group_id, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(guestAccountId, guestGroup.id)

  authHelpers.invalidateConfiguredAuthCache()
  assert.equal(
    authHelpers.hasConfiguredAuth(),
    false,
    'A non-admin account must not close first-run bootstrap access',
  )

  const adminGroup = getRequiredRow<{ id: number }>(
    db,
    'SELECT id FROM auth_permission_groups WHERE group_key = ?',
    'admin',
  )
  const adminAccountId = db.prepare(`
    INSERT INTO auth_accounts (
      username, password_hash, account_type, status, created_at, updated_at
    ) VALUES ('standalone-admin', 'hashed-password', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run().lastInsertRowid as number

  db.prepare(`
    INSERT INTO auth_account_group_memberships (account_id, group_id, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(adminAccountId, adminGroup.id)

  authHelpers.invalidateConfiguredAuthCache()
  assert.equal(
    authHelpers.hasConfiguredAuth(),
    true,
    'An active admin account must count as configured auth even without legacy credentials',
  )
}

/**
 * express-session runs with resave:false, so the session row is written only when the serialized
 * session (cookie excluded) differs from the one loaded at the start of the request.
 */
function serializeSession(session: Record<string, unknown>) {
  return JSON.stringify(session, (key, value) => (key === 'cookie' ? undefined : value))
}

/**
 * The anonymous access path must not rewrite the session on any request whose access is unchanged.
 *
 * Two distinct rewrites are ruled out here. A cache hit must leave the session alone, and a cache
 * miss must write back exactly the values that were already there. The second half is the one that
 * matters: the access-cache freshness stamp lives in the process, never in the session, because a
 * timestamp inside the session body changes the serialized content every time the TTL lapses and
 * therefore manufactures an auth.db write per session per TTL window. The access epoch still makes
 * explicit permission changes land on the very next request.
 */
function assertAnonymousSessionAccessIsNotRewrittenPerRequest() {
  const authHelpers = require('../routes/auth-route-helpers') as typeof import('../routes/auth-route-helpers')
  const authMiddleware = require('../middleware/authMiddleware') as typeof import('../middleware/authMiddleware')
  const accessControl = require('../services/authAccessControlService') as typeof import('../services/authAccessControlService')

  authHelpers.invalidateConfiguredAuthCache()
  assert.equal(authHelpers.hasConfiguredAuth(), true, 'anonymous handling only applies once auth is configured')

  const request = { sessionID: 'anonymous-session', session: {} as Record<string, unknown> }
  const guard = authMiddleware.allowAnonymousPermission('page.home.view')

  let firstNextCalled = false
  guard(request as any, createMockResponse() as any, () => {
    firstNextCalled = true
  })
  assert.equal(firstNextCalled, true, 'the anonymous group must keep its granted permission')

  const firstPermissionKeys = request.session.permissionKeys
  const firstGroupKeys = request.session.groupKeys
  assert.ok(Array.isArray(firstPermissionKeys), 'anonymous access must still populate permissionKeys')
  assert.ok(Array.isArray(firstGroupKeys), 'anonymous access must still populate groupKeys')
  assert.equal(request.session.accessCacheEpoch, accessControl.getResolvedAuthAccessEpoch())
  assert.equal(request.session.accessCacheAccountId, undefined, 'anonymous sessions must not claim an account id')
  assert.equal(
    request.session.accessCacheUpdatedAt,
    undefined,
    'the freshness stamp must stay out of the session body, or the TTL turns into a write per window',
  )

  const freshSignature = serializeSession(request.session)

  let secondNextCalled = false
  guard(request as any, createMockResponse() as any, () => {
    secondNextCalled = true
  })
  assert.equal(secondNextCalled, true, 'a cached anonymous session must resolve the same permission')
  assert.equal(
    serializeSession(request.session),
    freshSignature,
    'a still-fresh anonymous session must not be rewritten on the next request',
  )
  assert.equal(request.session.permissionKeys, firstPermissionKeys, 'cached anonymous permissionKeys must be reused as-is')
  assert.equal(request.session.groupKeys, firstGroupKeys, 'cached anonymous groupKeys must be reused as-is')

  // A session this process has never stamped — a restart, an evicted entry, or a lapsed TTL —
  // must take the full re-resolve path and still land on byte-identical content, so the miss
  // costs a resolution rather than an auth.db write.
  const coldRequest = { sessionID: 'anonymous-session-cold', session: { ...request.session } }
  let coldNextCalled = false
  guard(coldRequest as any, createMockResponse() as any, () => {
    coldNextCalled = true
  })
  assert.equal(coldNextCalled, true, 'an unstamped anonymous session must resolve the same permission')
  assert.equal(
    serializeSession(coldRequest.session),
    freshSignature,
    'a re-resolve with unchanged access must write back identical session content',
  )

  accessControl.invalidateResolvedAuthAccessCache()
  let thirdNextCalled = false
  guard(request as any, createMockResponse() as any, () => {
    thirdNextCalled = true
  })
  assert.equal(thirdNextCalled, true)
  assert.equal(
    request.session.accessCacheEpoch,
    accessControl.getResolvedAuthAccessEpoch(),
    'an access epoch bump must refresh the cached anonymous access on the very next request',
  )
  assert.notEqual(
    request.session.permissionKeys,
    firstPermissionKeys,
    'an access epoch bump must re-resolve anonymous permissions instead of reusing the cache',
  )
}

/**
 * The SPA shell embeds the auth-status payload on every full page load, so the payload builder
 * must not rewrite an unchanged session. It reuses the access cache the permission middleware
 * stamped and never advances that stamp itself, so it can never introduce a session store write
 * of its own. The access epoch still makes grants and revocations land on the very next request.
 */
function assertAuthStatusPayloadReusesSessionAccessCache(authDbModule: AuthDbModule) {
  const authHelpers = require('../routes/auth-route-helpers') as typeof import('../routes/auth-route-helpers')
  const accessControl = require('../services/authAccessControlService') as typeof import('../services/authAccessControlService')
  const db = authDbModule.getAuthDb()

  authHelpers.invalidateConfiguredAuthCache()
  assert.equal(authHelpers.hasConfiguredAuth(), true, 'the auth-status cache path only applies once auth is configured')

  const guestAccount = getRequiredRow<{ id: number; username: string }>(
    db,
    'SELECT id, username FROM auth_accounts WHERE username = ?',
    'orphan-guest',
  )

  const session = {} as Record<string, unknown>
  const request = { sessionID: 'auth-status-session', session }
  authHelpers.setAuthenticatedSession(request as any, {
    id: guestAccount.id,
    username: guestAccount.username,
    account_type: 'guest',
  })

  const firstPayload = authHelpers.buildAuthStatusPayload(request as any)
  assert.equal(firstPayload.accountId, guestAccount.id)
  assert.ok(firstPayload.permissionKeys.includes('page.home.view'), 'the guest account must inherit anonymous page access')

  const freshSignature = serializeSession(session)
  const cachedPermissionKeys = session.permissionKeys
  assert.equal(
    session.accessCacheUpdatedAt,
    undefined,
    'an authenticated session must not carry a freshness stamp in its body either',
  )

  const cachedPayload = authHelpers.buildAuthStatusPayload(request as any)
  assert.equal(
    serializeSession(session),
    freshSignature,
    'a still-fresh session must not be rewritten by the auth-status payload builder',
  )
  assert.equal(session.permissionKeys, cachedPermissionKeys, 'cached permissionKeys must be reused as-is')
  assert.deepEqual(cachedPayload.permissionKeys, firstPayload.permissionKeys)

  grantDirectPermission(db, 'guest', 'page.generation.view')
  accessControl.invalidateResolvedAuthAccessCache()

  const grantedPayload = authHelpers.buildAuthStatusPayload(request as any)
  assert.ok(
    grantedPayload.permissionKeys.includes('page.generation.view'),
    'an access epoch bump must re-resolve the auth-status payload on the very next request',
  )
  assert.ok(
    (session.permissionKeys as string[]).includes('page.generation.view'),
    'the epoch bump must also refresh the session-cached permissionKeys',
  )

  db.prepare(`
    UPDATE auth_group_permissions SET allowed = 0
    WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'guest')
      AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'page.generation.view')
  `).run()
  accessControl.invalidateResolvedAuthAccessCache()

  const revokedPayload = authHelpers.buildAuthStatusPayload(request as any)
  assert.equal(
    revokedPayload.permissionKeys.includes('page.generation.view'),
    false,
    'a revoked permission must disappear from the auth-status payload on the very next request',
  )
  assert.equal(
    (session.permissionKeys as string[]).includes('page.generation.view'),
    false,
    'a revoked permission must also be dropped from the session cache',
  )

  // Legacy bootstrap residue: authenticated with no account id must never keep bootstrap access.
  const residueSession = {
    authenticated: true,
    username: 'Bootstrap',
    accountType: 'admin',
    groupKeys: ['bootstrap'],
    permissionKeys: ['page.settings.view'],
    accessCacheEpoch: accessControl.getResolvedAuthAccessEpoch(),
    accessCacheUpdatedAt: Date.now(),
  } as Record<string, unknown>
  const residuePayload = authHelpers.buildAuthStatusPayload({ session: residueSession } as any)
  assert.equal(
    residuePayload.permissionKeys.includes('page.settings.view'),
    false,
    'a legacy bootstrap session must not keep admin access once auth is configured',
  )
  assert.deepEqual(residueSession.groupKeys, ['anonymous'], 'bootstrap residue must be downgraded to anonymous access')
}

/**
 * Session touch writes must be throttled without changing login persistence or expiry renewal.
 * express-session calls store.touch() on every request, which is a synchronous auth.db UPDATE on
 * the shared event loop; only redundant writes inside the drift window may be skipped.
 */
function assertSessionTouchThrottleContracts() {
  const {
    SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS,
    throttleSessionStoreTouch,
  } = require('../utils/sessionTouchThrottle') as typeof import('../utils/sessionTouchThrottle')

  assert.equal(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS, 60 * 60 * 1000, 'the touch drift window must stay at one hour')

  const touchedExpiries: Array<number | null> = []
  const persistedSids: string[] = []
  const destroyedSids: string[] = []

  const fakeStore = {
    touch(_sid: string, sessionData: any, callback?: (err?: unknown) => void) {
      const expires = sessionData?.cookie?.expires
      touchedExpiries.push(expires instanceof Date ? expires.getTime() : null)
      callback?.()
    },
    set(sid: string, _sessionData: any, callback?: (err?: unknown) => void) {
      persistedSids.push(sid)
      callback?.()
    },
    destroy(sid: string, callback?: (err?: unknown) => void) {
      destroyedSids.push(sid)
      callback?.()
    },
  }

  const store = throttleSessionStoreTouch(fakeStore as any)
  const baseExpiryMs = Date.UTC(2026, 7, 4, 0, 0, 0)
  const sessionExpiringAt = (offsetMs: number) => ({
    cookie: { expires: new Date(baseExpiryMs + offsetMs), maxAge: 30 * 24 * 60 * 60 * 1000 },
  }) as any

  store.touch!('sid-1', sessionExpiringAt(0))
  assert.equal(touchedExpiries.length, 1, 'the first touch of a session must reach the store')

  store.touch!('sid-1', sessionExpiringAt(60_000))
  store.touch!('sid-1', sessionExpiringAt(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS - 1))
  assert.equal(touchedExpiries.length, 1, 'touch writes inside the drift window must be skipped')

  store.touch!('sid-1', sessionExpiringAt(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS))
  assert.equal(touchedExpiries.length, 2, 'expiry renewal must still be persisted once the drift window elapses')
  assert.equal(touchedExpiries[1], baseExpiryMs + SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS, 'the renewed expiry must be the real one')

  store.touch!('sid-2', sessionExpiringAt(0))
  assert.equal(touchedExpiries.length, 3, 'each session must be tracked independently')

  store.set('sid-2', sessionExpiringAt(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS * 2))
  assert.deepEqual(persistedSids, ['sid-2'], 'session saves must still reach the store')
  store.touch!('sid-2', sessionExpiringAt(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS * 2 + 1_000))
  assert.equal(touchedExpiries.length, 3, 'a save must refresh the tracked expiry so the next touch can be skipped')

  store.destroy('sid-2')
  assert.deepEqual(destroyedSids, ['sid-2'], 'session destroys must still reach the store')
  store.touch!('sid-2', sessionExpiringAt(SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS * 2 + 2_000))
  assert.equal(touchedExpiries.length, 4, 'a destroyed session must not keep a stale tracked expiry')

  store.touch!('sid-3', { cookie: {} } as any)
  store.touch!('sid-3', { cookie: {} } as any)
  assert.equal(touchedExpiries.length, 6, 'sessions without a resolvable expiry must always be written')
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
    assertAuthConfigurationRequiresUsableAdmin(authDbModule)
    assertAnonymousSessionAccessIsNotRewrittenPerRequest()
    assertAuthStatusPayloadReusesSessionAccessCache(authDbModule)
    assertSessionTouchThrottleContracts()
  } finally {
    authDbModule.getAuthDb().close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('✅ Auth DB bootstrap contracts verified')
}

main()
