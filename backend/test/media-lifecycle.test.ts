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
