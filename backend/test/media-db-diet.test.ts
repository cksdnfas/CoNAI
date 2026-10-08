import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// Migrations and the services resolve runtime paths at import time; keep everything in a scratch folder.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-db-diet-'))
process.env.RUNTIME_BASE_PATH = scratchDir
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { MigrationManager } from '../src/database/migrationManager'
import { buildIndexedMediaSubquery } from '../src/services/autoTagIndexService'
import { canonicalAutoTagSearchKey } from '../src/services/autoTagSearch/autoTagSearchTerms'
import { decodeColorHistogram, encodeColorHistogram } from '../src/services/imageSimilarity'
import * as migration000 from '../src/database/migrations/000_create_all_tables'
import * as migration036 from '../src/database/migrations/036_scope_group_name_uniqueness_to_parent'
import * as migration037 from '../src/database/migrations/037_add_group_emoticons'
import * as migration038 from '../src/database/migrations/038_add_media_pixel_hash'
import * as migration039 from '../src/database/migrations/039_drop_civitai_temp_urls'
import * as migration040 from '../src/database/migrations/040_restructure_auto_tag_index'
import * as migration041 from '../src/database/migrations/041_rebuild_media_metadata_with_id'

/**
 * images.db size work (migrations 040+): the integer-keyed auto-tag index must answer every lookup exactly like the
 * old composite_hash + two-search-key index did.
 */

let dbCounter = 0
async function freshDb(): Promise<Database.Database> {
  dbCounter += 1
  const db = new Database(path.join(scratchDir, `images-${dbCounter}.db`))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  await new MigrationManager(db).migrate({ requireBaseline: true })
  return db
}

const hex = (seed: number) => seed.toString(16).padStart(2, '0').repeat(24)

/** The key set the old index stored per tag (and built per query): normalized text plus its compact form. */
function oldIndexKeys(term: string): string[] {
  const normalized = term.trim().toLowerCase()
  if (!normalized) return []
  const compact = normalized.replace(/[_\s-]+/g, '')
  return [...new Set([normalized, ...(compact ? [compact] : [])])]
}

const TRICKY_TERMS = [
  'blonde_hair', 'blonde hair', 'blonde-hair', 'BLONDE_HAIR', 'blondehair', ' Blonde  Hair ', 'blonde__hair',
  'hair', 'long_hair', 'longhair', '1girl', '1 girl', '_', '-', '__', ' - ', '^_^', '^^', ':d', ':D',
  'jobo_(isi88)', 'jobo (isi88)', 'rnd.jpg_(artist)', 'tatsuyoshi_(zawahomura)', '2b_(nier:automata)', 'x', 'X_',
]

test('one canonical key per tag matches exactly what the old two-key index matched', () => {
  for (const query of TRICKY_TERMS) {
    for (const stored of TRICKY_TERMS) {
      const queryKeys = oldIndexKeys(query)
      const storedKeys = new Set(oldIndexKeys(stored))
      const oldMatch = queryKeys.some((key) => storedKeys.has(key))
      const newMatch = canonicalAutoTagSearchKey(query) !== '' && canonicalAutoTagSearchKey(query) === canonicalAutoTagSearchKey(stored)
      assert.equal(newMatch, oldMatch, `${JSON.stringify(query)} vs ${JSON.stringify(stored)}`)
    }
  }
})

type SeedTag = { hash: string; type: 'general' | 'character' | 'model'; source: string; tag: string; score: number | null }

function seedOldIndex(db: Database.Database, tags: SeedTag[]) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO media_auto_tag_index (composite_hash, tag_type, source_path, tag_key, normalized_tag_key, search_key, score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const tag of tags) {
    for (const key of oldIndexKeys(tag.tag)) insert.run(tag.hash, tag.type, tag.source, tag.tag, tag.tag.trim().toLowerCase(), key, tag.score)
  }
}

/** The old reader: tag_type IN (...) AND search_key IN (query keys) [AND score range]. */
function oldLookup(db: Database.Database, tagTypes: string[], tag: string, minScore?: number) {
  const keys = oldIndexKeys(tag)
  const rows = db.prepare(`
    SELECT DISTINCT composite_hash FROM media_auto_tag_index
    WHERE tag_type IN (${tagTypes.map(() => '?').join(', ')}) AND search_key IN (${keys.map(() => '?').join(', ')})
    ${minScore !== undefined ? 'AND score >= ?' : ''}
  `).all(...tagTypes, ...keys, ...(minScore !== undefined ? [minScore] : [])) as Array<{ composite_hash: string }>
  return rows.map((row) => row.composite_hash).sort()
}

