import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** A chat that linked one project before projects could be several keeps it, and can link more. */
test('chat project links migrate from the single-project table without losing the link', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-workspaces-migration-test-'))
  process.env.RUNTIME_BASE_PATH = directory
  for (const name of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${name}_DIR`] = path.join(directory, name.toLowerCase())
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    ;(await import('../src/database/init')).closeDatabase()
    await new Promise<void>(resolve => { void import('../src/utils/logger').then(({ logger }) => logger.close(resolve)) })
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const threadId = CodexChatStore.createThread(null, 'Old link', 'llm', null)
  const store = settings.getUserSettingsDb()
  const project = 'a'.repeat(32)
  // What an earlier version created: one row per chat (thread_id was the key), before the service ever opened the tables.
  store.exec(`
    CREATE TABLE workspace_projects (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, guidelines TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE workspace_bindings (thread_id INTEGER PRIMARY KEY REFERENCES codex_chat_threads(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES workspace_projects(id), revision TEXT NOT NULL, writable INTEGER NOT NULL);
  `)
  store.prepare("INSERT INTO workspace_projects(id,owner_key,name) VALUES(?,'bootstrap','Old project')").run(project)
  store.prepare("INSERT INTO workspace_bindings(thread_id,project_id,revision,writable) VALUES(?,?,'old-revision',1)").run(threadId, project)

  const { WorkspaceService: service } = await import('../src/services/workspaceService')
  const [kept] = service.own('bootstrap', threadId)
  assert.equal(kept.project.id, project)
  assert.equal(kept.write, true)
  assert.equal(kept.bindingRevision, 'old-revision')
  assert.equal(store.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_bindings_single'").get(), undefined, 'the old table is gone')

  const second = await service.create('bootstrap', 'New project')
  service.setChatProject('bootstrap', threadId, second.id, 'read')
  assert.deepEqual(service.effective('bootstrap', threadId).map(binding => binding.project.id), [project, second.id])
})
