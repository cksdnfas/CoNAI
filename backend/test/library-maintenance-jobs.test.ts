import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type Database from 'better-sqlite3'

/**
 * Whole-library maintenance as paged runtime jobs: auto-tag reset / rating recalculation / batch tagging / tag
 * collection sync, prompt similarity rebuild, auto-tag state recompute, file verification, auto-folder rebuild,
 * group auto-collect and group bulk add/remove. Each pass must page (several yields, one page per transaction),
 * stop cleanly at a page boundary when cancelled, and end in the same state the old one-shot code produced.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-library-jobs-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}
process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

const PAGE = 500
const hashOf = (prefix: string, n: number) => `${prefix}${String(n).padStart(48 - prefix.length, '0')}`

async function boot() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  ;(await import('../src/services/runtimeJobs')).registerRuntimeJobHandlers()
  const { runtimePaths } = await import('../src/config/runtimePaths')
  return { db: main.db, auth: authModule.getAuthDb(), runtimePaths }
}

const booted = boot()

function writeFile(filePath: string, content = 'x'): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return filePath
}

function folderId(db: Database.Database, folderPath?: string): number {
  if (!folderPath) {
    return (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  }
  const existing = db.prepare('SELECT id FROM watched_folders WHERE folder_path = ?').get(folderPath) as { id: number } | undefined
  if (existing) return existing.id
  return Number(db.prepare(`INSERT INTO watched_folders (folder_path, folder_name, auto_scan, recursive, is_active, watcher_enabled)
    VALUES (?, ?, 0, 1, 1, 0)`).run(folderPath, path.basename(folderPath)).lastInsertRowid)
}

function autoTagsJson(n: number, withRating = true): string {
  return JSON.stringify({
    version: 2,
    tagger: {
      taglist: `tag_${n % 7}, tag_${n % 5}`,
      general: { [`tag_${n % 7}`]: 0.9, [`tag_${n % 5}`]: 0.6 },
      character: {},
      ...(withRating ? { rating: { general: 0.6, sensitive: 0.3, questionable: (n % 10) / 100, explicit: 0.01 } } : {}),
    },
    kaloscope: { artists: { [`artist_${n % 3}`]: 0.05 }, taglist: `artist_${n % 3}` },
  })
}

function insertMedia(db: Database.Database, hash: string, fields: Record<string, unknown> = {}) {
  const columns = ['composite_hash', ...Object.keys(fields)]
  db.prepare(`INSERT INTO media_metadata (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(hash, ...Object.values(fields))
}

function insertFile(db: Database.Database, hash: string | null, filePath: string, options: { folder?: number; type?: string; verified?: string } = {}) {
  return Number(db.prepare(`
    INSERT INTO image_files (composite_hash, file_type, original_file_path, folder_id, file_status, file_size, mime_type, last_verified_date)
    VALUES (?, ?, ?, ?, 'active', 1, ?, ?)
  `).run(hash, options.type ?? 'image', filePath, options.folder ?? folderId(db), options.type === 'video' ? 'video/mp4' : 'image/png',
    options.verified ?? '2000-01-01 00:00:00').lastInsertRowid)
}

function countingHooks(cancelAfterChecks = Infinity) {
  const state = { yields: 0, checks: 0, progress: [] as number[] }
  return {
    state,
    hooks: {
      yield: async () => { state.yields++; await new Promise<void>((resolve) => setImmediate(resolve)) },
      throwIfCancelled: () => { if (++state.checks > cancelAfterChecks) throw new Error('cancelled by test') },
      progress: (processed: number) => { state.progress.push(processed) },
    },
  }
}

test('auto-tag reset clears every page and the tag index, one page per transaction', async () => {
  const { db } = await booted
  const { AutoTagIndexService } = await import('../src/services/autoTagIndexService')
  const { resetAllAutoTags } = await import('../src/services/maintenance/autoTagMaintenanceService')
  for (let n = 0; n < 1203; n++) insertMedia(db, hashOf('r', n), { auto_tags: autoTagsJson(n), auto_tag_state: 'done' })
  for (let n = 0; n < 40; n++) AutoTagIndexService.syncForHash(hashOf('r', n), autoTagsJson(n))
  assert.ok((db.prepare('SELECT COUNT(*) c FROM media_auto_tags').get() as { c: number }).c > 0)

  const { state, hooks } = countingHooks()
  const result = await resetAllAutoTags(hooks)

  assert.equal(result.changes, 1203)
  assert.equal((db.prepare("SELECT COUNT(*) c FROM media_metadata WHERE composite_hash LIKE 'r%' AND auto_tags IS NOT NULL").get() as { c: number }).c, 0)
  assert.equal((db.prepare('SELECT COUNT(*) c FROM media_auto_tags').get() as { c: number }).c, 0)
  assert.equal((db.prepare('SELECT COUNT(*) c FROM auto_tag_terms').get() as { c: number }).c, 0)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'the truncating index clear turns foreign keys back on')
  assert.equal((db.prepare("SELECT COUNT(*) c FROM media_metadata WHERE composite_hash LIKE 'r%' AND auto_tag_state = 'pending'").get() as { c: number }).c, 1203,
    'the auto-tag state trigger queues every reset row for the scheduler')
  assert.ok(state.yields >= 3, `yielded between pages (${state.yields})`)
  assert.deepEqual(state.progress.slice(-1), [1203])
})

test('auto-tag reset stops at a page boundary when cancelled', async () => {
  const { db } = await booted
  const { resetAllAutoTags } = await import('../src/services/maintenance/autoTagMaintenanceService')
  db.prepare("UPDATE media_metadata SET auto_tags = '{\"version\":2}' WHERE composite_hash LIKE 'r%'").run()
  const { hooks } = countingHooks(1)
  await assert.rejects(resetAllAutoTags(hooks), /cancelled by test/)
  assert.equal((db.prepare("SELECT COUNT(*) c FROM media_metadata WHERE composite_hash LIKE 'r%' AND auto_tags IS NULL").get() as { c: number }).c, PAGE)
  db.prepare("UPDATE media_metadata SET auto_tags = NULL WHERE composite_hash LIKE 'r%'").run()
})

test('rating recalculation gives each row the per-row score and clears rows without rating data', async () => {
  const { db } = await booted
  const { recalculateAllRatingScores } = await import('../src/services/maintenance/autoTagMaintenanceService')
  const { RatingScoreService } = await import('../src/services/ratingScoreService')
  for (let n = 0; n < 1100; n++) {
    // Malformed JSON cannot be stored at all (the auto-tag expression indexes reject it), so every row parses.
    insertMedia(db, hashOf('s', n), { auto_tags: autoTagsJson(n, n % 9 !== 0), rating_score: 7 })
  }

  const { state, hooks } = countingHooks()
  const result = await recalculateAllRatingScores(hooks)
  assert.equal(result.fail_count, 0)
  assert.equal(result.success_count, 1100)
  assert.ok(state.yields >= 3)

  for (const n of [1, 9, 50, 77, 499, 500, 1099]) {
    const row = db.prepare('SELECT rating_score FROM media_metadata WHERE composite_hash = ?').get(hashOf('s', n)) as { rating_score: number | null }
    if (n % 9 === 0) {
      assert.equal(row.rating_score, null, 'no rating data clears the score')
    } else {
      const rating = JSON.parse(autoTagsJson(n)).tagger.rating
      assert.equal(row.rating_score, (await RatingScoreService.calculateScore(rating)).score)
    }
  }
})

test('batch tagging walks newest first, honours the limit and sorts undated rows last', async () => {
  const { db, runtimePaths } = await booted
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  const { batchTagLibrary } = await import('../src/services/maintenance/autoTagMaintenanceService')
  const tagged: string[] = []
  const original = imageTaggerService.tagImage
  imageTaggerService.tagImage = (async (imagePath: string) => {
    tagged.push(path.basename(imagePath, '.png'))
    return { success: true, caption: 'a', taglist: 'a', general: { a: 0.9 }, character: {}, rating: { general: 0.9, sensitive: 0.1, questionable: 0, explicit: 0 } }
  }) as typeof imageTaggerService.tagImage
  try {
    const dates = ['2031-01-03 00:00:00', '2031-01-01 00:00:00', '2031-01-02 00:00:00', '2031-01-02 00:00:00', null]
    dates.forEach((date, n) => {
      const hash = hashOf('t', n)
      insertMedia(db, hash, { first_seen_date: date })
      insertFile(db, hash, writeFile(path.join(runtimePaths.uploadsDir, 'tag', `${hash}.png`)))
    })
    db.prepare("UPDATE media_metadata SET first_seen_date = '2031-01-02 00:00:00' WHERE composite_hash = ?").run(hashOf('t', 3))
    db.prepare('UPDATE media_metadata SET first_seen_date = NULL WHERE composite_hash = ?').run(hashOf('t', 4))

    const limited = await batchTagLibrary({ limit: 3 })
    assert.deepEqual(limited, { total: 3, success_count: 3, fail_count: 0 })
    assert.deepEqual(tagged, [hashOf('t', 0), hashOf('t', 3), hashOf('t', 2)], 'date DESC, then composite_hash DESC')
    assert.ok((db.prepare('SELECT auto_tags FROM media_metadata WHERE composite_hash = ?').get(hashOf('t', 0)) as { auto_tags: string }).auto_tags)

    tagged.length = 0
    const everything = await batchTagLibrary({ limit: null })
    assert.equal(everything.total, (db.prepare('SELECT COUNT(*) c FROM media_metadata').get() as { c: number }).c)
    assert.equal(tagged[tagged.length - 1], hashOf('t', 4), 'the undated row comes last')
  } finally {
    imageTaggerService.tagImage = original
  }
})

test('auto-tag collection sync counts every tag occurrence like the one-shot sync', async () => {
  const { db } = await booted
  const { MaintenanceService } = await import('../src/services/maintenanceService')
  const expected = new Map<string, number>()
  for (const row of db.prepare('SELECT auto_tags FROM media_metadata WHERE auto_tags IS NOT NULL ORDER BY rowid').all() as Array<{ auto_tags: string }>) {
    try {
      for (const prompt of (MaintenanceService as any).extractAutoTagsPrompts(JSON.parse(row.auto_tags))) expected.set(prompt, (expected.get(prompt) ?? 0) + 1)
    } catch { /* unparseable rows are skipped by both */ }
  }

  const { state, hooks } = countingHooks()
  const result = await MaintenanceService.syncAutoTags(hooks)
  const actual = new Map((db.prepare('SELECT prompt, usage_count FROM auto_prompt_collection').all() as Array<{ prompt: string; usage_count: number }>)
    .map((row) => [row.prompt, row.usage_count]))
  assert.deepEqual(actual, expected)
  assert.equal(result.collected, [...expected.values()].reduce((sum, n) => sum + n, 0))
  assert.ok(state.yields >= 2)
})