function newLookup(db: Database.Database, tagTypes: string[], tag: string, minScore?: number) {
  const subquery = buildIndexedMediaSubquery({ tagTypes, tag, minScore })
  assert.ok(subquery)
  const rows = db.prepare(`SELECT composite_hash FROM media_metadata WHERE rowid IN (${subquery.sql})`).all(...subquery.params) as Array<{ composite_hash: string }>
  return rows.map((row) => row.composite_hash).sort()
}

test('040 moves the old index into terms + integer rows with identical lookups, then drops it', async () => {
  const db = await freshDb()
  const insertMedia = db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)')
  for (let i = 1; i <= 6; i += 1) insertMedia.run(hex(i))

  // Rewind to the pre-040 shape: the old table back, the new tables and the 040 record gone.
  await migration040.down(db)
  db.prepare("DELETE FROM migrations WHERE version = '040_restructure_auto_tag_index'").run()

  const tags: SeedTag[] = [
    { hash: hex(1), type: 'general', source: '$.tagger.general', tag: 'blonde_hair', score: 0.97 },
    { hash: hex(1), type: 'general', source: '$.tagger.general', tag: '1girl', score: 0.99 },
    { hash: hex(2), type: 'general', source: '$.tagger.general', tag: 'blonde hair', score: 0.41 },
    { hash: hex(2), type: 'general', source: '$.kaloscope.artists', tag: 'jobo_(isi88)', score: 0.8 },
    { hash: hex(3), type: 'general', source: '$.tagger.general', tag: 'long_hair', score: 0.6 },
    { hash: hex(3), type: 'character', source: '$.tagger.character', tag: 'sailor_moon', score: 0.92 },
    { hash: hex(4), type: 'character', source: '$.tagger.character', tag: 'Sailor Moon', score: 0.5 },
    { hash: hex(4), type: 'model', source: '$.tagger.model', tag: 'vit', score: null },
    { hash: hex(5), type: 'model', source: '$.kaloscope.model', tag: 'kaloscope-onnx', score: null },
    { hash: hex(5), type: 'general', source: '$.tagger.general', tag: '^_^', score: 0.7 },
  ]
  seedOldIndex(db, tags)
  const queries: Array<[string[], string, number?]> = [
    [['general'], 'blonde_hair'], [['general'], 'BLONDE-HAIR'], [['general'], 'blondehair', 0.5], [['general'], 'hair'],
    [['general'], 'jobo (isi88)'], [['general', 'character'], 'sailor moon'], [['character'], 'sailor_moon', 0.9],
    [['model'], 'vit'], [['model'], 'kaloscope onnx'], [['general'], '^^'], [['general'], 'long hair', 0.7],
  ]
  const expected = queries.map(([types, tag, min]) => oldLookup(db, types, tag, min))

  await new MigrationManager(db).migrate()

  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'media_auto_tag_index'").get(), 'old table dropped')
  assert.deepEqual(queries.map(([types, tag, min]) => newLookup(db, types, tag, min)), expected)
  assert.ok(expected.some((hashes) => hashes.length > 1), 'the fixture exercises variant matching across media')
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM media_auto_tags').get() as { c: number }).c, tags.length, 'one row per tag, not per key')
  const score = db.prepare(`
    SELECT mat.score FROM media_auto_tags mat JOIN auto_tag_terms t ON t.term_id = mat.term_id
    JOIN media_metadata m ON m.rowid = mat.media_id WHERE m.composite_hash = ? AND t.tag_key = ?
  `).get(hex(2), 'blonde hair') as { score: number }
  assert.equal(score.score, 0.41)

  // Deleting a media row takes its tags with it (trigger, since the table has no FK to media_metadata).
  db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hex(1))
  assert.equal(newLookup(db, ['general'], '1girl').length, 0)
  db.close()
})

