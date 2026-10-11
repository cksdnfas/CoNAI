import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Auto-tag statistics must read where the tagger actually writes (`$.tagger.rating`, `$.tagger.character`,
 * `$.tagger.model`, `$.kaloscope.model`), not only the legacy root paths, which real data never has.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-auto-tag-stats-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

async function boot() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  return { db: main.db }
}

const hash = (n: number) => n.toString(16).padStart(48, '0')

test('auto-tag stats count tagger-nested ratings, characters and models', async () => {
  const { db } = await boot()
  const insert = db.prepare('INSERT INTO media_metadata (composite_hash, auto_tags) VALUES (?, ?)')
  const rating = (general: number, sensitive: number, questionable: number, explicit: number) => ({ general, sensitive, questionable, explicit })
  db.transaction(() => {
    // Real tagger shape: everything under `tagger` / `kaloscope`.
    insert.run(hash(1), JSON.stringify({ version: 2, tagger: { rating: rating(0.9, 0.1, 0, 0), character: { izumi_konata: 0.9 }, model: 'vit' }, kaloscope: { model: 'kaloscope-onnx' } }))
    insert.run(hash(2), JSON.stringify({ version: 2, tagger: { rating: rating(0.1, 0.8, 0.1, 0), character: {}, model: 'vit' } }))
    insert.run(hash(3), JSON.stringify({ version: 2, tagger: { rating: rating(0, 0.1, 0.2, 0.7), character: { a: 0.5, b: 0.6 }, model: 'eva02' } }))
    // Legacy root shape still counts.
    insert.run(hash(4), JSON.stringify({ rating: rating(0, 0, 0.9, 0.1), character: { c: 0.7 }, model: 'legacy' }))
    // Untagged and kaloscope-only rows.
    insert.run(hash(5), null)
    insert.run(hash(6), JSON.stringify({ version: 2, kaloscope: { model: 'kaloscope-onnx' } }))
  })()

  const { ImageStatsModel } = await import('../src/models/Image/ImageStatsModel')
  ImageStatsModel.clearAutoTagStatsCache()
  const stats = await ImageStatsModel.getAutoTagStats()

  assert.equal(stats.total_images, 6)
  assert.equal(stats.tagged_images, 5)
  assert.equal(stats.untagged_images, 1)
  assert.deepEqual(stats.rating_distribution, { general: 1, sensitive: 1, questionable: 1, explicit: 1 })
  // Rows with at least one tagged character (an empty tagger.character object does not count).
  assert.equal(stats.character_count, 3)
  // Same precedence as the search filters: root model, then tagger, then kaloscope.
  assert.deepEqual(stats.model_distribution, { vit: 2, eva02: 1, legacy: 1, 'kaloscope-onnx': 1 })
})

test('top general tags come from the tag index, tagger general only', async () => {
  const { db } = await boot()
  const { AutoTagIndexService } = await import('../src/services/autoTagIndexService')
  const insert = db.prepare('INSERT INTO media_metadata (composite_hash, auto_tags) VALUES (?, ?)')
  const rows: Array<[string, object]> = [
    [hash(101), { version: 2, tagger: { general: { solo: 0.9, smile: 0.8 } }, kaloscope: { artists: { some_artist: 0.9 } } }],
    [hash(102), { version: 2, tagger: { general: { solo: 0.7 } }, kaloscope: { artists: { some_artist: 0.8 } } }],
    // Legacy root shape still counts.
    [hash(103), { general: { solo: 0.6, smile: 0.5 } }],
    [hash(104), { version: 2, kaloscope: { artists: { some_artist: 0.7 } } }],
  ]
  for (const [compositeHash, tags] of rows) {
    insert.run(compositeHash, JSON.stringify(tags))
    AutoTagIndexService.syncForHash(compositeHash, JSON.stringify(tags))
  }

  const { ImageStatsModel } = await import('../src/models/Image/ImageStatsModel')
  // Kaloscope artists are general-typed in the index but are not "top tags"; earlier rows from the other test add none.
  assert.deepEqual(ImageStatsModel.getTopGeneralTags(5), [{ tag: 'solo', count: 3 }, { tag: 'smile', count: 2 }])
  assert.deepEqual(ImageStatsModel.getTopGeneralTags(1), [{ tag: 'solo', count: 3 }])
})

test('visible library stats leave out hidden-tier, file-less and deleted media', async () => {
  const { db } = await boot()
  const { AutoTagIndexService } = await import('../src/services/autoTagIndexService')
  const { RatingScoreModel } = await import('../src/models/RatingScore')
  const top = RatingScoreModel.getAllTiers().find((tier) => tier.max_score === null)
  assert.ok(top)
  RatingScoreModel.updateTier(top.id, { feed_visibility: 'hide' })

  const folderId = Number(db.prepare("INSERT INTO watched_folders (folder_path, folder_name) VALUES ('/lib', 'lib')").run().lastInsertRowid)
  const insertMedia = db.prepare('INSERT INTO media_metadata (composite_hash, auto_tags, rating_score) VALUES (?, ?, ?)')
  const insertFile = db.prepare('INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type) VALUES (?, ?, ?, ?, 1, ?)')
  const rating = (general: number, sensitive: number, questionable: number, explicit: number) => ({ general, sensitive, questionable, explicit })
  const rows: Array<[number, object | null, number, string]> = [
    [201, { version: 2, tagger: { rating: rating(0.9, 0.1, 0, 0), general: { solo: 0.9 }, character: { izumi_konata: 0.8 } } }, 1, 'active'],
    [202, { version: 2, tagger: { rating: rating(0.1, 0.8, 0, 0), general: { solo: 0.8, smile: 0.7 } } }, 3, 'active'],
    [203, null, 0, 'active'],
    // Hidden tier: its tag and character must not leak.
    [204, { version: 2, tagger: { rating: rating(0, 0, 0.1, 0.9), general: { secret_tag: 0.9 }, character: { hidden_girl: 0.9 } } }, 50, 'active'],
    // Visible score but the file is gone.
    [205, { version: 2, tagger: { rating: rating(0.9, 0, 0, 0), general: { gone_tag: 0.9 } } }, 0, 'deleted'],
  ]
  for (const [n, tags, score, fileStatus] of rows) {
    const json = tags ? JSON.stringify(tags) : null
    insertMedia.run(hash(n), json, score)
    insertFile.run(hash(n), `/lib/${n}.png`, folderId, fileStatus, 'image/png')
    AutoTagIndexService.syncForHash(hash(n), json)
  }

  const { ImageStatsModel } = await import('../src/models/Image/ImageStatsModel')
  const stats = ImageStatsModel.getVisibleLibraryStats(10)
  // Rows from the earlier tests have no file row, so only 201-203 count.
  assert.equal(stats.total, 3)
  assert.equal(stats.tagged_images, 2)
  assert.equal(stats.untagged_images, 1)
  assert.deepEqual(stats.rating_distribution, { general: 1, sensitive: 1, questionable: 0, explicit: 0 })
  assert.equal(stats.images_with_character, 1)
  assert.deepEqual(stats.top_general_tags, [{ tag: 'solo', count: 2 }, { tag: 'smile', count: 1 }])
  // The unscoped variant still sees everything indexed.
  assert.ok(ImageStatsModel.getTopGeneralTags(20).some((tag) => tag.tag === 'secret_tag'))
})