test('prompt similarity rebuild writes every row page by page with the same fields', async () => {
  const { db } = await booted
  const { PromptSimilarityService } = await import('../src/services/promptSimilarityService')
  db.prepare("UPDATE media_metadata SET prompt = 'masterpiece, 1girl, ' || rowid, negative_prompt = 'lowres' WHERE composite_hash LIKE 's%'").run()
  const { state, hooks } = countingHooks()
  const result = await PromptSimilarityService.rebuildAll(hooks)
  const total = (db.prepare('SELECT COUNT(*) c FROM media_metadata').get() as { c: number }).c
  assert.equal(result.processed, total)
  assert.equal(result.updated, total)
  assert.ok(state.yields >= 3)

  const algorithm = PromptSimilarityService.getEffectiveSettings().algorithm
  for (const hash of [hashOf('s', 3), hashOf('s', 777), hashOf('r', 1)]) {
    const row = db.prepare('SELECT * FROM media_metadata WHERE composite_hash = ?').get(hash) as Record<string, unknown>
    const fields = (PromptSimilarityService as any).buildPreparedFields(row, algorithm)
    for (const key of ['prompt_similarity_algorithm', 'pos_prompt_normalized', 'neg_prompt_normalized', 'auto_prompt_normalized', 'pos_prompt_fingerprint', 'neg_prompt_fingerprint', 'auto_prompt_fingerprint']) {
      assert.equal(row[key], fields[key], key)
    }
  }
})

