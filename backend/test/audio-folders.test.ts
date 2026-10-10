import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

/**
 * Audio folders (그룹 in the UI) sort a project's effects one level deep, and an effect's text is split into a
 * person's description and the representative generation prompt; older databases are split once on open.
 */
test('audio folders and the description / prompt split', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-folders-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const audioDbModule = await import('../src/database/audioDb')
  audioDbModule.initializeAudioDb()
  const { ensureAudioSchema, splitAudioGroupText } = await import('../src/database/audioSchema')
  const service = await import('../src/services/audio/audioService')
  t.after(async () => {
    audioDbModule.closeAudioDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('old single-field text is split once', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE audio_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', created_by_account_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audio_groups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES audio_projects(id) ON DELETE CASCADE, name TEXT NOT NULL, label TEXT, description TEXT NOT NULL DEFAULT '', is_inbox INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO audio_projects VALUES ('p', '게임', '', NULL, 'x', 'x');
      INSERT INTO audio_groups VALUES ('inbox', 'p', '받은 파일', NULL, '', 1, 'x', 'x');
      INSERT INTO audio_groups VALUES ('english', 'p', '발자국', 'step_[00]', 'soft footstep on snow', 0, 'x', 'x');
      INSERT INTO audio_groups VALUES ('korean', 'p', '패널 인', 'panel_[00]', 'HUD 패널이 밀려 들어올 때', 0, 'x', 'x');
      INSERT INTO audio_groups VALUES ('empty', 'p', '문', 'door_[00]', '', 0, 'x', 'x');
    `)
    ensureAudioSchema(db)
    const order = db.prepare(`INSERT INTO audio_orders (id, request_scope, request_key, request_hash, group_id, workflow_id, text, seconds, count, base_seed, created_at) VALUES (?, 's', ?, 'h', ?, 1, ?, 3, 1, 1, ?)`)
    // Orders exist only after the first open here, so a second open must not re-split (the column already exists).
    order.run('o1', 'k1', 'korean', 'a quick swoosh', '2026-01-01')
    ensureAudioSchema(db)
    const rows = Object.fromEntries((db.prepare('SELECT id, description, prompt, folder_id FROM audio_groups').all() as Array<{ id: string; description: string; prompt: string; folder_id: string | null }>).map((row) => [row.id, row]))
    assert.deepEqual([rows.english.description, rows.english.prompt], ['', 'soft footstep on snow'])
    assert.deepEqual([rows.korean.description, rows.korean.prompt], ['HUD 패널이 밀려 들어올 때', ''])
    assert.deepEqual([rows.empty.description, rows.empty.prompt], ['', ''])
    assert.equal(rows.english.folder_id, null)
    db.close()

    const again = new Database(':memory:')
    again.exec(`
      CREATE TABLE audio_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by_account_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audio_groups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, label TEXT, description TEXT NOT NULL DEFAULT '', is_inbox INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audio_orders (id TEXT PRIMARY KEY, request_scope TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, group_id TEXT NOT NULL, workflow_id INTEGER NOT NULL, text TEXT NOT NULL, seconds REAL NOT NULL, count INTEGER NOT NULL, base_seed INTEGER NOT NULL, server_id INTEGER, server_tag TEXT, created_by_account_id INTEGER, created_by_account_type TEXT, created_at TEXT NOT NULL);
      INSERT INTO audio_groups VALUES ('korean', 'p', '패널 인', 'panel_[00]', 'HUD 패널', 0, 'x', 'x');
      INSERT INTO audio_orders (id, request_scope, request_key, request_hash, group_id, workflow_id, text, seconds, count, base_seed, created_at) VALUES ('o1', 's', 'k1', 'h', 'korean', 1, 'old swoosh', 3, 1, 1, '2026-01-01'), ('o2', 's', 'k2', 'h', 'korean', 1, ' new swoosh ', 3, 1, 1, '2026-01-02');
    `)
    ensureAudioSchema(again)
    assert.deepEqual(again.prepare('SELECT description, prompt FROM audio_groups').get(), { description: 'HUD 패널', prompt: 'new swoosh' })
    again.close()

    assert.deepEqual(splitAudioGroupText(null), { description: '', prompt: '' })
    assert.deepEqual(splitAudioGroupText(' door slam '), { description: '', prompt: 'door slam' })
  })

  await t.test('folders sort effects and release them on delete', () => {
    const project = service.createAudioProject({ name: '동방마법진' }, null)
    const other = service.createAudioProject({ name: '다른 게임' }, null)
    const ui = service.createAudioFolder(project.id, { name: 'UI' })
    const bgm = service.createAudioFolder(project.id, { name: 'BGM' })
    assert.throws(() => service.createAudioFolder(project.id, { name: 'ui' }), /같은 이름의 그룹/)
    assert.deepEqual(service.listAudioFolders(project.id).map((folder) => folder.name), ['BGM', 'UI'])

    const panel = service.createAudioGroup(project.id, { name: '패널 인', label: 'panel_[00]', description: 'HUD 패널이 밀려 들어올 때', prompt: 'a quick swoosh', folder_id: ui.id })
    assert.equal(panel.folder_id, ui.id)
    assert.equal(panel.description, 'HUD 패널이 밀려 들어올 때')
    assert.equal(panel.prompt, 'a quick swoosh')
    assert.equal(service.listAudioGroups(project.id, { search: '밀려' }).length, 1)

    const moved = service.updateAudioGroup(panel.id, { folder_id: bgm.id, prompt: 'a slower swoosh' })
    assert.equal(moved.folder_id, bgm.id)
    assert.equal(moved.prompt, 'a slower swoosh')
    assert.equal(moved.description, 'HUD 패널이 밀려 들어올 때')
    assert.equal(service.updateAudioGroup(panel.id, { folder_id: null }).folder_id, null)
    service.updateAudioGroup(panel.id, { folder_id: ui.id })

    const foreign = service.createAudioFolder(other.id, { name: 'UI' })
    assert.throws(() => service.updateAudioGroup(panel.id, { folder_id: foreign.id }), /다른 프로젝트/)
    assert.throws(() => service.updateAudioGroup(service.getAudioInboxGroup(project.id).id, { folder_id: ui.id }), /받은 파일/)

    assert.equal(service.getAudioFolder(ui.id).group_count, 1)
    assert.equal(service.updateAudioFolder(ui.id, { name: 'HUD' }).name, 'HUD')
    assert.deepEqual(service.deleteAudioFolder(ui.id), { deleted: true, released_groups: 1 })
    assert.equal(service.getAudioGroup(panel.id).folder_id, null)
    assert.throws(() => service.getAudioFolder(ui.id), /그룹을 찾을 수 없어/)
  })
})
