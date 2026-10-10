import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Audio workspace, phase 1: audio.db, the content-hash store, its lifecycle (soft delete, retention purge to the
 * RecycleBin, restore re-attach, orphan sweep, verification, backup), the /api/audio permissions and the MCP tools.
 */
test('audio workspace: store, lifecycle, routes and MCP tools', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-store-'))
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
    assert.ok(path.basename(root).startsWith('conai-audio-store-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { ensureAudioSchema } = await import('../src/database/audioSchema')
  const service = await import('../src/services/audio/audioService')
  const store = await import('../src/services/audio/audioStore')
  const maintenance = await import('../src/services/audio/audioMaintenance')
  const { validateAudioLabel, audioExportFileName, AudioLabelError } = await import('../src/services/audio/audioNaming')
  const { RECYCLE_BIN_PATH, readRecycleBinOrigins } = await import('../src/utils/recycleBin')

  // Small real audio files made with the bundled ffmpeg.
  const ffmpeg = createRequire(__filename)('ffmpeg-static') as string
  const fixtures = path.join(root, 'fixtures')
  fs.mkdirSync(fixtures, { recursive: true })
  const tone = (name: string, frequency: number) => {
    const target = path.join(fixtures, name)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.4`, '-ac', '1', '-ar', '22050', target])
    return target
  }
  const toneA = tone('a.wav', 440)
  const toneB = tone('b.wav', 660)
  const toneC = tone('c.flac', 880)
  const notAudio = path.join(fixtures, 'fake.wav')
  fs.writeFileSync(notAudio, 'this is not audio at all')
  const staged = (source: string) => {
    const copy = path.join(fixtures, `staged-${Math.random().toString(36).slice(2)}${path.extname(source)}`)
    fs.copyFileSync(source, copy)
    return copy
  }
  const storeFiles = () => {
    const found: string[] = []
    const walk = (dir: string) => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else found.push(full) } }
    walk(store.AUDIO_STORE_DIR)
    return found
  }
  const binNames = () => fs.existsSync(RECYCLE_BIN_PATH) ? fs.readdirSync(RECYCLE_BIN_PATH).filter((name) => fs.statSync(path.join(RECYCLE_BIN_PATH, name)).isFile()) : []

  await t.test('schema is idempotent and lives in its own audio.db', () => {
    ensureAudioSchema(audioDb)
    ensureAudioSchema(audioDb)
    const tables = (audioDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
    for (const table of ['audio_projects', 'audio_groups', 'audio_files', 'audio_candidates', 'audio_group_comments', 'audio_settings', 'audio_purged_files']) {
      assert.ok(tables.includes(table), table)
    }
    assert.equal(path.basename(audioDb.name), 'audio.db')
    assert.equal(audioDb.pragma('foreign_keys', { simple: true }), 1)
  })

  await t.test('label rules match the original naming.py vectors', () => {
    const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'audio-naming-vectors.json'), 'utf8')) as {
      filenames: Array<{ label: string; index: number; count: number; format: string; filename: string }>
      labels: Array<{ label: string; valid: string | null; error: string | null }>
    }
    for (const vector of vectors.filenames) {
      assert.equal(audioExportFileName(vector.label, vector.index, vector.count, vector.format), vector.filename, JSON.stringify(vector))
    }
    for (const vector of vectors.labels) {
      if (vector.error === null) {
        assert.equal(validateAudioLabel(vector.label), vector.valid, vector.label)
      } else {
        assert.throws(() => validateAudioLabel(vector.label), (error: unknown) => error instanceof AudioLabelError && error.message === vector.error, vector.label)
      }
    }
  })

  const project = service.createAudioProject({ name: '게임 A', description: '던전' }, null)
  const other = service.createAudioProject({ name: '게임 B' }, null)

  await t.test('a project has exactly one inbox that cannot be deleted or labelled', async () => {
    assert.ok(project.inbox_group_id)
    const groups = service.listAudioGroups(project.id)
    assert.deepEqual(groups.map((group) => [group.name, group.is_inbox, group.label]), [[service.AUDIO_INBOX_GROUP_NAME, true, null]])
    await assert.rejects(service.deleteAudioGroup(project.inbox_group_id!), /지울 수 없어/)
    assert.throws(() => service.updateAudioGroup(project.inbox_group_id!, { label: 'x_[00]' }), /파일명을 붙일 수 없어/)
    assert.throws(() => audioDb.prepare("INSERT INTO audio_groups (id, project_id, name, label, is_inbox, created_at, updated_at) VALUES ('x', ?, 'second', NULL, 1, 'a', 'a')").run(project.id), /UNIQUE/)
    assert.throws(() => service.createAudioProject({ name: '게임 a' }, null), /이미 있어/)
  })

  const snow = service.createAudioGroup(project.id, { name: '발자국 · 눈', label: 'footstep_snow_[00]', description: 'soft footstep on snow' })
  const stone = service.createAudioGroup(project.id, { name: '발자국 · 돌', label: 'footstep_stone_[00]' })
  const otherGroup = service.createAudioGroup(other.id, { name: 'UI', label: 'ui_click_[00]' })

  await t.test('group labels are validated and unique per project, case-insensitively', () => {
    assert.throws(() => service.createAudioGroup(project.id, { name: 'bad', label: 'bad.wav' }), AudioLabelError)
    assert.throws(() => service.createAudioGroup(project.id, { name: 'dup', label: 'FOOTSTEP_SNOW_[00]' }), /이미 있어/)
    assert.ok(service.createAudioGroup(other.id, { name: 'same label elsewhere', label: 'footstep_snow_[00]' }))
  })

  let first!: Awaited<ReturnType<typeof service.importAudioUpload>>
  let second!: Awaited<ReturnType<typeof service.importAudioUpload>>
  await t.test('ingest stores each content once and rejects files without audio', async () => {
    first = await service.importAudioUpload({ groupId: snow.id }, staged(toneA), 'step one.wav', null)
    second = await service.importAudioUpload({ groupId: snow.id }, staged(toneA), 'step one again.wav', null)
    assert.equal(first.file_hash, second.file_hash)
    assert.notEqual(first.id, second.id)
    assert.equal(storeFiles().length, 1)
    assert.equal(first.origin, 'uploaded')
    assert.equal(first.name, 'step one')
    assert.equal(first.file.channels, 1)
    assert.equal(first.file.sample_rate, 22050)
    assert.ok(first.file.duration! > 0.3 && first.file.duration! < 0.5)
    assert.equal(storeFiles()[0], store.audioBlobPath(first.file_hash, 'wav'))

    const fake = staged(notAudio)
    await assert.rejects(service.importAudioUpload({ groupId: snow.id }, fake, 'fake.wav', null), store.AudioStoreError)
    assert.equal(fs.existsSync(fake), false, 'a rejected staged file is removed')
    const text = staged(notAudio)
    await assert.rejects(service.importAudioUpload({ groupId: snow.id }, text, 'notes.txt', null), /지원하지 않는/)
    assert.equal(storeFiles().length, 1)

    const inboxed = await service.importAudioUpload({ projectId: project.id }, staged(toneC), 'flac take.flac', null)
    assert.equal(inboxed.group_id, project.inbox_group_id)
    assert.equal(inboxed.file.ext, 'flac')
    assert.equal(store.isAudioStorePath(storeFiles()[0]), true)
  })

  await t.test('candidates move only inside their project', () => {
    assert.throws(() => service.moveAudioCandidates([first.id], otherGroup.id), /다른 프로젝트/)
    assert.deepEqual(service.moveAudioCandidates([first.id], stone.id), { moved: 1, group_id: stone.id })
    assert.equal(service.getAudioCandidate(first.id).group_id, stone.id)
    service.moveAudioCandidates([first.id], snow.id)
  })

  await t.test('soft delete hides a candidate until it is restored', () => {
    assert.deepEqual(service.deleteAudioCandidates([second.id]), { deleted: 1 })
    assert.deepEqual(service.listAudioCandidates(snow.id).items.map((item) => item.id), [first.id])
    assert.deepEqual(service.listAudioCandidates(snow.id, { deleted: 'only' }).items.map((item) => item.id), [second.id])
    assert.deepEqual(service.restoreAudioCandidates([second.id]), { restored: 1 })
    assert.equal(service.listAudioCandidates(snow.id).total, 2)
  })

  await t.test('comments use the original optimistic revision lock', () => {
    const comment = service.createAudioGroupComment(snow.id, { text: '좀 더 묵직하게' }, null)
    assert.equal(comment.revision, 1)
    assert.throws(() => service.setAudioGroupCommentStatus(snow.id, comment.id, { status: 'completed', expected_revision: 2 }), /변경됐습니다/)
    const done = service.setAudioGroupCommentStatus(snow.id, comment.id, { status: 'completed', expected_revision: 1, completion_note: '4개 추가' })
    assert.equal(done.status, 'completed')
    assert.equal(done.revision, 2)
    assert.equal(done.completion_note, '4개 추가')
    const edited = service.updateAudioGroupComment(snow.id, comment.id, { text: '조금 더 짧게' })
    assert.equal(edited.status, 'pending')
    assert.equal(edited.revision, 3)
    assert.equal(service.listAudioGroups(project.id, { filter: 'pending_comments' }).map((group) => group.id).join(), snow.id)
    assert.throws(() => service.updateAudioGroupComment(stone.id, comment.id, { text: 'x' }), /이 그룹의 코멘트가 아니야/)
  })

  await t.test('retention purge keeps shared blobs, recycles unused ones, and a RecycleBin restore brings them back', async () => {
    // Two candidates share toneA: purging one keeps the file.
    service.deleteAudioCandidates([second.id])
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    assert.equal((await maintenance.purgeAudioTombstones({ retentionDays: 0, now: future })).purgedCandidates, 0, 'retention off purges nothing')
    let purge = await maintenance.purgeAudioTombstones({ retentionDays: 1, now: future })
    assert.equal(purge.purgedCandidates, 1)
    assert.equal(purge.released, 0)
    assert.ok(fs.existsSync(store.audioBlobPath(first.file_hash, 'wav')))

    // A candidate alone on its blob: purge moves the file to the RecycleBin with an `audio` origin.
    const lone = await service.importAudioUpload({ groupId: stone.id }, staged(toneB), 'lone.wav', null)
    service.setAudioCandidateReview(lone.id, { review: 'selected', notes: 'keep' })
    service.deleteAudioCandidates([lone.id])
    const before = new Set(binNames())
    purge = await maintenance.purgeAudioTombstones({ retentionDays: 1, now: future })
    assert.equal(purge.purgedCandidates, 1)
    assert.equal(purge.recycled, 1)
    assert.equal(store.getAudioFile(lone.file_hash), null)
    assert.equal(fs.existsSync(store.audioBlobPath(lone.file_hash, 'wav')), false)
    const binName = binNames().find((name) => !before.has(name))!
    assert.ok(binName)
    assert.equal(readRecycleBinOrigins([binName]).get(binName)?.source, 'audio')

    const { SystemFolderService } = await import('../src/services/systemFolderService')
    const restored = await SystemFolderService.restore([binName], 'fail')
    assert.equal(restored.failed.length, 0, JSON.stringify(restored.failed))
    const back = service.getAudioCandidate(lone.id)
    assert.equal(back.deleted_at, null)
    assert.equal(back.review, 'selected')
    assert.equal(back.notes, 'keep')
    assert.equal(back.group_id, stone.id)
    assert.ok(store.getAudioFile(lone.file_hash))
    assert.equal(audioDb.prepare('SELECT count(*) AS n FROM audio_purged_files').get().n, 0)
  })

  await t.test('deleting a group releases its unused blobs; a restore lands in the project inbox', async () => {
    const temp = service.createAudioGroup(project.id, { name: 'temp', label: 'temp_[00]' })
    const only = await service.importAudioUpload({ groupId: temp.id }, staged(toneB), 'temp take.wav', null)
    // toneB is also used by `lone` in another group: deleting this group must keep the file.
    assert.equal((await service.deleteAudioGroup(temp.id)).released, 0)
    assert.ok(store.getAudioFile(only.file_hash))
    service.deleteAudioCandidates([service.listAudioCandidates(stone.id).items.find((item) => item.file_hash === only.file_hash)!.id])
    const temp2 = service.createAudioGroup(project.id, { name: 'temp2', label: 'temp2_[00]' })
    const solo = await service.importAudioUpload({ groupId: temp2.id }, staged(tone('d.wav', 990)), 'solo.wav', null)
    const before = new Set(binNames())
    assert.equal((await service.deleteAudioGroup(temp2.id)).released, 1)
    const binName = binNames().find((name) => !before.has(name))!
    const { SystemFolderService } = await import('../src/services/systemFolderService')
    await SystemFolderService.restore([binName], 'fail')
    const back = service.getAudioCandidate(solo.id)
    assert.equal(back.group_id, project.inbox_group_id, 'the group is gone, so the project inbox takes it')
  })

  await t.test('orphan sweep: stray files go to the RecycleBin, unreferenced blobs are released', async () => {
    const stray = path.join(store.AUDIO_STORE_DIR, 'ab', 'cd', 'stray.wav')
    fs.mkdirSync(path.dirname(stray), { recursive: true })
    fs.copyFileSync(toneA, stray)
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(stray, old, old)
    const unused = await service.importAudioUpload({ groupId: snow.id }, staged(tone('e.wav', 1200)), 'unused.wav', null)
    audioDb.prepare('DELETE FROM audio_candidates WHERE id = ?').run(unused.id)
    // A blob registered moments ago may still be waiting for its candidate row: the grace period keeps it.
    assert.equal((await maintenance.sweepAudioOrphans({ dryRun: true })).unreferencedBlobs, 0)
    audioDb.prepare('UPDATE audio_files SET created_at = ? WHERE hash = ?').run(old.toISOString(), unused.file_hash)

    const dry = await maintenance.sweepAudioOrphans({ dryRun: true })
    assert.equal(dry.orphanFiles, 1)
    assert.equal(dry.unreferencedBlobs, 1)
    assert.ok(fs.existsSync(stray))
    const { runMediaOrphanCleanup } = await import('../src/services/maintenance/mediaOrphanCleanupService')
    const preview = await runMediaOrphanCleanup({ dryRun: true, sweepThumbnails: false, sweepTemp: false })
    assert.equal(preview.audio.orphanFiles, 1, 'the library cleanup preview reports audio separately')
    assert.equal(preview.audio.unreferencedBlobs, 1)

    const real = await maintenance.sweepAudioOrphans({ dryRun: false })
    assert.equal(real.orphanFiles, 1)
    assert.equal(real.releasedBlobs, 1)
    assert.equal(fs.existsSync(stray), false)
    assert.equal(store.getAudioFile(unused.file_hash), null)
    assert.equal((await maintenance.sweepAudioOrphans({ dryRun: true })).orphanFiles, 0)
  })

  await t.test('verification reports missing and changed blobs without touching rows', async () => {
    const victim = await service.importAudioUpload({ groupId: snow.id }, staged(tone('f.wav', 1500)), 'victim.wav', null)
    fs.rmSync(store.audioBlobPath(victim.file_hash, 'wav'))
    const report = await maintenance.verifyAudioFiles()
    assert.equal(report.missing, 1)
    assert.deepEqual(report.issues.map((issue) => issue.hash), [victim.file_hash])
    assert.ok(store.getAudioFile(victim.file_hash), 'rows stay')
    const { FileVerificationService } = await import('../src/services/fileVerificationService')
    const result = await FileVerificationService.verifyAllFiles({ verificationType: 'test' })
    assert.equal(result.audio?.missing, 1)
    service.deleteAudioCandidates([victim.id])
  })

  await t.test('database backup and stats include audio.db', async () => {
    const { resolveDefaultBackupSources } = await import('../src/services/maintenance/databaseBackupService')
    const { readDatabaseStats } = await import('../src/services/maintenance/databaseStatsService')
    assert.ok((await resolveDefaultBackupSources()).some((source) => source.fileName === 'audio.db'))
    assert.ok((await readDatabaseStats()).databases.some((entry) => entry.fileName === 'audio.db' && entry.pageCount > 0))
  })

  // ---------------------------------------------------------------- HTTP routes and permissions
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-audio', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const listenerGroup = AuthPermissionGroup.createCustomGroup({ name: 'audio-listener', permissionKeys: ['audio.view', 'images.view'] })
  const listenerId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('listener', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(listenerGroup.id, listenerId)
  const imageGroup = AuthPermissionGroup.createCustomGroup({ name: 'image-only', permissionKeys: ['images.view'] })
  const imageOnlyId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('imageonly', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(imageGroup.id, imageOnlyId)
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
    return { status: response.status, headers: response.headers, buffer, json: () => JSON.parse(buffer.toString('utf8')) }
  }

  await t.test('/api/audio: audio.view reads, audio.edit writes, everyone else is refused', async () => {
    assert.equal((await call('/api/audio/projects')).status, 401)
    assert.equal((await call('/api/audio/projects', imageOnlyId)).status, 403)
    assert.equal((await call('/api/audio/projects', listenerId)).status, 200)
    assert.equal((await call(`/api/audio/groups/${snow.id}/candidates`, listenerId)).json().data.total >= 1, true)
    assert.equal((await call('/api/audio/projects', listenerId, { method: 'POST', body: JSON.stringify({ name: 'nope' }) })).status, 403)
    assert.equal((await call(`/api/audio/candidates/${first.id}/review`, listenerId, { method: 'PATCH', body: JSON.stringify({ review: 'selected' }) })).status, 403)
    const reviewed = await call(`/api/audio/candidates/${first.id}/review`, adminId, { method: 'PATCH', body: JSON.stringify({ review: 'rejected', notes: '너무 가벼움' }) })
    assert.equal(reviewed.status, 200)
    assert.equal(reviewed.json().data.review, 'rejected')
    assert.equal((await call('/api/audio/projects', adminId, { method: 'POST', body: JSON.stringify({ name: '' }) })).status, 400)
  })

  await t.test('upload, ranged playback and no static access to the store', async () => {
    const form = new FormData()
    form.append('files', new Blob([fs.readFileSync(toneC)], { type: 'audio/flac' }), '업로드 테이크.flac')
    form.append('files', new Blob([Buffer.from('nope')], { type: 'audio/wav' }), 'broken.wav')
    const uploaded = await call(`/api/audio/upload?groupId=${stone.id}`, adminId, { method: 'POST', body: form })
    assert.equal(uploaded.status, 201)
    const data = uploaded.json().data as { created: Array<{ id: string; name: string; file_hash: string }>; failed: Array<{ name: string }> }
    assert.equal(data.created.length, 1)
    assert.equal(data.created[0].name, '업로드 테이크')
    assert.deepEqual(data.failed.map((item) => item.name), ['broken.wav'])

    const whole = await call(`/api/audio/candidates/${data.created[0].id}/file`, listenerId)
    assert.equal(whole.status, 200)
    assert.equal(whole.headers.get('content-type'), 'audio/flac')
    assert.deepEqual(whole.buffer, fs.readFileSync(toneC))
    const ranged = await call(`/api/audio/candidates/${data.created[0].id}/file`, listenerId, { headers: { Range: 'bytes=0-9' } })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.buffer.length, 10)
    assert.equal((await call(`/api/audio/candidates/${data.created[0].id}/file`, imageOnlyId)).status, 403)

    // Control: the same account can read an ordinary uploads file, so the 404s below come from the audio guard.
    fs.writeFileSync(path.join(root, 'uploads', 'control.txt'), 'ok')
    assert.equal((await call('/uploads/control.txt', adminId)).status, 200)
    const relative = path.relative(path.join(root, 'uploads'), store.audioBlobPath(data.created[0].file_hash, 'flac')).split(path.sep).join('/')
    for (const url of [`/uploads/${relative}`, `/uploads//${relative}`, `/uploads/${relative.replace('audio/', 'AUDIO/')}`, `/uploads/x/..%2F${relative}`]) {
      assert.equal((await call(url, adminId)).status, 404, url)
    }
  })

  await t.test('importing from the private file store copies the file and checks ownership', async () => {
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const { ensureFileStoreDirectories, fileStoreIncoming } = await import('../src/services/fileStorePaths')
    ensureFileStoreDirectories()
    const incoming = path.join(fileStoreIncoming, 'upload-audio-test.part')
    fs.copyFileSync(toneB, incoming)
    const [entry] = FileStoreService.upload(fileOwnerKey(adminId), null, [{ path: incoming, originalname: 'from store.wav', size: fs.statSync(incoming).size } as never], true) as Array<{ id: string }>
    const imported = await call('/api/audio/import-file', adminId, { method: 'POST', body: JSON.stringify({ fileId: entry.id, projectId: project.id }) })
    assert.equal(imported.status, 201, imported.buffer.toString())
    assert.equal(imported.json().data.origin, 'imported')
    assert.equal(imported.json().data.group_id, project.inbox_group_id)
    assert.ok(FileStoreService.resolveFile(fileOwnerKey(adminId), entry.id), 'the stored file stays')
    // The listener cannot edit audio; even with edit rights another account's file id resolves to nothing.
    assert.equal((await call('/api/audio/import-file', listenerId, { method: 'POST', body: JSON.stringify({ fileId: entry.id, projectId: project.id }) })).status, 403)
  })

  // ---------------------------------------------------------------- MCP tools
  await t.test('MCP: read tools follow audio.view, organize tools audio.edit, and no tool can review or delete', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const connect = async (requester?: { accountId: number; accountType: 'admin' | 'guest' }) => {
      const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', ...(requester ? { requester } : {}) })
      const client = new Client({ name: 'audio-test', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
      t.after(async () => { await client.close(); await mcp.close() })
      return client
    }
    const audioTools = async (client: Awaited<ReturnType<typeof connect>>) => (await client.listTools()).tools.map((tool) => tool.name).filter((name) => name.includes('audio')).sort()

    const listener = await connect({ accountId: listenerId, accountType: 'guest' })
    assert.deepEqual(await audioTools(listener), ['export_audio_selected', 'get_audio_candidate', 'get_audio_download', 'get_audio_order', 'list_audio_candidates', 'list_audio_folders', 'list_audio_group_comments', 'list_audio_groups', 'list_audio_projects', 'list_audio_workflows', 'wait_audio_order'])
    assert.deepEqual(await audioTools(await connect({ accountId: imageOnlyId, accountType: 'guest' })), [])
    const admin = await connect({ accountId: adminId, accountType: 'admin' })
    const adminTools = await audioTools(admin)
    assert.ok(adminTools.includes('import_audio') && adminTools.includes('set_audio_group_comment_status'))
    assert.deepEqual(adminTools.filter((name) => /review|delete_audio|restore|create_audio_group_comment/.test(name)), [], 'review, unrestricted delete and comment writing stay with people (delete_unselected_audio_candidates never touches a selected take)')

    const listed = await listener.callTool({ name: 'list_audio_candidates', arguments: { group_id: snow.id } }) as { content: Array<{ text: string }> }
    assert.ok(JSON.parse(listed.content[0].text).candidates.every((candidate: Record<string, unknown>) => 'candidate_id' in candidate && !('composite_hash' in candidate)))
    const denied = await listener.callTool({ name: 'create_audio_project', arguments: { name: 'x' } }) as { isError?: boolean }
    assert.equal(denied.isError, true)

    const dataUrl = `data:audio/wav;base64,${fs.readFileSync(tone('g.wav', 330)).toString('base64')}`
    const imported = await admin.callTool({ name: 'import_audio', arguments: { project_id: project.id, data_url: dataUrl, file_name: 'bot take.wav' } }) as { isError?: boolean; content: Array<{ text: string }> }
    assert.notEqual(imported.isError, true, imported.content[0]?.text)
    const summary = JSON.parse(imported.content[0].text)
    assert.equal(summary.group_id, project.inbox_group_id)
    assert.equal(summary.origin, 'imported')
    assert.equal(summary.review, 'pending')
  })
})