test('capability recompute runs in the background, in ranges, and records completion', async () => {
  const { db } = await booted
  const { AutoTagStateService } = await import('../src/services/autoTagStateService')
  for (let n = 0; n < 1200; n++) {
    const hash = hashOf('c', n)
    insertMedia(db, hash, { auto_tags: n % 3 === 0 ? null : n % 3 === 1 ? '{"tagger":{}}' : '{"kaloscope":{}}' })
    if (n % 4 !== 0) insertFile(db, hash, path.join(root, 'nowhere', `${hash}.png`))
  }
  db.prepare("UPDATE media_metadata SET auto_tag_state = 'done' WHERE composite_hash LIKE 'c%'").run()

  AutoTagStateService.syncCapabilityState({ taggerAutoEnabled: true, kaloscopeAutoEnabled: false })
  await AutoTagStateService.waitForCapabilitySync()

  for (let n = 0; n < 1200; n++) {
    const needsWork = n % 3 === 0 || n % 3 === 2
    const expected = needsWork && n % 4 !== 0 ? 'pending' : 'done'
    const row = db.prepare('SELECT auto_tag_state FROM media_metadata WHERE composite_hash = ?').get(hashOf('c', n)) as { auto_tag_state: string }
    assert.equal(row.auto_tag_state, expected, `row ${n}`)
  }
  assert.equal((db.prepare("SELECT value FROM system_settings WHERE key = 'auto_tag_state_synced_capabilities'").get() as { value: string }).value, '1:0')

  // Turning kaloscope on settles nothing and promotes the tagger-only rows.
  AutoTagStateService.syncCapabilityState({ taggerAutoEnabled: true, kaloscopeAutoEnabled: true })
  await AutoTagStateService.waitForCapabilitySync()
  const row = db.prepare('SELECT auto_tag_state FROM media_metadata WHERE composite_hash = ?').get(hashOf('c', 1)) as { auto_tag_state: string }
  assert.equal(row.auto_tag_state, 'pending')
  assert.equal((db.prepare("SELECT value FROM system_settings WHERE key = 'auto_tag_state_synced_capabilities'").get() as { value: string }).value, '1:1')
})

