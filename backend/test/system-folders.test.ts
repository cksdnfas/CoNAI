import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('administrators browse server folders and manage the RecycleBin safely', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-system-folders-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  // The databases sit inside a browsable root on purpose: they must stay hidden and unreachable.
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'save', 'database')
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const recycle = await import('../src/utils/recycleBin')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-system-folders-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = `test-${id ?? 'anonymous'}`
    // Sessions start with a stale "admin" role so only a fresh account read can grant admin access.
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id ? 'admin' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, accountId: number, method = 'GET', body: unknown = {}, headers: Record<string, string> = {}) => {
    const response = await fetch(origin + url, { method, headers: { 'x-test-account': String(accountId), 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    let parsed: any = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* raw body */ }
    return { status: response.status, body: parsed, headers: response.headers }
  }

  const addAccount = (name: string, type: 'admin' | 'guest') => Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
  const adminId = addAccount('admin-test', 'admin')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'file-users', permissionKeys: ['files.view', 'files.edit', 'files.delete', 'images.view'] })
  const guestId = addAccount('file-user', 'guest')
  AuthPermissionGroup.addAccountMembership(group.id, guestId)
  invalidateConfiguredAuthCache()

  const uploads = path.join(root, 'uploads')
  const bin = path.join(root, 'recycle_bin')
  fs.mkdirSync(path.join(uploads, 'images', '2026-10-08'), { recursive: true })
  fs.mkdirSync(bin, { recursive: true })

  await t.test('only administrators reach system folders, even with every file store permission', async () => {
    assert.equal((await call('/api/system-folders', guestId)).status, 403)
    assert.equal((await call('/api/system-folders/uploads', guestId)).status, 403)
    assert.equal((await call('/api/system-folders/recycle-bin/empty', guestId, 'POST')).status, 403)
    assert.equal((await call('/api/system-folders/recycle-bin/restore', guestId, 'POST', { names: ['x'] })).status, 403)
    const roots = await call('/api/system-folders', adminId)
    assert.equal(roots.status, 200)
    assert.deepEqual(roots.body.data.map((item: { id: string }) => item.id), ['recycle-bin', 'uploads', 'save', 'temp', 'logs'])
    assert.ok(!JSON.stringify(roots.body).includes(root), 'root locations stay server-side')
  })

  await t.test('paths cannot leave the root, follow links, or reach the databases', async () => {
    for (const bad of ['..', 'images/../..', 'images\\..\\..', 'C:', 'C:/Windows', '/etc', 'images//2026-10-08', 'a\u0000b']) {
      const response = await call(`/api/system-folders/uploads?path=${encodeURIComponent(bad)}`, adminId)
      assert.ok(response.status === 400 || response.status === 404, `${JSON.stringify(bad)} -> ${response.status}`)
    }
    assert.equal((await call('/api/system-folders/nope', adminId)).status, 404)

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync(outside, path.join(uploads, 'escape'), 'junction')
    const listing = await call('/api/system-folders/uploads', adminId)
    assert.equal(listing.status, 200)
    assert.ok(!listing.body.data.entries.some((entry: { name: string }) => entry.name === 'escape'), 'links are not listed')
    assert.equal((await call('/api/system-folders/uploads?path=escape', adminId)).status, 403)
    assert.equal((await call('/api/system-folders/uploads/download?path=escape/secret.txt', adminId)).status, 403)
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(uploads, 'link.txt'), 'file')
      assert.equal((await call('/api/system-folders/uploads/download?path=link.txt', adminId)).status, 403)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error // File symlinks need privilege on Windows.
    }

    const save = await call('/api/system-folders/save', adminId)
    assert.equal(save.status, 200)
    assert.ok(!save.body.data.entries.some((entry: { name: string }) => entry.name === 'database'), 'the database folder is hidden')
    assert.equal((await call('/api/system-folders/save/download?path=database/images.db', adminId)).status, 403)
  })

  await t.test('read-only roots list, view and download with byte ranges', async () => {
    fs.writeFileSync(path.join(uploads, 'images', '2026-10-08', '20261008_101010_aaaaaa_a.txt'), 'hello world')
    const listing = await call('/api/system-folders/uploads?path=images/2026-10-08', adminId)
    assert.equal(listing.status, 200)
    assert.equal(listing.body.data.entries[0].path, 'images/2026-10-08/20261008_101010_aaaaaa_a.txt')
    assert.deepEqual(listing.body.data.breadcrumbs.map((crumb: { path: string }) => crumb.path), ['images', 'images/2026-10-08'])
    const ranged = await call('/api/system-folders/uploads/download?path=images/2026-10-08/20261008_101010_aaaaaa_a.txt', adminId, 'GET', {}, { Range: 'bytes=0-4' })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.body, 'hello')
    const view = await call('/api/system-folders/uploads/view?path=images/2026-10-08/20261008_101010_aaaaaa_a.txt', adminId)
    assert.equal(view.status, 200)
    assert.match(view.headers.get('content-type') ?? '', /^text\/plain/)
    assert.equal(view.headers.get('content-security-policy'), 'sandbox')
  })

  await t.test('system thumbnails share concurrent decoding and reject a changed or deleted source', async (t) => {
    const { SystemFolderService } = await import('../src/services/systemFolderService')
    const { VideoFrameExtractor } = await import('../src/services/videoFrameExtractor')
    const source = path.join(uploads, 'preview.mp4')
    fs.writeFileSync(source, Buffer.from('\0\0\0\0ftypisom'))
    const render = t.mock.method(VideoFrameExtractor, 'extractPreviewFrame', async (_input: string, output: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await fs.promises.writeFile(output, 'complete preview')
    })
    const results = await Promise.all(Array.from({ length: 12 }, () => SystemFolderService.thumbnail('uploads', ['preview.mp4'])))
    assert.equal(render.mock.callCount(), 1, 'concurrent requests occupy one decoder slot')
    assert.equal(new Set(results).size, 1)
    assert.equal(fs.readFileSync(results[0], 'utf8'), 'complete preview')
    const directory = path.dirname(results[0])
    const before = fs.readdirSync(directory)

    fs.appendFileSync(source, 'new revision')
    render.mock.mockImplementation(async (input: string, output: string) => {
      await fs.promises.writeFile(output, 'outdated preview')
      await fs.promises.appendFile(input, 'changed while decoding')
    })
    await assert.rejects(SystemFolderService.thumbnail('uploads', ['preview.mp4']), { status: 409 })
    assert.deepEqual(fs.readdirSync(directory), before, 'an obsolete preview and its staging file are discarded')
    render.mock.mockImplementation(async (input: string, output: string) => {
      await fs.promises.writeFile(output, 'deleted preview')
      await fs.promises.unlink(input)
    })
    await assert.rejects(SystemFolderService.thumbnail('uploads', ['preview.mp4']), { status: 404 })
    assert.deepEqual(fs.readdirSync(directory), before)
    t.diagnostic('12 simultaneous system-folder requests: 1 decoder invocation; changed/deleted sources not published')
  })

  await t.test('RecycleBin names never collide and keep deletion order', async () => {
    const now = new Date('2026-10-08T01:02:03.456Z')
    const names = new Set(Array.from({ length: 200 }, () => recycle.generateRecycleBinFileName('/a/ComfyUI_00001_.png', now)))
    assert.equal(names.size, 200)
    const long = recycle.generateRecycleBinFileName(`/a/${'가'.repeat(150)}.png`, now)
    assert.ok(Buffer.byteLength(long, 'utf8') <= 200 && long.endsWith('.png'))
    assert.deepEqual(recycle.parseRecycleBinFileName([...names][0]), { deletedAt: '2026-10-08T01:02:03.456Z', originalName: 'ComfyUI_00001_.png' })
    assert.deepEqual(recycle.parseRecycleBinFileName('2025-01-15T12-30-45-123Z_한글.png'), { deletedAt: '2025-01-15T12:30:45.123Z', originalName: '한글.png' })

    // Two same-named files deleted at once (every copy of one image) both survive.
    const left = path.join(uploads, 'left'); const right = path.join(uploads, 'right')
    fs.mkdirSync(left); fs.mkdirSync(right)
    fs.writeFileSync(path.join(left, 'same.png'), 'L'); fs.writeFileSync(path.join(right, 'same.png'), 'R')
    const [first, second] = await Promise.all([
      recycle.deleteFile(path.join(left, 'same.png'), true, 'library'),
      recycle.deleteFile(path.join(right, 'same.png'), true, 'library'),
    ])
    assert.ok(first && second && first !== second)
    assert.deepEqual([fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8')].sort(), ['L', 'R'])
  })

  await t.test('RecycleBin files restore to where they came from', async () => {
    const original = path.join(uploads, 'images', '2026-10-08', 'restore-me.png')
    fs.writeFileSync(original, 'v1')
    const binPath = await recycle.deleteFile(original, true, 'library') as string
    const binName = path.basename(binPath)
    const legacyName = '2025-01-15T12-30-45-123Z_legacy.png'
    fs.writeFileSync(path.join(bin, legacyName), 'old')

    const listing = await call('/api/system-folders/recycle-bin?limit=500', adminId)
    assert.equal(listing.status, 200)
    const entry = listing.body.data.entries.find((item: { name: string }) => item.name === binName)
    assert.equal(entry.recycle.restorable, true)
    assert.equal(entry.recycle.originalPath, path.resolve(original))
    assert.equal(entry.recycle.source, 'library')
    assert.equal(entry.recycle.originalName, 'restore-me.png')
    const legacy = listing.body.data.entries.find((item: { name: string }) => item.name === legacyName)
    assert.deepEqual(legacy.recycle, { originalName: 'legacy.png', originalPath: null, deletedAt: '2025-01-15T12:30:45.123Z', source: null, restorable: false })
    const names = listing.body.data.entries.map((item: { name: string }) => item.name)
    assert.deepEqual(names, [...names].sort().reverse(), 'newest first')

    const restored = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName, legacyName] })
    assert.equal(restored.status, 200)
    assert.deepEqual(restored.body.data.done, [{ name: binName, restoredTo: path.resolve(original) }])
    assert.equal(restored.body.data.failed[0].name, legacyName)
    assert.equal(fs.readFileSync(original, 'utf8'), 'v1')
    assert.ok(!fs.existsSync(binPath))

    // An occupied original location fails unless a sibling name is allowed.
    const again = path.basename(await recycle.deleteFile(original, true, 'library') as string)
    fs.writeFileSync(original, 'v2')
    const refused = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [again] })
    assert.equal(refused.body.data.done.length, 0)
    assert.equal(fs.readFileSync(original, 'utf8'), 'v2')
    const renamed = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [again], conflict: 'rename' })
    assert.equal(renamed.body.data.done[0].restoredTo, path.join(path.dirname(path.resolve(original)), 'restore-me (복원 1).png'))
    assert.equal(fs.readFileSync(original, 'utf8'), 'v2')

    assert.equal((await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: ['../x'] })).status, 400)
    assert.equal((await call('/api/system-folders/recycle-bin/delete', adminId, 'POST', { names: [] })).status, 400)
  })

  await t.test('bulk image undo restores only returned entries, library rows, groups and prompt counts', async (t) => {
    const { settingsService } = await import('../src/services/settingsService')
    const settings = settingsService.loadSettings()
    t.mock.method(settingsService, 'loadSettings', () => ({ ...settings, general: { ...settings.general, deleteProtection: { ...settings.general.deleteProtection, enabled: true } } }))
    const db = main.db
    const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
    const groupId = (db.prepare('SELECT id FROM groups ORDER BY id LIMIT 1').get() as { id: number }).id
    const hash = 'ab'.repeat(24)
    const otherHash = 'cd'.repeat(24)
    const first = path.join(uploads, 'undo-first.png')
    const second = path.join(uploads, 'undo-second.png')
    const other = path.join(uploads, 'undo-unselected.png')
    const insertImage = (imageHash: string, files: string[]) => {
      db.prepare("INSERT INTO media_metadata (composite_hash, prompt, first_seen_date) VALUES (?, 'undo_prompt', '2020-01-01 00:00:00')").run(imageHash)
      for (const file of files) {
        fs.writeFileSync(file, path.basename(file))
        db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, 1, 'image/png')").run(imageHash, file, folderId)
      }
    }
    insertImage(hash, [first, second])
    insertImage(otherHash, [other])
    const cascadeTables = db.prepare(`SELECT DISTINCT m.name
      FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk
      WHERE m.type = 'table' AND fk."table" = 'media_metadata' AND fk.on_delete = 'CASCADE'
      ORDER BY m.name`).all() as Array<{ name: string }>
    assert.deepEqual(cascadeTables.map((row) => row.name), [
      'auto_folder_group_images', 'generated_video_optimizations', 'image_groups',
      'image_models', 'media_image_features', 'media_similarity_index',
    ], 'every cascaded media side table must have a restore strategy')
    const { MediaImageFeaturesModel } = await import('../src/models/Image/MediaImageFeaturesModel')
    const { AutoTagIndexService } = await import('../src/services/autoTagIndexService')
    const histogram = {
      r: Array.from({ length: 256 }, (_,index) => Number(index === 64)),
      g: Array.from({ length: 256 }, (_,index) => Number(index === 128)),
      b: Array.from({ length: 256 }, (_,index) => Number(index === 192)),
    }
    db.prepare("UPDATE media_metadata SET perceptual_hash = '123456789abcdef0', dhash = 'fedcba9876543210', ahash = '1122334455667788', auto_tags = ? WHERE composite_hash = ?")
      .run(JSON.stringify({ tagger: { general: { undo_tag: 0.875 } } }), hash)
    MediaImageFeaturesModel.setHistogram(hash, histogram)
    AutoTagIndexService.syncForHash(hash, JSON.stringify({ tagger: { general: { undo_tag: 0.875 } } }))
    const histogramBefore = MediaImageFeaturesModel.getHistogram(hash)
    const similarityRow = db.prepare(`SELECT p_hi, p_lo, d_hi, d_lo, a_hi, a_lo, avg_r, avg_g, avg_b, dom_r, dom_g, dom_b, luminance, saturation
      FROM media_similarity_index WHERE media_id = (SELECT media_id FROM media_metadata WHERE composite_hash = ?)`)
    const similarityBefore = similarityRow.get(hash)
    const modelRows = db.prepare('SELECT model_hash, model_role, weight, civitai_checked, civitai_failed, checked_at, created_at FROM image_models WHERE composite_hash = ? ORDER BY model_hash')
    db.prepare(`INSERT INTO image_models (composite_hash, model_hash, model_role, weight, civitai_checked, civitai_failed, checked_at, created_at)
      VALUES (?, 'model-checkpoint', 'checkpoint', 1.0, 1, 0, '2020-01-02', '2020-01-01'),
             (?, 'model-lora', 'lora', 0.75, 0, 1, '2020-01-03', '2020-01-01')`).run(hash, hash)
    const modelsBefore = modelRows.all(hash)
    const videoRows = db.prepare('SELECT * FROM generated_video_optimizations WHERE composite_hash = ?')
    db.prepare(`INSERT INTO generated_video_optimizations
      (composite_hash, source_path, source_size, source_mtime, crf, audio_bitrate, status, output_path, attempts)
      VALUES (?, ?, 1234, 1000, 23, 128, 'completed', ?, 2)`).run(hash, second, path.join(root, 'optimized-copy.mp4'))
    const videoBefore = videoRows.get(hash)
    const folderGroupId = Number(db.prepare(`INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name)
      VALUES ('undo-folder', ?, 'Undo folder')`).run(path.join(uploads, 'undo-folder')).lastInsertRowid)
    db.prepare('INSERT INTO auto_folder_group_images (group_id, composite_hash) VALUES (?, ?)').run(folderGroupId, hash)
    db.prepare("INSERT INTO prompt_collection (prompt, usage_count) VALUES ('undo_prompt', 2)").run()
    db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type, order_index) VALUES (?, ?, 'manual', 7)").run(groupId, hash)
    const unused = path.join(uploads, 'unrelated-output.txt')
    fs.writeFileSync(unused, 'unrelated')
    const unrelatedName = path.basename(await recycle.deleteFile(unused, true, 'workflow-output') as string)
    const deletion = await call('/api/images/bulk', adminId, 'DELETE', { compositeHashes: [hash, 'invalid'] })
    assert.equal(deletion.status, 200)
    const details = deletion.body.data.details
    assert.equal(details.deleted, 1)
    assert.equal(details.failed, 1)
    assert.equal(details.recycleBinEntries.length, 2, 'one entry per physical copy, not per hash')
    assert.equal(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(hash), undefined)
    assert.deepEqual(modelRows.all(hash), [], 'model links really were cascaded away')
    assert.equal(MediaImageFeaturesModel.getHistogram(hash), null)
    assert.equal(videoRows.get(hash), undefined)
    assert.equal(fs.existsSync(first), false)
    assert.equal(fs.existsSync(second), false)
    assert.ok(fs.existsSync(other), 'unselected files remain untouched')
    assert.equal((db.prepare("SELECT usage_count FROM prompt_collection WHERE prompt = 'undo_prompt'").get() as { usage_count: number }).usage_count, 1)

    assert.equal((await call('/api/images/restore', guestId, 'POST', { names: details.recycleBinEntries })).status, 403)
    const editorGroup = AuthPermissionGroup.createCustomGroup({ name: 'image-undo', permissionKeys: ['images.view', 'images.delete'] })
    const editorId = addAccount('image-undo-user', 'guest')
    AuthPermissionGroup.addAccountMembership(editorGroup.id, editorId)
    invalidateConfiguredAuthCache()
    const unrecordedName = 'unrecorded-file.txt'
    fs.writeFileSync(path.join(bin, unrecordedName), 'no origin')
    const forbidden = await call('/api/images/restore', editorId, 'POST', { names: [unrelatedName, unrecordedName, 'missing-file.txt'] })
    assert.equal(forbidden.body.data.done.length, 0)
    assert.equal(forbidden.body.data.failed[0].name, unrelatedName)
    assert.equal(forbidden.body.data.failed.length, 3)
    assert.ok(forbidden.body.data.failed.every((item: { error: string; code?: string }) =>
      item.error === forbidden.body.data.failed[0].error && item.code === undefined), 'non-library, unrecorded and absent names have the same response')
    assert.ok(fs.existsSync(path.join(bin, unrelatedName)), 'image undo cannot restore other server files')
    assert.equal((await call('/api/images/restore', editorId, 'POST', { names: ['../escape'] })).status, 400)

    // A conflict affects only that entry and never overwrites a newly created file.
    fs.writeFileSync(first, 'newer')
    const restored = await call('/api/images/restore', editorId, 'POST', { names: details.recycleBinEntries })
    assert.equal(restored.status, 200)
    assert.equal(restored.body.data.done.length, 1)
    assert.equal(restored.body.data.failed.length, 1)
    assert.equal(restored.body.data.failed[0].code, 'conflict')
    assert.equal(fs.readFileSync(first, 'utf8'), 'newer')
    assert.equal(fs.readFileSync(second, 'utf8'), 'undo-second.png')
    assert.equal((db.prepare('SELECT first_seen_date FROM media_metadata WHERE composite_hash = ?').get(hash) as { first_seen_date: string }).first_seen_date, '2020-01-01 00:00:00')
    assert.equal((db.prepare('SELECT order_index FROM image_groups WHERE composite_hash = ? AND group_id = ?').get(hash, groupId) as { order_index: number }).order_index, 7)
    assert.deepEqual(MediaImageFeaturesModel.getHistogram(hash), histogramBefore, 'histogram BLOB survives byte-for-byte')
    assert.deepEqual(similarityRow.get(hash), similarityBefore, 'hash bands and color descriptors are rebuilt')
    assert.deepEqual(modelRows.all(hash), modelsBefore, 'model roles, weights and lookup status survive')
    assert.deepEqual(videoRows.get(hash), videoBefore, 'video optimization state survives when its source is restored')
    assert.ok(db.prepare('SELECT 1 FROM auto_folder_group_images WHERE composite_hash = ? AND group_id = ?').get(hash, folderGroupId))
    assert.deepEqual(db.prepare(`SELECT t.tag_key, mat.score FROM media_auto_tags mat
      JOIN auto_tag_terms t ON t.term_id = mat.term_id
      JOIN media_metadata m ON m.media_id = mat.media_id WHERE m.composite_hash = ?`).all(hash), [{ tag_key: 'undo_tag', score: 0.875 }], 'auto-tag search rows are rebuilt from metadata')
    assert.equal((db.prepare("SELECT usage_count FROM prompt_collection WHERE prompt = 'undo_prompt'").get() as { usage_count: number }).usage_count, 2, 'restoring copies increments usage only once')
    fs.unlinkSync(first)
    const retry = await call('/api/images/restore', editorId, 'POST', { names: restored.body.data.failed.map((entry: { name: string }) => entry.name) })
    assert.equal(retry.body.data.done.length, 1)
    assert.equal(fs.readFileSync(first, 'utf8'), 'undo-first.png')
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM image_files WHERE composite_hash = ?').get(hash) as { count: number }).count, 2)
    assert.equal((db.prepare("SELECT usage_count FROM prompt_collection WHERE prompt = 'undo_prompt'").get() as { usage_count: number }).usage_count, 2)

    // Single-image responses expose the same undo entries; permanently deleted files expose none.
    const single = await call(`/api/images/${otherHash}`, adminId, 'DELETE')
    assert.equal(single.body.data.recycleBinEntries.length, 1)
    const adminRestore = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: single.body.data.recycleBinEntries })
    assert.equal(adminRestore.body.data.done.length, 1)
    assert.ok(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(otherHash), 'the admin restore shares library reattachment')
    const { ImageManagementService } = await import('../src/services/imageManagementService')
    t.mock.method(settingsService, 'loadSettings', () => ({ ...settings, general: { ...settings.general, deleteProtection: { ...settings.general.deleteProtection, enabled: false } } }))
    const permanent = await ImageManagementService.deleteImagesBulk([otherHash])
    assert.deepEqual(permanent.details.recycleBinEntries, [])
    assert.equal(fs.existsSync(other), false)
  })

  await t.test('administrators can recover files with warnings when library reattachment is impossible, while Undo stays strict', async (t) => {
    const { settingsService } = await import('../src/services/settingsService')
    const settings = settingsService.loadSettings()
    t.mock.method(settingsService, 'loadSettings', () => ({ ...settings, general: { ...settings.general, deleteProtection: { ...settings.general.deleteProtection, enabled: true } } }))
    const db = main.db
    for (const [index, reason] of ['removed-folder', 'registered-path', 'malformed-json'].entries()) {
      const hash = `${index + 1}f`.repeat(24)
      const directory = path.join(uploads, `fallback-${reason}`)
      fs.mkdirSync(directory)
      const original = path.join(directory, 'recover.png')
      fs.writeFileSync(original, 'recoverable content')
      const folderId = Number(db.prepare('INSERT INTO watched_folders (folder_path, folder_name) VALUES (?, ?)').run(directory, reason).lastInsertRowid)
      db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
      db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, 19, 'image/png')").run(hash, original, folderId)
      const deletion = await call('/api/images/bulk', adminId, 'DELETE', { compositeHashes: [hash] })
      const [name] = deletion.body.data.details.recycleBinEntries
      assert.ok(name, 'the protected deletion records an undo entry')
      if (reason === 'removed-folder') db.prepare('DELETE FROM watched_folders WHERE id = ?').run(folderId)
      else if (reason === 'registered-path') {
        const otherHash = 'ef'.repeat(24)
        db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(otherHash)
        db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, 1, 'image/png')").run(otherHash, original, folderId)
      } else {
        user.getUserSettingsDb().prepare("UPDATE recycle_bin_entries SET library_restore_data = '{broken' WHERE bin_name = ?").run(name)
      }
      const undo = await call('/api/images/restore', adminId, 'POST', { names: [name] })
      assert.equal(undo.body.data.done.length, 0, reason)
      assert.equal(undo.body.data.failed.length, 1, reason)
      assert.equal(fs.existsSync(original), false, 'strict Undo rolls the physical file back')
      assert.ok(fs.existsSync(path.join(bin, name)))
      assert.equal(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(hash), undefined, 'failed DB reattachment rolls back all inserted rows')

      // Even rename-on-conflict must be able to recover an otherwise unattachable file.
      const renamed = reason === 'removed-folder'
      if (renamed) fs.writeFileSync(original, 'newer content')
      const result = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [name], conflict: renamed ? 'rename' : 'fail' })
      assert.equal(result.body.data.done.length, 1, reason)
      assert.equal(result.body.data.failed.length, 0, reason)
      assert.ok(result.body.data.done[0].warning, 'file-only recovery is explicitly warned about')
      const restoredTo = renamed ? path.join(directory, 'recover (복원 1).png') : original
      assert.equal(result.body.data.done[0].restoredTo, restoredTo)
      assert.equal(fs.readFileSync(restoredTo, 'utf8'), 'recoverable content')
      if (renamed) assert.equal(fs.readFileSync(original, 'utf8'), 'newer content')
      assert.equal(fs.existsSync(path.join(bin, name)), false)
      assert.equal(recycle.readRecycleBinOrigins([name]).size, 0)
    }
  })

  await t.test('prompt batch deletion is permission-checked, type-scoped and rolls back shared validation failures', async (t) => {
    const db = main.db
    const addPrompt = (prompt: string, usage = 0, groupId: number | null = null) => Number(db.prepare('INSERT INTO prompt_collection (prompt, usage_count, group_id) VALUES (?, ?, ?)').run(prompt, usage, groupId).lastInsertRowid)
    const first = addPrompt('batch-allowed')
    const inUse = addPrompt('batch-in-use', 1)
    assert.equal((await call('/api/prompt-collection/bulk', guestId, 'DELETE', { promptIds: [first] })).status, 403)
    const blocked = await call('/api/prompt-collection/bulk', adminId, 'DELETE', { promptIds: [first, inUse] })
    assert.equal(blocked.status, 409)
    assert.equal((await call(`/api/prompt-collection/${inUse}`, adminId, 'DELETE')).status, 409, 'single deletes expose the same domain conflict')
    assert.equal((await call('/api/prompt-collection/not-a-prompt-id', adminId, 'DELETE')).status, 400)
    assert.ok(db.prepare('SELECT 1 FROM prompt_collection WHERE id = ?').get(first), 'earlier deletes roll back')
    const { PromptGroupModel } = await import('../src/models/PromptGroup')
    const loraId = PromptGroupModel.create({ group_name: 'LoRA' })
    const protectedId = addPrompt('batch-protected', 0, loraId)
    assert.equal((await call('/api/prompt-collection/bulk', adminId, 'DELETE', { promptIds: [first, protectedId] })).status, 409)
    assert.ok(db.prepare('SELECT 1 FROM prompt_collection WHERE id = ?').get(first))
    for (const body of [{ promptIds: [] }, { promptIds: [first, '2'] }, { promptIds: [first], type: 'both' }]) {
      assert.equal((await call('/api/prompt-collection/bulk', adminId, 'DELETE', body)).status, 400)
      assert.ok(db.prepare('SELECT 1 FROM prompt_collection WHERE id = ?').get(first))
    }
    const deleted = await call('/api/prompt-collection/bulk', adminId, 'DELETE', { promptIds: [first, first] })
    assert.deepEqual(deleted.body.data.deletedIds, [first])
    assert.equal(db.prepare('SELECT 1 FROM prompt_collection WHERE id = ?').get(first), undefined)
    for (const [type, table] of [['negative', 'negative_prompt_collection'], ['auto', 'auto_prompt_collection']] as const) {
      const id = Number(db.prepare(`INSERT INTO ${table} (prompt, usage_count) VALUES ('batch-other-type', 0)`).run().lastInsertRowid)
      const result = await call('/api/prompt-collection/bulk', adminId, 'DELETE', { promptIds: [id], type })
      assert.deepEqual(result.body.data.deletedIds, [id])
      assert.equal(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id), undefined)
    }
    const { PromptCollectionModel } = await import('../src/models/PromptCollection')
    t.mock.method(PromptCollectionModel, 'delete', () => { throw new Error('Invalid database state') })
    assert.equal((await call('/api/prompt-collection/bulk', adminId, 'DELETE', { promptIds: [inUse + 10000] })).status, 500, 'a DB error containing Invalid is not an input error or conflict')
    assert.equal((await call(`/api/prompt-collection/${inUse + 10000}`, adminId, 'DELETE')).status, 500)
  })

  await t.test('permanent delete and empty only touch RecycleBin files', async () => {
    fs.writeFileSync(path.join(bin, '2026-01-01T00-00-00-000Z_a.txt'), 'a')
    const removed = await call('/api/system-folders/recycle-bin/delete', adminId, 'POST', { names: ['2026-01-01T00-00-00-000Z_a.txt', 'missing.txt'] })
    assert.deepEqual(removed.body.data.done, [{ name: '2026-01-01T00-00-00-000Z_a.txt' }])
    assert.equal(removed.body.data.failed[0].name, 'missing.txt')

    fs.mkdirSync(path.join(bin, 'kept-folder'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    fs.symlinkSync(outside, path.join(bin, 'link'), 'junction')
    const emptied = await call('/api/system-folders/recycle-bin/empty', adminId, 'POST')
    assert.equal(emptied.status, 200)
    assert.ok(emptied.body.data.deleted >= 2)
    assert.deepEqual(fs.readdirSync(bin).sort(), ['kept-folder', 'link'])
    assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'nothing behind a link is deleted')
    const after = await call('/api/system-folders/recycle-bin', adminId)
    assert.deepEqual(after.body.data.entries.map((item: { name: string }) => item.name), ['kept-folder'])
    const orphanOrigins = user.getUserSettingsDb().prepare('SELECT COUNT(*) AS count FROM recycle_bin_entries').get() as { count: number }
    assert.equal(orphanOrigins.count, 0)
  })

  await t.test('a file deleted into the bin while it is being emptied stays, with its origin', async () => {
    for (let index = 0; index < 5; index += 1) fs.writeFileSync(path.join(bin, `2026-02-01T00-00-00-00${index}Z_old.txt`), 'old')
    const lateName = '2026-10-08T09-00-00-000Z-late01_late.png'
    const originalUnlink = fs.promises.unlink
    let injected = false
    fs.promises.unlink = (async (target: fs.PathLike) => {
      if (!injected) {
        // Another delete lands in the bin after emptying read the directory.
        injected = true
        fs.writeFileSync(path.join(bin, lateName), 'late')
        user.getUserSettingsDb().prepare("INSERT INTO recycle_bin_entries (bin_name, original_path, size, source) VALUES (?, ?, 4, 'library')").run(lateName, path.join(uploads, 'late.png'))
      }
      return originalUnlink(target)
    }) as typeof fs.promises.unlink
    try {
      const emptied = await call('/api/system-folders/recycle-bin/empty', adminId, 'POST')
      assert.equal(emptied.body.data.deleted, 5)
    } finally {
      fs.promises.unlink = originalUnlink
    }
    assert.ok(fs.existsSync(path.join(bin, lateName)))
    const listing = await call('/api/system-folders/recycle-bin', adminId)
    const late = listing.body.data.entries.find((item: { name: string }) => item.name === lateName)
    assert.equal(late.recycle.restorable, true)
    assert.equal(late.recycle.originalPath, path.join(uploads, 'late.png'))
  })

  await t.test('moving a file back never replaces a file that appeared at the target', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'move-'))
    const source = path.join(dir, 'source.png'); const target = path.join(dir, 'target.png')
    fs.writeFileSync(source, 'from-bin'); fs.writeFileSync(target, 'created-meanwhile')
    await assert.rejects(recycle.moveFileWithoutReplacing(source, target), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(target, 'utf8'), 'created-meanwhile')
    assert.equal(fs.readFileSync(source, 'utf8'), 'from-bin')

    // Without hard links (another volume, FAT, some shares) the exclusive copy refuses the same way.
    const originalLink = fs.promises.link
    fs.promises.link = (async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }) }) as typeof fs.promises.link
    try {
      await assert.rejects(recycle.moveFileWithoutReplacing(source, target), { code: 'EEXIST' })
      assert.equal(fs.readFileSync(target, 'utf8'), 'created-meanwhile')
      assert.equal(fs.readFileSync(source, 'utf8'), 'from-bin')
      await recycle.moveFileWithoutReplacing(source, path.join(dir, 'free.png'))
      assert.equal(fs.readFileSync(path.join(dir, 'free.png'), 'utf8'), 'from-bin')
      assert.ok(!fs.existsSync(source))
    } finally {
      fs.promises.link = originalLink
    }

    // Through the route: the original spot is taken only after the bin entry was recorded.
    const original = path.join(uploads, 'race.png')
    fs.writeFileSync(original, 'v1')
    const binName = path.basename(await recycle.deleteFile(original, true, 'library') as string)
    fs.writeFileSync(original, 'newer')
    const refused = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName] })
    assert.equal(refused.body.data.failed[0].name, binName)
    assert.equal(fs.readFileSync(original, 'utf8'), 'newer')
    assert.ok(fs.existsSync(path.join(bin, binName)))
    const renamed = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName], conflict: 'rename' })
    assert.equal(renamed.body.data.done[0].restoredTo, path.join(uploads, 'race (복원 1).png'))
    assert.equal(fs.readFileSync(path.join(uploads, 'race (복원 1).png'), 'utf8'), 'v1')
    assert.equal(fs.readFileSync(original, 'utf8'), 'newer')
  })
})
