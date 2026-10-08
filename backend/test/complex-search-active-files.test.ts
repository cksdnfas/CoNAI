import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Complex search returns the same population as the feed: media with at least one active file. Media whose files
 * are all missing/deleted (or that has no file row, e.g. an orphan kept for a chat reference) is not a result.
 * Group auto-collect keeps matching them, as before.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-complex-active-'))
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
  const { QueryCacheService } = await import('../src/services/QueryCacheService')
  QueryCacheService.initialize()
  return { db: main.db }
}

const hash = (n: number) => n.toString(16).padStart(48, '0')

test('complex search skips media without an active file; auto-collect still sees it', async () => {
  const { db } = await boot()
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare("INSERT INTO media_metadata (composite_hash, prompt, first_seen_date) VALUES (?, 'zebra, 1girl', '2026-01-02 00:00:00')")
  const insertFile = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type) VALUES (?, ?, ?, ?, 1, 'image/png')")
  db.transaction(() => {
    insertMedia.run(hash(1))
    insertFile.run(hash(1), 'D:\\ca\\1.png', folderId, 'active')
    insertMedia.run(hash(2))
    insertFile.run(hash(2), 'D:\\ca\\2.png', folderId, 'missing')
    insertMedia.run(hash(3))
    insertFile.run(hash(3), 'D:\\ca\\3.png', folderId, 'deleted')
    insertMedia.run(hash(4)) // no file row at all
    insertMedia.run(hash(5))
    insertFile.run(hash(5), 'D:\\ca\\5a.png', folderId, 'missing')
    insertFile.run(hash(5), 'D:\\ca\\5b.png', folderId, 'active')
  })()

  const { ComplexFilterService } = await import('../src/services/complexFilterService')
  const filter = { and_group: [{ category: 'positive_prompt', type: 'prompt_contains', value: 'zebra' }] } as any

  const result = await ComplexFilterService.executeComplexSearch(filter, undefined, { page: 1, limit: 50, includeStats: false })
  assert.deepEqual(result.images.map((image: { composite_hash: string }) => image.composite_hash).sort(), [hash(1), hash(5)])
  assert.equal(result.total, 2)

  const ids = await ComplexFilterService.executeComplexSearchIds(filter)
  assert.deepEqual([...ids.ids].sort(), [hash(1), hash(5)])

  const autoCollect = await ComplexFilterService.buildComplexSearchHashesQuery(filter, undefined, { includeMediaWithoutActiveFile: true })
  const collected = (db.prepare(autoCollect.query).all(...autoCollect.params) as Array<{ composite_hash: string }>).map((row) => row.composite_hash).sort()
  assert.deepEqual(collected, [hash(1), hash(2), hash(3), hash(4), hash(5)])
})