/** A database exactly as it stood before 041: the baseline plus 036–040, each run the way the manager runs them. */
async function pre041Db(): Promise<Database.Database> {
  dbCounter += 1
  const db = new Database(path.join(scratchDir, `images-${dbCounter}.db`))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const migration of [migration000, migration036, migration037, migration038, migration039, migration040]) {
    db.exec('BEGIN IMMEDIATE')
    await migration.up(db as any)
    db.exec('COMMIT')
  }
  return db
}

function histogramJson(seed: number, withDescriptor: boolean): string {
  const channel = (offset: number) => Array.from({ length: 256 }, (_, bin) => ((bin * 7 + seed * 13 + offset) % 9 === 0 ? 12 : 0) / 1024)
  const histogram: Record<string, unknown> = { r: channel(0), g: channel(1), b: channel(2) }
  if (withDescriptor) histogram.descriptor = { averageRgb: [101.25, 87.5, 64.13], dominantRgb: [12, 200, 33], luminance: 0.3456, saturation: 0.4321 }
  return JSON.stringify(histogram)
}

function ftsHashes(db: Database.Database, needle: string): string[] {
  return (db.prepare(`
    SELECT m.composite_hash AS h FROM media_prompt_fts f JOIN media_metadata m ON m.rowid = f.rowid
    WHERE media_prompt_fts MATCH ? ORDER BY h
  `).all(`positive_text:"${needle}"`) as Array<{ h: string }>).map((row) => row.h)
}

test('the histogram encoder in 041 writes the same bytes as the runtime encoder, and both round-trip exactly', () => {
  for (const json of [histogramJson(1, true), histogramJson(2, false), JSON.stringify({ r: [0.3], g: [], b: [] }), 'not json']) {
    const fromMigration = migration041.encodeStoredHistogram(json)
    let parsed: any
    try { parsed = JSON.parse(json) } catch { parsed = undefined }
    if (parsed !== undefined) {
      assert.deepEqual(fromMigration, encodeColorHistogram(parsed))
      assert.deepEqual(decodeColorHistogram(fromMigration), parsed)
    }
  }
  const compact = encodeColorHistogram(JSON.parse(histogramJson(3, true)))
  assert.equal(compact[0], 1, 'exact count histograms use the compact layout')
  assert.ok(compact.length < 700, `compact histogram is small (${compact.length} bytes)`)
})

