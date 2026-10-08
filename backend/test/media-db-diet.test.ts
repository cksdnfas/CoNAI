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
import * as migration040 from '../src/database/migrations/040_restructure_auto_tag_index'

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
