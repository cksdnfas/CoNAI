import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createAuthTables } from '../src/database/authDbSchema'
import { migratePermissionsV3 } from '../src/database/authDbSeed'
import { migrateChatPermissionsV3 } from '../src/database/chatPermissionsV3Migration'

/** An auth.db before permissions_v3: system groups, one custom group, the given v2 grants. */
function authDb(grants: Record<string, string[]>) {
  const db = new Database(':memory:')
  createAuthTables(db)
  const group = db.prepare('INSERT INTO auth_permission_groups (group_key, name, parent_group_id, priority, system_group) VALUES (?, ?, ?, ?, ?)')
  const anonymous = Number(group.run('anonymous', 'Anonymous', null, 0, 1).lastInsertRowid)
  const guest = Number(group.run('guest', 'Guest', anonymous, 10, 1).lastInsertRowid)
  group.run('admin', 'Admin', guest, 100, 1)
  group.run('artists', 'Artists', guest, 20, 0)
  group.run('viewers', 'Viewers', guest, 20, 0)
  const keys = [...new Set(Object.values(grants).flat())]
  for (const key of keys) db.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run(key, key.split('.')[0], 'x')
  for (const [groupKey, held] of Object.entries(grants)) {
    for (const key of held) {
      db.prepare(`INSERT INTO auth_group_permissions (group_id, permission_id, allowed)
        SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = ? AND p.permission_key = ?`).run(groupKey, key)
    }
  }
  return db
}

function userDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE chat_settings_migrations (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE llm_chat_profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, engine TEXT NOT NULL, allowed_group_keys TEXT NOT NULL DEFAULT '[]',
      mcp_scopes TEXT, delegated_permissions TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, updated_date TEXT);
    CREATE TABLE chat_tool_presets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, scopes TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_date TEXT);`)
  const profile = db.prepare('INSERT INTO llm_chat_profiles (id, name, engine, allowed_group_keys, mcp_scopes, delegated_permissions) VALUES (?, ?, ?, ?, ?, ?)')
  profile.run(1, 'Codex helper', 'codex', '[]', '["read","organize"]', '["images.view","files.view"]')
  profile.run(2, 'Claude scoped', 'claude', '["viewers"]', '["read"]', '[]')
  profile.run(3, 'Roleplay', 'llm', '[]', '["read","generate","organize","configure"]', '[]')
  profile.run(4, 'Claude open', 'claude', '[]', '["read","organize","delete"]', '[]')
  db.prepare('INSERT INTO chat_tool_presets (id, name, scopes) VALUES (?, ?, ?)').run(1, '전부', '["read","generate","organize"]')
  return db
}

const row = (db: Database.Database, id: number) => db.prepare('SELECT allowed_group_keys, mcp_scopes, revision FROM llm_chat_profiles WHERE id = ?').get(id) as { allowed_group_keys: string; mcp_scopes: string; revision: number }

function capture(run: () => void) {
  const lines: string[] = []
  const log = console.log
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')) }
  try { run() } finally { console.log = log }
  return lines.join('\n')
}

test('agent profiles without an audience keep only the groups that held chat.agent.use; organize gains delete; once', () => {
  const auth = authDb({ guest: ['chat.use', 'images.view'], artists: ['chat.agent.use'] })
  const user = userDb()
  // user.db waits until auth.db has converted.
  migrateChatPermissionsV3(user, auth)
  assert.equal(row(user, 1).allowed_group_keys, '[]')
  capture(() => migratePermissionsV3(auth))
  const log = capture(() => migrateChatPermissionsV3(user, auth))

  assert.deepEqual(JSON.parse(row(user, 1).allowed_group_keys), ['admin', 'artists'])
  assert.deepEqual(JSON.parse(row(user, 1).mcp_scopes), ['read', 'organize', 'delete'])
  assert.equal(row(user, 1).revision, 3)
  // A named audience, an API LLM profile and scopes that already hold delete stay as they were.
  assert.deepEqual(JSON.parse(row(user, 2).allowed_group_keys), ['viewers'])
  assert.equal(row(user, 3).allowed_group_keys, '[]')
  assert.deepEqual(JSON.parse(row(user, 3).mcp_scopes), ['read', 'generate', 'organize', 'delete', 'configure'])
  assert.deepEqual(JSON.parse(row(user, 4).allowed_group_keys), ['admin', 'artists'])
  assert.deepEqual(JSON.parse(row(user, 4).mcp_scopes), ['read', 'organize', 'delete'])
  assert.deepEqual(JSON.parse((user.prepare('SELECT scopes FROM chat_tool_presets WHERE id = 1').get() as { scopes: string }).scopes), ['read', 'generate', 'organize', 'delete'])

  assert.match(log, /profile #1 "Codex helper": audience \[\] → \[admin, artists\]/)
  assert.match(log, /profile #1 "Codex helper": scopes \+ delete/)
  assert.match(log, /profile #1 "Codex helper": delegated permissions \[images\.view, files\.view\] no longer apply/)
  assert.match(log, /tool preset #1 "전부": scopes \+ delete/)
  assert.equal(log.split('\n').filter((line) => line.startsWith('  - ')).length, 6)

  // Once: a later start changes and logs nothing, even after an administrator empties an audience again.
  user.prepare("UPDATE llm_chat_profiles SET allowed_group_keys = '[]' WHERE id = 1").run()
  assert.equal(capture(() => migrateChatPermissionsV3(user, auth)), '')
  assert.equal(row(user, 1).allowed_group_keys, '[]')
})

test('when every account could use agents (the guest group held chat.agent.use) audiences stay empty', () => {
  const auth = authDb({ guest: ['chat.agent.use'], artists: ['chat.agent.use'] })
  const user = userDb()
  capture(() => migratePermissionsV3(auth))
  capture(() => migrateChatPermissionsV3(user, auth))
  assert.equal(row(user, 1).allowed_group_keys, '[]')
  assert.equal(row(user, 4).allowed_group_keys, '[]')
  assert.deepEqual(JSON.parse(row(user, 1).mcp_scopes), ['read', 'organize', 'delete'])
})

test('an auth.db converted without the record leaves agent profiles to administrators', () => {
  const auth = authDb({ artists: ['chat.agent.use'] })
  auth.prepare("INSERT INTO auth_seed_state (seed_key) VALUES ('permissions_v3')").run()
  const user = userDb()
  const log = capture(() => migrateChatPermissionsV3(user, auth))
  assert.deepEqual(JSON.parse(row(user, 1).allowed_group_keys), ['admin'])
  assert.match(log, /no record of who held chat\.agent\.use/)
})
