import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'

/**
 * Importing the old standalone SFX manager (sfx.sqlite3 + audio/) into audio.db: mapping, parent remap, provenance,
 * dedupe, idempotent re-runs, dry run, the read-only source, zip uploads (zip-slip refused), legacy workflow
 * registration and admin-only routes.
 */

// The original app's schema (stable-audio-sfx-manager/backend/sfx/db.py, after all its migrations).
const LEGACY_DDL = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires REAL NOT NULL);
CREATE TABLE tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE groups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, label TEXT NOT NULL COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(project_id,label));
CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, prompt TEXT NOT NULL, mapping TEXT NOT NULL, ui_workflow TEXT, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(name,version));
CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'unknown', detail TEXT NOT NULL DEFAULT '', last_seen TEXT);
CREATE TABLE queues (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, paused INTEGER NOT NULL DEFAULT 0, last_dispatched REAL NOT NULL DEFAULT 0);
CREATE TABLE orders (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, request_body TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), group_id TEXT NOT NULL REFERENCES groups(id), queue_id TEXT NOT NULL REFERENCES queues(id), workflow_id TEXT NOT NULL REFERENCES workflows(id), server_id TEXT REFERENCES servers(id), prompt TEXT NOT NULL, text TEXT NOT NULL, seconds REAL NOT NULL, seed INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', prompt_id TEXT, error TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE candidates (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), group_id TEXT NOT NULL REFERENCES groups(id), parent_id TEXT REFERENCES candidates(id), name TEXT NOT NULL, file TEXT NOT NULL UNIQUE, source_key TEXT UNIQUE, duration REAL NOT NULL, sample_rate INTEGER NOT NULL, channels INTEGER NOT NULL, review TEXT NOT NULL DEFAULT 'pending', notes TEXT NOT NULL DEFAULT '', edit TEXT, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE group_comments (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), text TEXT NOT NULL, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), status TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1, completed_at TEXT, completion_note TEXT NOT NULL DEFAULT '');
`

const LEGACY_GRAPH = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'stable_audio_3_medium_base.safetensors' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '5': { class_type: 'EmptyLatentAudio', inputs: { seconds: 3.0, batch_size: 4 } },
  '8': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['7', 0], filename_prefix: 'audio/sfx_manager/x', format: 'flac' } },
  '9': { class_type: 'Seed (rgthree)', inputs: { seed: -1 } },
}
const LEGACY_MAPPING = { text: ['3', 'text'], seconds: ['5', 'seconds'], seed: ['9', 'seed'], batch_size: ['5', 'batch_size'], filename_prefix: ['8', 'filename_prefix'] }

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(dir)
  return out
}

test('audio legacy import: old SFX manager data into audio.db', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-legacy-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const audioDbModule = await import('../src/database/audioDb')
  const audioDb = audioDbModule.initializeAudioDb()
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    audioDbModule.closeAudioDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-audio-legacy-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const service = await import('../src/services/audio/audioService')
  const legacyImport = await import('../src/services/audio/audioLegacyImport')
  const { registerAudioLegacyImportJobHandlers } = await import('../src/services/audio/audioLegacyImportJob')
  registerAudioLegacyImportJobHandlers()
  const { WorkflowModel } = await import('../src/models/Workflow')

  // ---- a legacy data dir: sfx.sqlite3 + audio/
  const ffmpeg = createRequire(__filename)('ffmpeg-static') as string
  const legacyDir = path.join(root, 'legacy', 'data')
  fs.mkdirSync(path.join(legacyDir, 'audio'), { recursive: true })
  const tone = (name: string, frequency: number, ext = name) => {
    const target = path.join(legacyDir, 'audio', ext)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.3`, '-ac', '1', '-ar', '22050', target])
    return target
  }
  tone('c1.flac', 440)
  fs.copyFileSync(path.join(legacyDir, 'audio', 'c1.flac'), path.join(legacyDir, 'audio', 'c2.flac')) // same bytes → one blob
  tone('c3.wav', 520)
  tone('c5.wav', 600)
  tone('c7.wav', 700)
  const legacy = new Database(path.join(legacyDir, 'sfx.sqlite3'))
  legacy.pragma('journal_mode = WAL')
  legacy.pragma('foreign_keys = OFF') // the edit row is inserted before its parent
  legacy.exec(LEGACY_DDL)
  legacy.exec(`
    INSERT INTO settings VALUES ('export_options', '{"format":"wav","quality":3,"normalize":false,"target_lufs":-16,"peak_db":-1.5,"loudness_range":7,"sample_rate":0,"channels":0}');
    INSERT INTO settings VALUES ('password', 'salt:hash');
    INSERT INTO projects (id, name, description, created) VALUES ('p1', '레거시 게임', '던전 효과음', '2026-01-01T00:00:00.000Z'), ('p2', '게임 A', '', '2026-01-02T00:00:00.000Z');
    INSERT INTO groups (id, project_id, name, label, description, created) VALUES
      ('g1', 'p1', '발자국 · 눈', 'footstep_snow_[00]', 'soft footstep', '2026-01-01T00:00:01.000Z'),
      ('g2', 'p1', 'UI', 'ui_[00]', '', '2026-01-01T00:00:02.000Z'),
      ('g3', 'p2', '나쁜 라벨', 'bad/label', '', '2026-01-01T00:00:03.000Z'),
      ('g4', 'p2', '문', 'door_[00]', '', '2026-01-01T00:00:04.000Z');
    INSERT INTO servers VALUES ('s1', 'GPU-1', 'http://192.168.0.2:8188', 1, 'idle', '', NULL);
    INSERT INTO queues VALUES ('q1', '기본 대기열', 0, 0);
    INSERT INTO orders VALUES ('o1', 'key-1', '{}');
  `)
  legacy.prepare(`INSERT INTO workflows (id, name, version, prompt, mapping) VALUES ('w1', 'Stable Audio 3', 2, ?, ?)`).run(JSON.stringify(LEGACY_GRAPH), JSON.stringify(LEGACY_MAPPING))
  legacy.prepare(`INSERT INTO jobs (id, order_id, group_id, queue_id, workflow_id, server_id, prompt, text, seconds, seed, status) VALUES ('j1', 'o1', 'g1', 'q1', 'w1', 's1', ?, 'soft snow step', 3, 100, 'completed')`)
    .run(JSON.stringify({ ...LEGACY_GRAPH, '9': { class_type: 'Seed (rgthree)', inputs: { seed: 100 } } }))
  const candidate = legacy.prepare(`INSERT INTO candidates (id, job_id, group_id, parent_id, name, file, duration, sample_rate, channels, review, notes, edit, created, deleted) VALUES (?, 'j1', ?, ?, ?, ?, 0.3, 22050, 1, ?, ?, ?, ?, ?)`)
  // The edit (c3) is older than its parent on purpose: parents must still be imported first.
  candidate.run('c3', 'g1', 'c1', '발자국 · 눈 · 100 · 편집', 'c3.wav', 'pending', '', '{"start":0,"end":0.2,"gain_db":2}', '2025-12-31T00:00:00.000Z', 0)
  candidate.run('c1', 'g1', null, '발자국 · 눈 · 100', 'c1.flac', 'selected', '좋아', null, '2026-01-01T00:01:00.000Z', 0)
  candidate.run('c2', 'g1', null, '발자국 · 눈 · 101', 'c2.flac', 'rejected', '', null, '2026-01-01T00:02:00.000Z', 0)
  candidate.run('c4', 'g1', null, '지운 후보', 'gone.flac', 'pending', '', null, '2026-01-01T00:03:00.000Z', 1)
  candidate.run('c5', 'g2', null, 'UI 클릭', 'c5.wav', 'pending', '', null, '2026-01-01T00:04:00.000Z', 1)
  candidate.run('c6', 'g2', null, '파일 없음', 'missing.wav', 'pending', '', null, '2026-01-01T00:05:00.000Z', 0)
  candidate.run('c7', 'g3', null, '라벨 문제', 'c7.wav', 'pending', '', null, '2026-01-01T00:06:00.000Z', 0)
  legacy.exec(`
    INSERT INTO group_comments (id, group_id, text, status, revision, completed_at, completion_note, created, updated) VALUES
      ('m1', 'g1', '더 무겁게', 'completed', 2, '2026-01-03T00:00:00.000Z', '4개 더 만듦', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      ('m2', 'g2', '클릭 짧게', 'pending', 1, NULL, '', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `)
  legacy.close()
  // Leave only the WAL-free main file, as on a stopped instance, and snapshot the source to prove it stays untouched.
  const sourceBefore = hashTree(legacyDir)

  // A project that already exists here by the same name is merged into, not duplicated.
  const existing = service.createAudioProject({ name: '게임 A' }, null)

  const counts = () => ({
    projects: (audioDb.prepare('SELECT count(*) AS n FROM audio_projects').get() as { n: number }).n,
    groups: (audioDb.prepare('SELECT count(*) AS n FROM audio_groups').get() as { n: number }).n,
    candidates: (audioDb.prepare('SELECT count(*) AS n FROM audio_candidates').get() as { n: number }).n,
    files: (audioDb.prepare('SELECT count(*) AS n FROM audio_files').get() as { n: number }).n,
    comments: (audioDb.prepare('SELECT count(*) AS n FROM audio_group_comments').get() as { n: number }).n,
    map: (audioDb.prepare('SELECT count(*) AS n FROM audio_legacy_import_map').get() as { n: number }).n,
    legacyWorkflows: (audioDb.prepare('SELECT count(*) AS n FROM audio_legacy_workflows').get() as { n: number }).n,
  })

  await t.test('dry run counts everything and writes nothing', async () => {
    const before = counts()
    const result = await legacyImport.runLegacyAudioImport({ source: { path: legacyDir }, dryRun: true, accountId: null })
    assert.deepEqual(counts(), before)
    assert.equal(result.dry_run, true)
    assert.deepEqual(result.projects, { total: 2, created: 1, existing: 1 })
    assert.equal(result.groups.total, 4)
    assert.equal(result.candidates.total, 7)
    assert.equal(result.candidates.deleted_without_file, 1)
    assert.equal(result.candidates.missing_file, 1)
    assert.equal(result.comments.total, 2)
    assert.deepEqual(result.workflows.map((workflow) => [workflow.name, workflow.version, workflow.registered_workflow_id]), [['Stable Audio 3', 2, null]])
    assert.equal(result.export_options, 'imported')
    const store = path.join(root, 'uploads', 'audio')
    assert.deepEqual(fs.existsSync(store) ? Object.keys(hashTree(store)) : [], [], 'no audio file is copied')
  })

  // ---- routes
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-legacy', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const editorGroup = AuthPermissionGroup.createCustomGroup({ name: 'audio-editor', permissionKeys: ['audio.view', 'audio.edit', 'workflows.edit'] })
  const editorId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('editor', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(editorGroup.id, editorId)
  invalidateConfiguredAuthCache()

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = `test-${id ?? 'anonymous'}`
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id === adminId ? 'admin' : id ? 'guest' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, accountId?: number, init: RequestInit = {}) => {
    const response = await fetch(origin + url, { ...init, headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })
    const buffer = Buffer.from(await response.arrayBuffer())
    return { status: response.status, buffer, json: () => JSON.parse(buffer.toString('utf8')) }
  }
  const runJob = async (body: Record<string, unknown>) => {
    const started = await call('/api/audio/legacy-import', adminId, { method: 'POST', body: JSON.stringify(body) })
    assert.equal(started.status, 202, started.buffer.toString())
    const jobId = started.json().data.jobId as string
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const job = (await call(`/api/jobs/${jobId}`, adminId)).json().data
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('legacy import job did not finish')
  }

  await t.test('admin only: accounts without admin are refused even with audio.edit', async () => {
    assert.equal((await call('/api/audio/legacy-import', undefined, { method: 'POST', body: JSON.stringify({ path: legacyDir }) })).status, 401)
    assert.equal((await call('/api/audio/legacy-import', editorId, { method: 'POST', body: JSON.stringify({ path: legacyDir }) })).status, 403)
    assert.equal((await call('/api/audio/legacy-import/workflows', editorId)).status, 403)
    assert.equal((await call('/api/audio/legacy-import/workflows/register', editorId, { method: 'POST', body: JSON.stringify({ legacy_workflow_id: 'w1' }) })).status, 403)
    const form = new FormData()
    form.append('archive', new Blob([Buffer.from('zip')]), 'data.zip')
    assert.equal((await call('/api/audio/legacy-import/uploads', editorId, { method: 'POST', body: form })).status, 403)
  })

  await t.test('path validation', async () => {
    assert.equal((await call('/api/audio/legacy-import', adminId, { method: 'POST', body: JSON.stringify({ path: 'relative/dir' }) })).status, 400)
    assert.equal((await call('/api/audio/legacy-import', adminId, { method: 'POST', body: JSON.stringify({ path: path.join(root, 'nope') }) })).status, 404)
    const empty = fs.mkdtempSync(path.join(root, 'empty-'))
    assert.equal((await call('/api/audio/legacy-import', adminId, { method: 'POST', body: JSON.stringify({ path: empty }) })).status, 400)
  })

  let firstResult: legacyImportResult
  type legacyImportResult = Awaited<ReturnType<typeof legacyImport.runLegacyAudioImport>>

  await t.test('import maps projects, groups, candidates, comments and settings', async () => {
    const job = await runJob({ path: path.dirname(legacyDir), dryRun: false })
    assert.equal(job.status, 'completed', JSON.stringify(job))
    const result = job.result as legacyImportResult
    firstResult = result
    assert.equal(result.dry_run, false)
    assert.deepEqual(result.projects, { total: 2, created: 1, existing: 1 })
    assert.deepEqual(result.groups, { total: 4, created: 3, existing: 0, failed: 1 })
    assert.deepEqual(result.candidates, { total: 7, imported: 4, already_imported: 0, soft_deleted: 1, missing_file: 1, deleted_without_file: 1, failed: 1 })
    assert.deepEqual({ new: result.files.new, reused: result.files.reused }, { new: 3, reused: 1 })
    assert.deepEqual(result.comments, { total: 2, imported: 2, already_imported: 0 })
    assert.equal(result.export_options, 'imported')
    assert.ok(result.warnings.some((warning) => warning.includes('bad/label')))

    const project = service.listAudioProjects().find((entry) => entry.name === '레거시 게임')!
    assert.equal(project.description, '던전 효과음')
    assert.ok(project.inbox_group_id, 'an imported project gets its inbox')
    const groups = service.listAudioGroups(project.id)
    const snow = groups.find((group) => group.label === 'footstep_snow_[00]')!
    assert.equal(snow.name, '발자국 · 눈')
    assert.ok(service.listAudioGroups(existing.id).some((group) => group.label === 'door_[00]'), 'groups of a merged project land in the existing one')

    const rows = audioDb.prepare('SELECT * FROM audio_candidates WHERE source_key LIKE ? ORDER BY source_key').all('legacy:%') as Array<Record<string, string | null>>
    const byKey = Object.fromEntries(rows.map((row) => [row.source_key, row]))
    const c1 = byKey['legacy:c1']!
    assert.equal(c1.review, 'selected')
    assert.equal(c1.notes, '좋아')
    assert.equal(c1.origin, 'generated')
    assert.equal(c1.created_at, '2026-01-01T00:01:00.000Z')
    const provenance = JSON.parse(c1.provenance_json!)
    assert.deepEqual([provenance.prompt, provenance.seconds, provenance.seed, provenance.workflow_name, provenance.workflow_version, provenance.server_name],
      ['soft snow step', 3, 100, 'Stable Audio 3', 2, 'GPU-1'])
    assert.equal(provenance.legacy.candidate_id, 'c1')
    assert.equal(provenance.legacy.prompt_snapshot['9'].inputs.seed, 100)
    const c3 = byKey['legacy:c3']!
    assert.equal(c3.parent_id, c1.id, 'the edit points at the new id of its parent')
    assert.equal(c3.origin, 'edited')
    assert.deepEqual(JSON.parse(c3.edit_json!), { start: 0, end: 0.2, gain_db: 2 })
    assert.equal(byKey['legacy:c2']!.file_hash, c1.file_hash, 'identical bytes share one blob')
    assert.ok(byKey['legacy:c5']!.deleted_at, 'a tombstoned candidate with its file comes back soft-deleted')
    assert.equal(byKey['legacy:c4'], undefined)
    assert.equal(byKey['legacy:c6'], undefined)

    const comments = service.listAudioGroupComments(snow.id)
    assert.equal(comments.length, 1)
    assert.deepEqual([comments[0].text, comments[0].status, comments[0].revision, comments[0].completion_note], ['더 무겁게', 'completed', 2, '4개 더 만듦'])
    assert.equal(JSON.parse((audioDb.prepare("SELECT value FROM audio_settings WHERE key = 'export_options'").get() as { value: string }).value).format, 'wav')
  })

  await t.test('the source folder is never modified', () => {
    assert.deepEqual(hashTree(legacyDir), sourceBefore)
  })

  await t.test('running again adds nothing', async () => {
    const before = counts()
    const job = await runJob({ path: legacyDir, dryRun: false })
    assert.equal(job.status, 'completed')
    const result = job.result as legacyImportResult
    assert.deepEqual(counts(), before)
    assert.deepEqual(result.projects, { total: 2, created: 0, existing: 2 })
    assert.equal(result.groups.existing, 3)
    assert.equal(result.candidates.already_imported, firstResult.candidates.imported)
    assert.equal(result.candidates.imported, 0)
    assert.equal(result.comments.already_imported, 2)
    assert.equal(result.export_options, 'kept')
  })

  await t.test('a renamed project is still recognised by its old id', async () => {
    const project = service.listAudioProjects().find((entry) => entry.name === '레거시 게임')!
    service.updateAudioProject(project.id, { name: '레거시 게임 (이전)' })
    const result = await legacyImport.runLegacyAudioImport({ source: { path: legacyDir }, dryRun: false, accountId: null })
    assert.equal(result.projects.created, 0)
    assert.equal(service.listAudioProjects().filter((entry) => entry.name.startsWith('레거시 게임')).length, 1)
  })

  await t.test('legacy workflows register on the generation side as audio workflows, once', async () => {
    const listed = (await call('/api/audio/legacy-import/workflows', adminId)).json().data as Array<{ legacy_id: string; registered_workflow_id: number | null }>
    assert.deepEqual(listed.map((entry) => [entry.legacy_id, entry.registered_workflow_id]), [['w1', null]])
    const registered = await call('/api/audio/legacy-import/workflows/register', adminId, { method: 'POST', body: JSON.stringify({ legacy_workflow_id: 'w1' }) })
    assert.equal(registered.status, 201, registered.buffer.toString())
    const summary = registered.json().data as { id: number; binding: { prompt_field_id: string; seconds_field_id: string; seed_field_id: string } | null }
    const workflow = WorkflowModel.findById(summary.id)!
    assert.equal(workflow.kind, 'audio')
    assert.equal(workflow.name, 'Stable Audio 3 v2')
    const graph = JSON.parse(workflow.workflow_json)
    assert.equal(graph['5'].inputs.batch_size, 1, 'one job = one candidate')
    const fields = JSON.parse(workflow.marked_fields!) as Array<{ id: string; jsonPath: string }>
    assert.deepEqual(fields.map((field) => [field.id, field.jsonPath]), [['prompt', '3.inputs.text'], ['seconds', '5.inputs.seconds'], ['seed', '9.inputs.seed']])
    assert.ok(summary.binding)
    const again = await call('/api/audio/legacy-import/workflows/register', adminId, { method: 'POST', body: JSON.stringify({ legacy_workflow_id: 'w1' }) })
    assert.equal(again.json().data.id, summary.id)
    assert.equal((await call('/api/audio/legacy-import/workflows', adminId)).json().data[0].registered_workflow_id, summary.id)
  })

  await t.test('zip upload: import from an uploaded archive', async () => {
    const zip = new AdmZip()
    zip.addLocalFolder(legacyDir, 'data')
    const form = new FormData()
    form.append('archive', new Blob([zip.toBuffer()]), 'sfx-data.zip')
    const uploaded = await call('/api/audio/legacy-import/uploads', adminId, { method: 'POST', body: form })
    assert.equal(uploaded.status, 201, uploaded.buffer.toString())
    const uploadId = uploaded.json().data.upload_id as string
    const dry = await runJob({ upload_id: uploadId, dryRun: true })
    assert.equal(dry.status, 'completed', JSON.stringify(dry))
    assert.equal((dry.result as legacyImportResult).candidates.already_imported, firstResult.candidates.imported)
    const real = await runJob({ upload_id: uploadId, dryRun: false })
    assert.equal(real.status, 'completed')
    assert.equal(fs.existsSync(path.join(legacyImport.LEGACY_UPLOAD_DIR(), `${uploadId}.zip`)), false, 'a finished import removes its upload')
    const notZip = new FormData()
    notZip.append('archive', new Blob([Buffer.from('x')]), 'data.tar')
    assert.equal((await call('/api/audio/legacy-import/uploads', adminId, { method: 'POST', body: notZip })).status, 415)
  })

  await t.test('zip-slip entries refuse the whole archive', async () => {
    assert.equal(legacyImport.isUnsafeZipEntry(root, '../evil.txt'), true)
    assert.equal(legacyImport.isUnsafeZipEntry(root, 'data/../../evil.txt'), true)
    assert.equal(legacyImport.isUnsafeZipEntry(root, '/etc/passwd'), true)
    assert.equal(legacyImport.isUnsafeZipEntry(root, 'C:/Windows/evil'), true)
    assert.equal(legacyImport.isUnsafeZipEntry(root, '..\\evil.txt'), true)
    assert.equal(legacyImport.isUnsafeZipEntry(root, 'data/audio/c1.flac'), false)

    const zip = new AdmZip()
    zip.addFile('data/sfx.sqlite3', fs.readFileSync(path.join(legacyDir, 'sfx.sqlite3')))
    zip.addFile('placeholder.txt', Buffer.from('evil'))
    // adm-zip normalises names on add; write the hostile name into the entry header afterwards.
    zip.getEntry('placeholder.txt')!.entryName = '../evil.txt'
    const archive = path.join(root, 'slip.zip')
    fs.writeFileSync(archive, zip.toBuffer())
    const reread = new AdmZip(archive).getEntries().map((entry) => entry.entryName)
    assert.ok(reread.includes('../evil.txt'), `the crafted archive keeps its hostile name (${reread.join(', ')})`)
    const target = path.join(root, 'slip-out', 'x')
    await assert.rejects(legacyImport.extractLegacyZip(archive, target), /폴더 밖/)
    assert.equal(fs.existsSync(path.join(root, 'slip-out', 'evil.txt')), false)
    assert.equal(fs.existsSync(target), false, 'nothing is written when any entry is unsafe')

    const form = new FormData()
    form.append('archive', new Blob([fs.readFileSync(archive)]), 'slip.zip')
    const uploadId = (await call('/api/audio/legacy-import/uploads', adminId, { method: 'POST', body: form })).json().data.upload_id as string
    const job = await runJob({ upload_id: uploadId, dryRun: true })
    assert.equal(job.status, 'failed')
    assert.match(String(job.failureMessage ?? ''), /폴더 밖/)
  })
})