test('file verification keeps the old rules and applies one page per transaction', async () => {
  const { db, runtimePaths } = await booted
  const { FileVerificationService } = await import('../src/services/fileVerificationService')
  const dir = path.join(root, 'verify')
  // Thumbnails for everything that has an original keep the thumbnail-regeneration path out of this test.
  for (let n = 0; n < 1100; n++) {
    const hash = hashOf('v', n)
    const thumb = `thumbnails/2026-01-01/${hash}.webp`
    insertMedia(db, hash, { thumbnail_path: thumb })
    const isVideo = n % 10 === 0
    const filePath = path.join(dir, `${hash}.${isVideo ? 'mp4' : 'png'}`)
    if (n % 3 !== 0) writeFile(filePath)
    if (n % 3 !== 0 || n % 2 === 0) writeFile(path.join(runtimePaths.tempDir, thumb))
    insertFile(db, hash, filePath, { type: isVideo ? 'video' : 'image' })
  }

  const exists = (p: string | null) => Boolean(p) && fs.existsSync(path.isAbsolute(p as string) ? (p as string) : path.join(runtimePaths.tempDir, p as string))
  // Rows from earlier tests whose original exists but has no thumbnail would send sharp at a non-image; give them one.
  for (const row of db.prepare("SELECT f.composite_hash, f.original_file_path, m.thumbnail_path FROM image_files f JOIN media_metadata m ON m.composite_hash = f.composite_hash WHERE f.file_status = 'active'")
    .all() as Array<{ composite_hash: string; original_file_path: string; thumbnail_path: string | null }>) {
    if (exists(row.original_file_path) && !exists(row.thumbnail_path)) {
      const thumb = `thumbnails/2026-01-01/${row.composite_hash}.webp`
      writeFile(path.join(runtimePaths.tempDir, thumb))
      db.prepare('UPDATE media_metadata SET thumbnail_path = ? WHERE composite_hash = ?').run(thumb, row.composite_hash)
    }
  }

  const before = db.prepare("SELECT f.id, f.original_file_path, f.file_type, m.thumbnail_path FROM image_files f LEFT JOIN media_metadata m ON m.composite_hash = f.composite_hash WHERE f.file_status = 'active' ORDER BY f.id")
    .all() as Array<{ id: number; original_file_path: string; file_type: string; thumbnail_path: string | null }>
  const expectDeleted = new Set(before.filter((row) => !exists(row.original_file_path) && (row.file_type === 'video' || !exists(row.thumbnail_path))).map((row) => row.id))

  // Cancelled after the first page: exactly that page is applied.
  const cancelled = countingHooks(1)
  await assert.rejects(FileVerificationService.verifyAllFiles({ hooks: cancelled.hooks }), /cancelled by test/)
  const firstPage = new Set(before.slice(0, PAGE).map((row) => row.id))
  const remaining = new Set((db.prepare("SELECT id FROM image_files WHERE file_status = 'active'").all() as Array<{ id: number }>).map((row) => row.id))
  for (const row of before) {
    assert.equal(remaining.has(row.id), !(firstPage.has(row.id) && expectDeleted.has(row.id)), `row ${row.id} after cancel`)
  }

  db.prepare("UPDATE image_files SET last_verified_date = '2000-01-01 00:00:00'").run()
  const { state, hooks } = countingHooks()
  const result = await FileVerificationService.verifyAllFiles({ hooks })
  const left = new Set((db.prepare("SELECT id FROM image_files WHERE file_status = 'active'").all() as Array<{ id: number }>).map((row) => row.id))
  for (const row of before) assert.equal(left.has(row.id), !expectDeleted.has(row.id), `row ${row.id}`)
  assert.equal(result.errors.length, 0)
  assert.equal(result.totalChecked, remaining.size)
  assert.equal((db.prepare("SELECT COUNT(*) c FROM image_files WHERE last_verified_date = '2000-01-01 00:00:00'").get() as { c: number }).c, 0,
    'every kept row was marked verified')
  assert.ok(state.yields >= 3)
})

