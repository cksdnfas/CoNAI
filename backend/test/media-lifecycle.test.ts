import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

/**
 * File lifecycle maintenance: thumbnail path resolution, the user-facing delete path, the orphan collector
 * (dry run + reference safety) and online database backups. Runs against throwaway databases under the OS temp dir.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-media-lifecycle-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

const OLD = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
const hex = (seed: string, length = 48) => seed.repeat(length).slice(0, length)

async function boot() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { runtimePaths } = await import('../src/config/runtimePaths')
  return { db: main.db, userDb: user.getUserSettingsDb(), runtimePaths }
}

const booted = boot()

function writeFile(filePath: string, content = 'x', mtime?: Date): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  if (mtime) fs.utimesSync(filePath, mtime, mtime)
  return filePath
}

function insertMetadata(db: Database.Database, hash: string, options: { thumbnail?: string | null; updated?: string } = {}) {
  db.prepare(`
    INSERT INTO media_metadata (composite_hash, thumbnail_path, metadata_updated_date, first_seen_date)
    VALUES (?, ?, ?, ?)
  `).run(hash, options.thumbnail ?? null, options.updated ?? '2000-01-01 00:00:00', options.updated ?? '2000-01-01 00:00:00')
}

function insertFile(db: Database.Database, hash: string | null, filePath: string, status = 'active', verified = '2000-01-01 00:00:00') {
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  return Number(db.prepare(`
    INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type, last_verified_date)
    VALUES (?, ?, ?, ?, 1, 'image/png', ?)
  `).run(hash, filePath, folderId, status, verified).lastInsertRowid)
}

test('thumbnail paths resolve inside the temp dir whatever separators they were stored with', async () => {
  const { resolveThumbnailAbsolutePath } = await import('../src/utils/thumbnailGenerator')
  const tempDir = path.join(root, 'resolve-temp')
  const expected = path.join(tempDir, 'thumbnails', '2026-03-17', 'abc.webp')

  assert.equal(resolveThumbnailAbsolutePath('thumbnails/2026-03-17/abc.webp', tempDir), expected)
  assert.equal(resolveThumbnailAbsolutePath('thumbnails\\2026-03-17\\abc.webp', tempDir), expected)
  assert.equal(resolveThumbnailAbsolutePath(expected, tempDir), expected)
  assert.equal(resolveThumbnailAbsolutePath('../outside.webp', tempDir), null)
  assert.equal(resolveThumbnailAbsolutePath('thumbnails\\..\\..\\outside.webp', tempDir), null)
  assert.equal(resolveThumbnailAbsolutePath(path.join(root, 'elsewhere.webp'), tempDir), null)
  assert.equal(resolveThumbnailAbsolutePath('', tempDir), null)
})

test('thumbnail batch lookups share bounded asynchronous misses and preserve response fallbacks', { timeout: 10_000 }, async (t) => {
  await booted
  const { queryListRoutes } = await import('../src/routes/images/query-list.routes')
  const { MediaMetadataModel } = await import('../src/models/Image/MediaMetadataModel')
  const { ImageFileModel } = await import('../src/models/Image/ImageFileModel')
  const { ImageSafetyService } = await import('../src/services/imageSafetyService')
  const { MediaPostprocessVisibilityService } = await import('../src/services/mediaPostprocessVisibilityService')
  const hashes = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(48, '0'))
  t.mock.method(MediaMetadataModel, 'findByHashes', (requested) => requested
    .filter((hash) => hash !== hashes[5])
    .map((hash) => {
      const index = hashes.indexOf(hash)
      return {
        composite_hash: hash,
        thumbnail_path: index === 4 ? null : `batch-${index}${index === 1 || index === 3 ? '-missing' : ''}.webp`,
        rating_score: index === 6 ? 1 : 0,
      } as any
    }))
  t.mock.method(ImageFileModel, 'findActiveByHashes', (requested) => requested
    .filter((hash) => hash !== hashes[7])
    .map((hash) => ({
      composite_hash: hash,
      original_file_path: `original-${hash}`,
      mime_type: hash === hashes[2] || hash === hashes[3] ? 'video/mp4' : 'image/png',
    } as any)))
  t.mock.method(ImageSafetyService, 'isHidden', (score) => score === 1)
  t.mock.method(MediaPostprocessVisibilityService, 'isReadyRecord', (metadata) => metadata.composite_hash !== hashes[8])

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  t.after(() => release())
  let waveStarted!: () => void
  const firstWave = new Promise<void>((resolve) => { waveStarted = resolve })
  let active = 0
  let peakActive = 0
  let checks = 0
  t.mock.method(fs, 'existsSync', () => { throw new Error('synchronous existence check') })
  t.mock.method(fs.promises, 'access', async (filePath) => {
    checks++
    active++
    peakActive = Math.max(peakActive, active)
    if (active === 16) waveStarted()
    try {
      await gate
      if (String(filePath).endsWith('-missing.webp')) throw new Error('missing')
    } finally {
      active--
    }
  })

  const route = (queryListRoutes as any).stack.find((layer: any) => layer.route?.path === '/batch/thumbnails').route
  const request = () => new Promise<any>((resolve, reject) => {
    route.stack[0].handle({ query: { hashes: hashes.join(',') } }, { json: resolve }, reject)
  })
  const firstRequest = request()
  const secondRequest = request()
  await firstWave
  assert.equal(active, 16)
  release()
  const [first, second] = await Promise.all([firstRequest, secondRequest])

  assert.equal(peakActive, 16)
  assert.equal(checks, 27, 'concurrent requests share each distinct thumbnail check')
  assert.deepEqual(second, first)
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, 'the response contains resolved JSON values')
  assert.equal(first.success, true)
  assert.deepEqual(first.data[hashes[0]], { success: true, thumbnailPath: 'batch-0.webp', mimeType: 'image/webp' })
  assert.deepEqual(first.data[hashes[1]], { success: true, thumbnailPath: `original-${hashes[1]}`, mimeType: 'image/webp' })
  assert.deepEqual(first.data[hashes[2]], { success: true, thumbnailPath: 'batch-2.webp', mimeType: 'image/webp' })
  assert.deepEqual(first.data[hashes[3]], { success: true, thumbnailPath: `original-${hashes[3]}`, mimeType: 'video/mp4' })
  assert.deepEqual(first.data[hashes[4]], { success: true, thumbnailPath: `original-${hashes[4]}`, mimeType: 'image/webp' })
  assert.deepEqual(first.data[hashes[5]], { success: false, error: 'Not found' })
  assert.deepEqual(first.data[hashes[6]], { success: false, error: 'Hidden by safety policy' })
  assert.deepEqual(first.data[hashes[7]], { success: false, error: 'File not found' })
  assert.deepEqual(first.data[hashes[8]], { success: false, error: 'Not found' })
  assert.deepEqual(await request(), first)
  assert.equal(checks, 27, 'positive and negative cache hits avoid another check')
})

test('full rescan reconciles only its unchanged baseline and serializes watcher scans', { timeout: 30_000 }, async (t) => {
  const { db, runtimePaths } = await booted
  const { FolderScanService } = await import('../src/services/folderScan')
  const { FileDiscoveryService } = await import('../src/services/folderScan/fileDiscoveryService')
  const { FastRegistrationService } = await import('../src/services/folderScan/fastRegistrationService')
  const { BackgroundProcessorService } = await import('../src/services/backgroundProcessorService')
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const missing = path.join(runtimePaths.uploadsDir, 'scan-missing.png')
  const changed = path.join(runtimePaths.uploadsDir, 'scan-changed.png')
  const external = path.join(runtimePaths.uploadsDir, 'scan-external.png')
  const watched = path.join(runtimePaths.uploadsDir, 'scan-watched.png')
  const unchanged = path.join(runtimePaths.uploadsDir, 'scan-unchanged.png')
  fs.mkdirSync(runtimePaths.uploadsDir, { recursive: true })
  t.after(() => {
    db.prepare('DELETE FROM image_files WHERE original_file_path IN (?, ?, ?, ?, ?)').run(missing, changed, external, watched, unchanged)
    for (const file of [watched, unchanged]) fs.rmSync(file, { force: true })
  })
  insertFile(db, null, missing)
  const changedId = insertFile(db, null, changed)
  const unchangedId = insertFile(db, null, unchanged)
  const mtime = new Date('2020-01-01T00:00:00.000Z')
  db.prepare("UPDATE image_files SET file_modified_date = ?, last_verified_date = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(mtime.toISOString(), unchangedId)

  let discovered!: () => void
  const discoveryStarted = new Promise<void>((resolve) => { discovered = resolve })
  let resume!: () => void
  const discoveryMayFinish = new Promise<void>((resolve) => { resume = resolve })
  t.mock.method(FileDiscoveryService, 'collectFiles', async () => {
    discovered()
    await discoveryMayFinish
    return []
  })
  t.mock.method(BackgroundProcessorService, 'triggerHashGeneration', () => {})

  const fullScan = FolderScanService.scanFolder(folderId, true)
  await Promise.race([discoveryStarted, fullScan.then(() => { throw new Error('scan finished before discovery') })])
  writeFile(watched)
  const watcherScan = FolderScanService.scanFolder(folderId, false, { candidateFiles: [watched], quietIfNoChanges: true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(db.prepare('SELECT id FROM image_files WHERE original_file_path = ?').get(watched), undefined)
  insertFile(db, null, external)
  db.prepare("UPDATE image_files SET last_verified_date = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(changedId)
  writeFile(unchanged, 'x', mtime)
  const result = { folderId, totalScanned: 0, newImages: 0, existingImages: 0, updatedPaths: 0, missingImages: 0, errors: [], duration: 0, thumbnailsGenerated: 0, backgroundTasks: 0 }
  await FastRegistrationService.processFastRegistration([unchanged], folderId, result, { quietIfIdle: true, verifyUnchanged: true })
  await FastRegistrationService.processFastRegistration([unchanged], folderId, result, { quietIfIdle: true, verifyUnchanged: true })
  const verified = (db.prepare('SELECT last_verified_date FROM image_files WHERE id = ?').get(unchangedId) as { last_verified_date: string }).last_verified_date
  assert.equal(verified, '2099-01-01T00:00:00.002Z', 'repeated verifications cannot restore the baseline revision')
  resume()
  const fullResult = await fullScan
  await watcherScan

  const status = (file: string) => (db.prepare('SELECT file_status FROM image_files WHERE original_file_path = ?').get(file) as { file_status: string }).file_status
  assert.equal(fullResult.missingImages, 1)
  assert.equal(status(missing), 'missing', 'an unchanged genuinely absent row is reconciled')
  assert.equal(status(changed), 'active', 'a row changed after the baseline is not reconciled')
  assert.equal(status(external), 'active', 'a row registered after the baseline is not reconciled')
  assert.equal(status(unchanged), 'active', 'an unchanged watcher verification from another process protects its row')
  assert.equal(status(watched), 'active', 'the queued watcher scan registers its newly created file')
})

test('concurrent thumbnail generation publishes once, cleans failed output and recovers after temp cleanup', async (t) => {
  const { runtimePaths } = await booted
  const { ThumbnailGenerator } = await import('../src/utils/thumbnailGenerator')
  const { ImageProcessor } = await import('../src/services/imageProcessor')
  const hash = hex('c1')
  let started!: () => void
  const start = new Promise<void>((resolve) => { started = resolve })
  let finish!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  const render = t.mock.method(ImageProcessor, 'generateThumbnail', async (_input: string, output: string) => {
    await fs.promises.writeFile(output, 'partial')
    started()
    await done
    await fs.promises.writeFile(output, 'complete')
  })
  const requests = Array.from({ length: 12 }, () => ThumbnailGenerator.generateThumbnail('unused', hash))
  await start
  const directory = path.join(runtimePaths.tempDir, 'thumbnails', new Date().toISOString().slice(0, 10))
  const published = path.join(directory, `${hash}.webp`)
  assert.equal(fs.existsSync(published), false, 'an unfinished file is never visible at the public thumbnail path')
  assert.equal(render.mock.callCount(), 1, '12 requests share one decode')
  finish()
  const paths = await Promise.all(requests)
  assert.equal(new Set(paths).size, 1)
  assert.equal(fs.readFileSync(published, 'utf8'), 'complete')
  assert.equal(fs.readdirSync(directory).length, 1, 'no staging files remain')

  await fs.promises.unlink(published)
  await fs.promises.rmdir(directory)
  render.mock.mockImplementation(async (_input: string, output: string) => {
    await fs.promises.writeFile(output, 'partial')
    throw new Error('decode failed')
  })
  await assert.rejects(ThumbnailGenerator.generateThumbnail('unused', hash), /decode failed/)
  assert.deepEqual(fs.readdirSync(directory), [], 'a failure cannot poison the thumbnail cache')
  render.mock.mockImplementation(async (_input: string, output: string) => { await fs.promises.writeFile(output, 'retry') })
  await ThumbnailGenerator.generateThumbnail('unused', hash)
  assert.equal(fs.readFileSync(published, 'utf8'), 'retry', 'failed work is released for retry')
  await fs.promises.unlink(published)
  t.diagnostic('12 simultaneous requests: 1 renderer invocation; incomplete and failed files never published')
})

test('deleting an image removes its thumbnail and every file row', async () => {
  const { db, runtimePaths } = await booted
  const { DeletionService } = await import('../src/services/deletionService')
  const hash = hex('a1')
  const original = writeFile(path.join(runtimePaths.uploadsDir, 'images', 'delete-me.png'))
  const relativeThumb = `thumbnails\\2026-01-01\\${hash}.webp`
  const thumbnail = writeFile(path.join(runtimePaths.tempDir, 'thumbnails', '2026-01-01', `${hash}.webp`))

  insertMetadata(db, hash, { thumbnail: relativeThumb })
  insertFile(db, hash, original)
  insertFile(db, hash, path.join(root, 'gone-copy.png'), 'missing')

  assert.equal(await DeletionService.deleteImage(hash), true)
  assert.equal(fs.existsSync(thumbnail), false, 'thumbnail deleted')
  assert.equal(fs.existsSync(original), false, 'original moved away')
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM image_files WHERE composite_hash = ? OR original_file_path = ?').get(hash, original) as { c: number }).c, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM image_files WHERE composite_hash IS NULL').get() as { c: number }).c, 0, 'no NULL-hash rows left behind')
  assert.equal(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(hash), undefined)
})

test('orphan cleanup: dry run only counts, real run keeps referenced rows', async () => {
  const { db, userDb, runtimePaths } = await booted
  const { runMediaOrphanCleanup } = await import('../src/services/maintenance/mediaOrphanCleanupService')
  const { fileStoreIncoming } = await import('../src/services/fileStorePaths')
  const thumbDir = path.join(runtimePaths.tempDir, 'thumbnails', '2025-01-01')

  const orphan = hex('b1')
  const groupKept = hex('b2')
  const userKept = hex('b3', 32)
  const recentOrphan = hex('b4')
  const withFile = hex('b5')
  const revisionKept = hex('b6')

  const orphanThumb = writeFile(path.join(thumbDir, `${orphan}.webp`), 'x', OLD)
  insertMetadata(db, orphan, { thumbnail: `thumbnails/2025-01-01/${orphan}.webp` })
  insertMetadata(db, groupKept)
  const groupId = (db.prepare('SELECT id FROM groups ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type) VALUES (?, ?, 'manual')").run(groupId, groupKept)
  insertMetadata(db, userKept)
  userDb.prepare('INSERT INTO user_preferences (key, value) VALUES (?, ?)').run('test_media_ref', JSON.stringify({ avatar: userKept.toUpperCase() }))
  insertMetadata(db, recentOrphan, { updated: new Date().toISOString().replace('T', ' ').slice(0, 19) })
  insertMetadata(db, withFile)
  insertFile(db, withFile, path.join(root, 'present.png'))
  insertMetadata(db, revisionKept)
  db.prepare(`
    INSERT INTO image_metadata_edit_revisions (composite_hash, previous_file_path, replacement_file_path, recycle_bin_path)
    VALUES (?, 'a', 'b', 'c')
  `).run(revisionKept)

  const staleMissing = insertFile(db, null, path.join(root, 'stale-missing.png'), 'missing', '2000-01-01 00:00:00')
  const freshMissing = insertFile(db, null, path.join(root, 'fresh-missing.png'), 'missing', new Date().toISOString().replace('T', ' ').slice(0, 19))

  const strayThumb = writeFile(path.join(thumbDir, `${hex('c1')}.webp`), 'stray', OLD)
  const freshStrayThumb = writeFile(path.join(thumbDir, `${hex('c2')}.webp`), 'fresh')
  const referencedThumb = writeFile(path.join(runtimePaths.tempDir, 'thumbnails', '2025-01-02', `${withFile}.webp`), 'x', OLD)
  db.prepare('UPDATE media_metadata SET thumbnail_path = ? WHERE composite_hash = ?').run(`thumbnails\\2025-01-02\\${withFile}.webp`, withFile)

  const emptyExecution = path.join(runtimePaths.tempDir, 'graph-executions', '987', 'system-inputs')
  fs.mkdirSync(emptyExecution, { recursive: true })
  fs.utimesSync(emptyExecution, OLD, OLD)
  fs.utimesSync(path.dirname(emptyExecution), OLD, OLD)
  const busyExecution = writeFile(path.join(runtimePaths.tempDir, 'graph-executions', '988', 'out.png'), 'x', OLD)
  const staleIncoming = writeFile(path.join(fileStoreIncoming, 'upload.part'), 'xx', OLD)
  const freshIncoming = writeFile(path.join(fileStoreIncoming, 'live.part'), 'xx')
  const staleFrame = writeFile(path.join(runtimePaths.tempDir, 'video_frames', 'frame.png'), 'xxx', OLD)

  const dry = await runMediaOrphanCleanup({ dryRun: true })
  assert.equal(dry.missingFiles.matched, 1)
  assert.equal(dry.missingFiles.deleted, 0)
  assert.equal(dry.orphanMetadata.candidates, 4, 'orphan + 3 referenced, not the recent one or the one with a file')
  assert.equal(dry.orphanMetadata.keptReferenced, 3)
  assert.equal(dry.orphanMetadata.deleted, 1)
  assert.equal(dry.orphanThumbnails.orphaned, 1, 'only the old stray thumbnail')
  assert.equal(dry.tempLeftovers.graphExecutionDirs, 1)
  assert.equal(dry.tempLeftovers.incomingEntries, 1)
  assert.equal(dry.tempLeftovers.videoFrames, 1)
  assert.ok(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(orphan), 'dry run deleted nothing')
  assert.ok(db.prepare('SELECT 1 FROM image_files WHERE id = ?').get(staleMissing))
  for (const file of [orphanThumb, strayThumb, staleIncoming, staleFrame]) assert.ok(fs.existsSync(file))
  assert.ok(fs.existsSync(emptyExecution))

  const real = await runMediaOrphanCleanup({ dryRun: false })
  assert.equal(real.missingFiles.deleted, 1)
  assert.equal(real.orphanMetadata.deleted, 1)
  assert.equal(real.orphanMetadata.thumbnailsDeleted, 1)
  assert.equal(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(orphan), undefined)
  for (const kept of [groupKept, userKept, recentOrphan, withFile, revisionKept]) {
    assert.ok(db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?').get(kept), `${kept.slice(0, 4)} kept`)
  }
  assert.equal(db.prepare('SELECT 1 FROM image_files WHERE id = ?').get(staleMissing), undefined)
  assert.ok(db.prepare('SELECT 1 FROM image_files WHERE id = ?').get(freshMissing))

  assert.equal(fs.existsSync(orphanThumb), false)
  assert.equal(fs.existsSync(strayThumb), false)
  assert.ok(fs.existsSync(freshStrayThumb), 'thumbnail inside the grace window kept')
  assert.ok(fs.existsSync(referencedThumb), 'referenced thumbnail (stored with backslashes) kept')
  assert.equal(fs.existsSync(path.dirname(emptyExecution)), false)
  assert.ok(fs.existsSync(busyExecution))
  assert.equal(fs.existsSync(staleIncoming), false)
  assert.ok(fs.existsSync(freshIncoming))
  assert.equal(fs.existsSync(staleFrame), false)
})

test('PRAGMA optimize runs on the live connections without throwing', async () => {
  const { db, userDb } = await booted
  const { optimizeSqliteConnection } = await import('../src/services/maintenance/databaseMaintenanceScheduler')
  for (const [connection, label] of [[db, 'images.db'], [userDb, 'user.db']] as const) {
    const ms = optimizeSqliteConnection(connection, label)
    assert.ok(Number.isFinite(ms) && ms >= 0)
  }
})

test('database backup writes openable copies and keeps only the newest N stamped folders', async () => {
  await booted
  const { runDatabaseBackup, listDatabaseBackups } = await import('../src/services/maintenance/databaseBackupService')
  const backupRoot = path.join(root, 'backup-test')
  fs.mkdirSync(path.join(backupRoot, 'images.before-manual-copy'), { recursive: true })

  const base = new Date(2026, 9, 8, 12, 0, 0)
  let last
  for (let i = 0; i < 3; i++) {
    last = await runDatabaseBackup({ root: backupRoot, keep: 2, now: new Date(base.getTime() + i * 60_000) })
  }

  assert.deepEqual(last!.files.map((file) => file.fileName).sort(), ['auth.db', 'images.db', 'user.db'])
  for (const file of last!.files) {
    const copy = new Database(path.join(last!.path, file.fileName), { readonly: true })
    try {
      const tables = (copy.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get() as { c: number }).c
      assert.ok(tables > 0, `${file.fileName} has tables`)
      assert.equal((copy.pragma('integrity_check', { simple: true }) as string), 'ok')
    } finally {
      copy.close()
    }
  }

  const backups = listDatabaseBackups(backupRoot)
  assert.deepEqual(backups.map((backup) => backup.name), ['20261008-120200', '20261008-120100'])
  assert.ok(fs.existsSync(path.join(backupRoot, 'images.before-manual-copy')), 'hand-made copies are never pruned')
  assert.equal(fs.readdirSync(backupRoot).some((name) => name.endsWith('.partial')), false)
})
