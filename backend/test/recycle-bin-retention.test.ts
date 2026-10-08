import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * RecycleBin retention: off by default, deletes only top-level files older than the cutoff (recorded deletion time,
 * else the bin-name timestamp), never folders, links or undated files, and prunes stale origins and previews.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-recycle-retention-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-08T12:00:00.000Z')

function write(filePath: string, content = 'x', mtime?: Date) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  if (mtime) fs.utimesSync(filePath, mtime, mtime)
  return filePath
}

/** Legacy-format bin name carrying its deletion time. */
const legacyName = (date: Date, name: string) => `${date.toISOString().replace(/[:.]/g, '-')}_${name}`

test('RecycleBin retention is off by default and deletes only old top-level files', { timeout: 60000 }, async (t) => {
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { settingsService } = await import('../src/services/settingsService')
  const recycle = await import('../src/utils/recycleBin')
  const { runRecycleBinRetention } = await import('../src/services/maintenance/recycleBinRetentionService')
  const { DatabaseMaintenanceScheduler } = await import('../src/services/maintenance/databaseMaintenanceScheduler')
  const { RuntimeJobRunner } = await import('../src/services/runtimeJobs/runtimeJobRunner')
  t.after(async () => {
    user.closeUserSettingsDb()
    assert.ok(path.basename(root).startsWith('conai-recycle-retention-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  // Default: off — the setting is 0 and the scheduler starts no job.
  assert.equal(settingsService.loadSettings().general.deleteProtection.recycleBinRetentionDays, 0)
  const started: unknown[] = []
  const originalStart = RuntimeJobRunner.start
  RuntimeJobRunner.start = ((...args: unknown[]) => { started.push(args); return {} }) as typeof RuntimeJobRunner.start
  t.after(() => { RuntimeJobRunner.start = originalStart })
  await DatabaseMaintenanceScheduler.runRecycleBinRetentionIfEnabled()
  assert.equal(started.length, 0)
  const skipped = await runRecycleBinRetention({ retentionDays: 0, now: NOW })
  assert.equal(skipped.skipped, true)

  const bin = recycle.RECYCLE_BIN_PATH
  // Recorded origins: one old, one recent. Both names carry today's timestamp, so the recorded time must win.
  const recordedOld = await recycle.deleteFile(write(path.join(root, 'uploads', 'old.png')), true, 'library')
  const recordedNew = await recycle.deleteFile(write(path.join(root, 'uploads', 'new.png')), true, 'library')
  assert.ok(recordedOld && recordedNew)
  const userDb = user.getUserSettingsDb()
  userDb.prepare('UPDATE recycle_bin_entries SET deleted_at = ? WHERE bin_name = ?')
    .run(new Date(NOW.getTime() - 40 * DAY).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''), path.basename(recordedOld))
  userDb.prepare('UPDATE recycle_bin_entries SET deleted_at = ? WHERE bin_name = ?')
    .run(new Date(NOW.getTime() - 2 * DAY).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''), path.basename(recordedNew))
  // Legacy files without a record: dated by the name only.
  const legacyOld = write(path.join(bin, legacyName(new Date(NOW.getTime() - 31 * DAY), 'legacy-old.png')))
  const legacyNew = write(path.join(bin, legacyName(new Date(NOW.getTime() - 29 * DAY), 'legacy-new.png')))
  const undated = write(path.join(bin, 'ComfyUI_00001_.png'), 'x', new Date(NOW.getTime() - 400 * DAY))
  // Folders and anything inside them are never touched.
  const folder = path.join(bin, legacyName(new Date(NOW.getTime() - 400 * DAY), 'folder'))
  const nested = write(path.join(folder, 'inside.png'))
  // A link pointing outside the bin is never followed or removed.
  const outside = write(path.join(root, 'outside', 'keep.png'))
  const link = path.join(bin, legacyName(new Date(NOW.getTime() - 400 * DAY), 'link.png'))
  let linked = true
  try { fs.symlinkSync(outside, link, 'file') } catch { linked = false }
  // A stale origin record whose file is already gone.
  userDb.prepare('INSERT INTO recycle_bin_entries (bin_name, original_path, size, source) VALUES (?, ?, ?, ?)').run('ghost.png', path.join(root, 'ghost.png'), 1, 'library')
  // Previews: one stale, one fresh.
  const previews = path.join(root, 'previews')
  const stalePreview = write(path.join(previews, 'stale.webp'), 'x', new Date(NOW.getTime() - 60 * DAY))
  const freshPreview = write(path.join(previews, 'fresh.webp'), 'x', new Date(NOW.getTime() - DAY))

  const result = await runRecycleBinRetention({ retentionDays: 30, now: NOW, previewDirectory: previews })

  assert.equal(fs.existsSync(recordedOld), false, 'recorded old file is deleted')
  assert.equal(fs.existsSync(recordedNew), true, 'recorded recent file stays')
  assert.equal(fs.existsSync(legacyOld), false, 'legacy old file is deleted by its name timestamp')
  assert.equal(fs.existsSync(legacyNew), true, 'legacy recent file stays')
  assert.equal(fs.existsSync(undated), true, 'undated file stays')
  assert.equal(fs.existsSync(nested), true, 'folders are untouched')
  if (linked) {
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'links are untouched')
    assert.equal(fs.existsSync(outside), true)
  }
  assert.equal(result.deletedFiles, 2)
  assert.equal(result.undatedFiles, 1)
  assert.equal(result.deletedPreviews, 1)
  assert.equal(fs.existsSync(stalePreview), false)
  assert.equal(fs.existsSync(freshPreview), true)

  const records = (userDb.prepare('SELECT bin_name FROM recycle_bin_entries').all() as Array<{ bin_name: string }>).map((row) => row.bin_name)
  assert.deepEqual(records, [path.basename(recordedNew)], 'only the surviving file keeps its origin')

  // Turned on, the scheduler starts the job with the configured days.
  settingsService.updateGeneralSettings({ deleteProtection: { enabled: true, recycleBinRetentionDays: 14 } })
  await DatabaseMaintenanceScheduler.runRecycleBinRetentionIfEnabled()
  assert.equal(started.length, 1)
  assert.deepEqual((started[0] as unknown[]).slice(0, 2), ['recycle-bin-retention', { retentionDays: 14 }])
})

test('legacy recycleBinPath values are accepted and dropped', async () => {
  const { mergeLoadedSettingsWithDefaults, getDefaultSettingsFromEnvironment } = await import('../src/services/settingsServiceStorage')
  const { applyGeneralSettingsUpdate } = await import('../src/services/settingsServiceUpdates')
  const defaults = getDefaultSettingsFromEnvironment()
  const merged = mergeLoadedSettingsWithDefaults({ general: { deleteProtection: { enabled: false, recycleBinPath: 'D:/Elsewhere' } } }, defaults)
  assert.deepEqual(merged.general.deleteProtection, { enabled: false, recycleBinRetentionDays: 0 })
  const updated = applyGeneralSettingsUpdate(merged, { deleteProtection: { recycleBinPath: 'X', recycleBinRetentionDays: 30 } as never })
  assert.deepEqual(updated.general.deleteProtection, { enabled: false, recycleBinRetentionDays: 30 })
  const invalid = mergeLoadedSettingsWithDefaults({ general: { deleteProtection: { enabled: true, recycleBinRetentionDays: -5 } } }, defaults)
  assert.equal(invalid.general.deleteProtection.recycleBinRetentionDays, 0)
})