test('041 rebuilds media_metadata with media_id = old rowid, keeps every child, FTS and tag link, and survives VACUUM', async () => {
  const db = await pre041Db()
  db.prepare("UPDATE media_prompt_fts_state SET status = 'ready' WHERE id = 1").run()
  const folderId = (db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare(`
    INSERT INTO media_metadata (composite_hash, prompt, color_histogram, auto_tags, auto_tag_state, rating_score, pixel_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFile = db.prepare(`
    INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, 1, 'image/png')
  `)
  for (let i = 1; i <= 12; i += 1) {
    insertMedia.run(hex(i), i % 2 ? `red fox number${i}` : `blue whale number${i}`, i % 4 ? histogramJson(i, i % 3 === 0) : null,
      '{"tagger":{"general":{"1girl":0.9}}}', i % 5 === 0 ? 'skip' : 'done', i, i === 3 ? 'p'.repeat(64) : null)
    insertFile.run(hex(i), `/library/${i}.png`, folderId)
  }
  // Settled states the image_files link trigger would flip back to 'pending' if it fired while file rows come back.
  db.exec("UPDATE media_metadata SET auto_tag_state = CASE WHEN rowid % 5 = 0 THEN 'skip' ELSE 'done' END")
  // Gaps in the rowid sequence: the case VACUUM is allowed to renumber on a table without INTEGER PRIMARY KEY.
  db.prepare('DELETE FROM media_metadata WHERE composite_hash IN (?, ?)').run(hex(2), hex(7))
  const groupId = (db.prepare("INSERT INTO groups (name) VALUES ('g041') RETURNING id").get() as { id: number }).id
  db.prepare('INSERT INTO image_groups (group_id, composite_hash) VALUES (?, ?), (?, ?)').run(groupId, hex(1), groupId, hex(4))
  const folderGroupId = (db.prepare("INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name) VALUES ('a', '/a', 'a') RETURNING id").get() as { id: number }).id
  db.prepare('INSERT INTO auto_folder_group_images (group_id, composite_hash) VALUES (?, ?)').run(folderGroupId, hex(5))
  db.prepare("INSERT INTO image_models (composite_hash, model_hash, model_role) VALUES (?, 'abc', 'checkpoint')").run(hex(6))
  const termId = Number(db.prepare("INSERT INTO auto_tag_terms (tag_type, source_path, tag_key, search_key) VALUES ('general', '$.tagger.general', '1girl', '1girl')").run().lastInsertRowid)
  db.prepare('INSERT INTO media_auto_tags (term_id, media_id, score) SELECT ?, rowid, 0.9 FROM media_metadata').run(termId)

  const snapshot = () => ({
    rows: db.prepare('SELECT rowid AS id, composite_hash, prompt, auto_tag_state, rating_score, pixel_hash FROM media_metadata ORDER BY rowid').all(),
    files: db.prepare('SELECT id, composite_hash FROM image_files ORDER BY id').all(),
    groups: db.prepare('SELECT id, group_id, composite_hash FROM image_groups ORDER BY id').all(),
    folderImages: db.prepare('SELECT id, composite_hash FROM auto_folder_group_images ORDER BY id').all(),
    models: db.prepare('SELECT id, composite_hash FROM image_models ORDER BY id').all(),
    tags: db.prepare('SELECT term_id, media_id, score FROM media_auto_tags ORDER BY media_id').all(),
    fox: ftsHashes(db, 'fox'),
    whale: ftsHashes(db, 'whale'),
  })
  const histogramsBefore = new Map((db.prepare('SELECT rowid AS id, color_histogram FROM media_metadata WHERE color_histogram IS NOT NULL').all() as Array<{ id: number; color_histogram: string }>)
    .map((row) => [row.id, JSON.parse(row.color_histogram)]))
  const triggersBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()
  const before = snapshot()
  assert.equal(before.fox.length, 5)

  db.exec('BEGIN IMMEDIATE')
  await migration041.up(db as any)
  db.exec('COMMIT')

  assert.deepEqual(snapshot(), before, 'rows, ids, children, auto-tag state, tag links and FTS results unchanged')
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(), triggersBefore, 'every trigger back with its exact SQL')
  const columns = db.prepare('PRAGMA table_info(media_metadata)').all() as Array<{ name: string; type: string; pk: number }>
  assert.deepEqual(columns.filter((column) => column.pk).map((column) => [column.name, column.type]), [['media_id', 'INTEGER']])
  assert.ok(!columns.some((column) => column.name === 'color_histogram'))
  const histograms = db.prepare('SELECT media_id, color_histogram FROM media_image_features ORDER BY media_id').all() as Array<{ media_id: number; color_histogram: Buffer }>
  assert.equal(histograms.length, histogramsBefore.size)
  for (const row of histograms) assert.deepEqual(decodeColorHistogram(row.color_histogram), histogramsBefore.get(row.media_id))

  db.exec('VACUUM')
  assert.deepEqual(snapshot(), before, 'VACUUM keeps media ids, so FTS and tag rows still point at the right images')
  db.prepare("INSERT INTO media_prompt_fts(media_prompt_fts) VALUES('integrity-check')").run()

  // Deletes take features and tags along; ids are never handed out twice.
  const maxId = (db.prepare('SELECT MAX(media_id) AS m FROM media_metadata').get() as { m: number }).m
  db.prepare('DELETE FROM media_metadata WHERE media_id = ?').run(maxId)
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM media_image_features WHERE media_id = ?').get(maxId) as { c: number }).c, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM media_auto_tags WHERE media_id = ?').get(maxId) as { c: number }).c, 0)
  const newId = Number(db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hex(99)).lastInsertRowid)
  assert.ok(newId > maxId, 'AUTOINCREMENT does not reuse the deleted id')
  db.close()
})

test('a fresh database ends in the final shape and stays put on a second run', async () => {
  const db = await freshDb()
  const columns = (db.prepare('PRAGMA table_info(media_metadata)').all() as Array<{ name: string }>).map((column) => column.name)
  assert.equal(columns[0], 'media_id')
  for (const table of ['media_image_features', 'auto_tag_terms', 'media_auto_tags']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table)
  }
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'media_auto_tag_index'").get())
  const schema = JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all())
  await new MigrationManager(db).migrate()
  assert.equal(JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()), schema)
  db.close()
})