test('auto-folder rebuild applies only the differences and keeps unchanged group ids', async () => {
  const { db } = await booted
  const { AutoFolderGroupService } = await import('../src/services/autoFolderGroupService')
  const lib = path.join(root, 'lib')
  for (const sub of ['a', path.join('a', 'b'), 'c']) fs.mkdirSync(path.join(lib, sub), { recursive: true })
  const libId = folderId(db, lib)
  const place = (n: number, sub: string) => {
    const hash = hashOf('f', n)
    insertMedia(db, hash)
    return insertFile(db, hash, path.join(lib, sub, `${n}.png`), { folder: libId })
  }
  for (let n = 0; n < 700; n++) place(n, n % 3 === 0 ? 'a' : n % 3 === 1 ? path.join('a', 'b') : 'c')
  db.prepare("INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name, depth) VALUES ('legacy/x', 'x', 'x', 0)").run()

  const first = await AutoFolderGroupService.rebuildAllFolderGroups()
  assert.equal(first.success, true, first.error)
  const groups = () => new Map((db.prepare('SELECT id, folder_path, image_count, parent_id FROM auto_folder_groups').all() as Array<{ id: number; folder_path: string; image_count: number; parent_id: number | null }>)
    .map((row) => [row.folder_path, row]))
  const key = (sub = '') => (sub ? `watch:${libId}/${sub}` : `watch:${libId}`)
  const members = (sub: string) => (db.prepare('SELECT i.composite_hash FROM auto_folder_group_images i JOIN auto_folder_groups g ON g.id = i.group_id WHERE g.folder_path = ? ORDER BY 1')
    .all(key(sub)) as Array<{ composite_hash: string }>).map((row) => row.composite_hash)

  const before = groups()
  assert.equal(before.has('legacy/x'), false, 'legacy rows are removed')
  assert.equal(before.get(key('a'))?.image_count, 234)
  assert.equal(before.get(key('a/b'))?.parent_id, before.get(key('a'))?.id)
  assert.equal(members('c').length, 233)

  // Change the world: c disappears, one file moves a -> a/b, a new folder d appears with a file.
  fs.rmSync(path.join(lib, 'c'), { recursive: true })
  db.prepare("UPDATE image_files SET file_status = 'missing' WHERE original_file_path LIKE ?").run(`${path.join(lib, 'c')}%`)
  db.prepare('UPDATE image_files SET original_file_path = ? WHERE composite_hash = ?').run(path.join(lib, 'a', 'b', '0.png'), hashOf('f', 0))
  fs.mkdirSync(path.join(lib, 'd'))
  place(900, 'd')

  const second = await AutoFolderGroupService.rebuildAllFolderGroups()
  assert.equal(second.success, true, second.error)
  const after = groups()
  for (const sub of ['', 'a', 'a/b']) assert.equal(after.get(key(sub))?.id, before.get(key(sub))?.id, `group id kept for "${sub}"`)
  assert.equal(after.has(key('c')), false)
  assert.equal(after.get(key('d'))?.image_count, 1)
  assert.equal(after.get(key('a'))?.image_count, 233)
  assert.ok(members('a/b').includes(hashOf('f', 0)))
  assert.ok(!members('a').includes(hashOf('f', 0)))
})

