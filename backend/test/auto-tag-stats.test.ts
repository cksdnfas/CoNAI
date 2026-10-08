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
