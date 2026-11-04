import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Sort directions and rating types arrive in HTTP bodies and query strings typed only by TypeScript unions. They are
 * spliced into ORDER BY and JSON-path text, so a value that is not one of the known words must never reach the SQL.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-image-query-input-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

const hash = (n: number) => n.toString(16).padStart(48, '0')
// Spliced into ORDER BY this fails on the missing table, which is how a leaked value shows itself.
const SPLICED_ORDER = 'DESC, (SELECT x FROM table_that_does_not_exist)' as 'DESC'
const SPLICED_COLUMN = 'width, (SELECT x FROM table_that_does_not_exist)' as 'width'

test('sort and rating inputs from requests never become SQL text', async () => {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { QueryCacheService } = await import('../src/services/QueryCacheService')
  QueryCacheService.initialize()
  const db = main.db

  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare("INSERT INTO media_metadata (composite_hash, prompt, first_seen_date, auto_tags) VALUES (?, 'p', ?, ?)")
  const insertFile = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type) VALUES (?, ?, ?, 'active', 1, 'image/png')")
  db.transaction(() => {
    for (const n of [1, 2, 3]) {
      insertMedia.run(hash(n), `2026-01-0${n} 00:00:00`, JSON.stringify({ rating: { general: n / 4 } }))
      insertFile.run(hash(n), `D:\\q\\${n}.png`, folderId)
    }
  })()
  const newestFirst = [hash(3), hash(2), hash(1)]
  const hashesOf = (images: Array<{ composite_hash: string }>) => images.map((image) => image.composite_hash)

  const { MediaMetadataFileQueries } = await import('../src/models/Image/MediaMetadataFileQueries')
  assert.deepEqual(hashesOf(MediaMetadataFileQueries.findAllWithFiles({ sortBy: SPLICED_COLUMN, sortOrder: SPLICED_ORDER }).items), newestFirst)
  assert.deepEqual(hashesOf(MediaMetadataFileQueries.findAllWithFilesCursor({ sortOrder: SPLICED_ORDER }).items), newestFirst)
  assert.deepEqual(hashesOf(MediaMetadataFileQueries.findAllWithFiles({ sortOrder: 'asc' as 'ASC' }).items), [...newestFirst].reverse(), 'a lower-case direction still means itself')

  const { ImageSearchModel } = await import('../src/models/Image/ImageSearchModel')
  assert.deepEqual(hashesOf((await ImageSearchModel.advancedSearch({}, 1, 20, 'upload_date', SPLICED_ORDER)).images), newestFirst)
  assert.deepEqual(hashesOf((await ImageSearchModel.searchByAutoTags({ has_auto_tags: true, sortOrder: SPLICED_ORDER })).images), newestFirst)

  const { ComplexFilterService } = await import('../src/services/complexFilterService')
  const rated = (ratingType: string) => ({ and_group: [{ category: 'auto_tag', type: 'auto_tag_rating', rating_type: ratingType, min_score: 0.4 }] }) as never
  const searched = await ComplexFilterService.executeComplexSearch(rated('general'), undefined, { page: 1, limit: 10, sortOrder: SPLICED_ORDER, includeStats: false })
  assert.deepEqual(hashesOf(searched.images), [hash(3), hash(2)])

  const hostile = ComplexFilterService.validateFilter(rated("general'), (SELECT x FROM table_that_does_not_exist), ('"))
  assert.equal(hostile.valid, false)
  assert.match(hostile.errors.join(' '), /rating_type must be one of/)
  assert.equal(ComplexFilterService.validateFilter(rated('general')).valid, true)
  await assert.rejects(
    ComplexFilterService.executeComplexSearch(rated("general'), (SELECT x FROM table_that_does_not_exist), ('"), undefined, { page: 1, limit: 10, includeStats: false }),
    /Unknown auto-tag rating type/,
    'a filter that skipped validation still cannot reach the SQL',
  )
})