test('auto-collect diff keeps manual members, drops stale auto ones and is idempotent', async () => {
  const { db } = await booted
  const { AutoCollectionService } = await import('../src/services/autoCollectionService')
  for (let n = 0; n < 1300; n++) insertMedia(db, hashOf('g', n), { prompt: n % 4 === 0 ? 'zebra, 1girl' : 'horse' })
  const legacyId = Number(db.prepare("INSERT INTO groups (name, auto_collect_enabled, auto_collect_conditions) VALUES ('legacy-zebra', 1, ?)")
    .run(JSON.stringify([{ type: 'prompt_contains', value: 'zebra' }])).lastInsertRowid)
  const complexId = Number(db.prepare("INSERT INTO groups (name, auto_collect_enabled, auto_collect_conditions) VALUES ('complex-zebra', 1, ?)")
    .run(JSON.stringify({ and_group: [{ category: 'positive_prompt', type: 'prompt_contains', value: 'zebra' }] })).lastInsertRowid)
  for (const groupId of [legacyId, complexId]) {
    db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type) VALUES (?, ?, 'manual')").run(groupId, hashOf('g', 1))
    db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type) VALUES (?, ?, 'auto')").run(groupId, hashOf('g', 2))
  }
  const zebras = (db.prepare("SELECT composite_hash FROM media_metadata WHERE prompt LIKE '%zebra%' ORDER BY 1").all() as Array<{ composite_hash: string }>).map((row) => row.composite_hash)

  for (const groupId of [legacyId, complexId]) {
    const result = await AutoCollectionService.runAutoCollectionForGroup(groupId)
    assert.equal(result.images_removed, 1)
    assert.equal(result.images_added, zebras.length)
    const auto = (db.prepare("SELECT composite_hash FROM image_groups WHERE group_id = ? AND collection_type = 'auto' ORDER BY 1").all(groupId) as Array<{ composite_hash: string }>).map((row) => row.composite_hash)
    assert.deepEqual(auto, zebras)
    assert.ok(db.prepare("SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ? AND collection_type = 'manual'").get(groupId, hashOf('g', 1)))
    const again = await AutoCollectionService.runAutoCollectionForGroup(groupId)
    assert.deepEqual([again.images_added, again.images_removed], [0, 0])
  }
})

test('bulk group add counts duplicates as skipped, converts auto rows and reports unknown hashes', async () => {
  const { db } = await booted
  const { ImageGroupModel } = await import('../src/models/Group')
  const groupId = Number(db.prepare("INSERT INTO groups (name) VALUES ('bulk')").run().lastInsertRowid)
  db.prepare("INSERT INTO image_groups (group_id, composite_hash, collection_type) VALUES (?, ?, 'auto')").run(groupId, hashOf('g', 5))
  const hashes = Array.from({ length: 1200 }, (_, n) => hashOf('g', n))
  const result = await ImageGroupModel.addImagesManuallyInPages(groupId, [...hashes, hashOf('g', 7), 'f'.repeat(48)])
  assert.deepEqual([result.addedCount, result.convertedCount, result.skippedCount, result.errors.length], [1199, 1, 1, 1])
  assert.match(result.errors[0], /^Image f{48}: /)
  const removed = await ImageGroupModel.removeImagesInPages(groupId, [...hashes.slice(0, 700), 'e'.repeat(48)])
  assert.deepEqual([removed.removedCount, removed.skippedCount, removed.errors.length], [700, 1, 0])
})

test('maintenance routes answer 202 with a job, and a cancelled job stops after one page', { timeout: 60000 }, async () => {
  const { db, auth } = await booted
  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const { RuntimeJobRunner } = await import('../src/services/runtimeJobs')
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  imageTaggerService.tagImage = (async () => ({ success: false, error: 'no tagger in tests' })) as typeof imageTaggerService.tagImage
  const app = express()
  app.use(express.json())
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('jobs-admin', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  ;(await import('../src/routes/auth-route-helpers')).invalidateConfiguredAuthCache()
  app.use((req, _res, next) => {
    Object.assign(req, { sessionID: 'jobs', session: { authenticated: true, accountId: adminId, accountType: 'admin' } })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, method = 'GET', body: unknown = {}) => {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() as any }
  }
  const finish = async (job: any) => {
    for (let i = 0; i < 400 && (job.status === 'queued' || job.status === 'running'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      job = (await call(`/api/jobs/${job.jobId}`)).body.data
    }
    return job
  }

  try {
    for (const [url, kind, body] of [
      ['/api/images/recalculate-rating-scores', 'rating-score-recalculate', {}],
      ['/api/images/batch-tag-all', 'auto-tag-batch-all', { limit: 2 }],
      ['/api/images/prompt-similarity/rebuild', 'prompt-similarity-rebuild', {}],
      ['/api/settings/maintenance/sync-tags', 'auto-tag-collection-sync', {}],
      ['/api/file-verification/verify', 'file-verification', {}],
      ['/api/images/reset-auto-tags', 'auto-tag-reset', {}],
    ] as const) {
      const started = await call(url, 'POST', body)
      assert.equal(started.status, 202, `${url}: ${JSON.stringify(started.body)}`)
      assert.equal(started.body.data.kind, kind)
      const job = await finish(started.body.data)
      assert.equal(job.status, 'completed', `${kind}: ${job.failureMessage ?? ''}`)
    }

    db.prepare("UPDATE media_metadata SET auto_tags = '{\"version\":2}' WHERE composite_hash LIKE 'g%'").run()
    const tagged = (db.prepare('SELECT COUNT(*) c FROM media_metadata WHERE auto_tags IS NOT NULL').get() as { c: number }).c
    assert.ok(tagged > PAGE)
    // start() runs the first page synchronously up to its first yield; cancelling right away stops at that boundary.
    const job = RuntimeJobRunner.start('auto-tag-reset', {})
    RuntimeJobRunner.cancel(job.jobId)
    const done = await finish(job)
    assert.equal(done.status, 'cancelled')
    assert.equal((db.prepare('SELECT COUNT(*) c FROM media_metadata WHERE auto_tags IS NOT NULL').get() as { c: number }).c, tagged - PAGE)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
