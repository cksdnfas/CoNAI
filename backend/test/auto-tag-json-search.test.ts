import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import type { AutoTagSearchParams } from '../src/types/autoTag'
import { AutoTagIndexService } from '../src/services/autoTagIndexService'
import { AutoTagSearchService } from '../src/services/autoTagSearchService'

function legacyDb(rows: Array<object | null>) {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE media_metadata (id INTEGER PRIMARY KEY, auto_tags TEXT)')
  const insert = db.prepare('INSERT INTO media_metadata (id, auto_tags) VALUES (?, ?)')
  rows.forEach((tags, index) => insert.run(index + 1, tags === null ? null : JSON.stringify(tags)))
  return db
}

async function matchingIds(db: Database.Database, search: AutoTagSearchParams) {
  const query = await AutoTagSearchService.buildAutoTagSearchQuery(search)
  return (db.prepare(`SELECT i.id FROM media_metadata i WHERE ${query.conditions.join(' AND ')} ORDER BY i.id`)
    .all(...query.params) as Array<{ id: number }>).map(row => row.id)
}

test('legacy general-tag SQL preserves stored paths, literal keys, score bounds and AND binding order', async t => {
  t.mock.method(AutoTagIndexService, 'hasIndexTable', () => false)
  const db = legacyDb([
    { general: { alpha_beta: 0.7, required: 0.95 } },
    { tagger: { general: { 'alpha beta': 0.8 } } },
    { kaloscope: { general: { alphabeta: 0.6 } } },
    { kaloscope: { artists: { alpha_beta: 0.9 } } },
    { kaloscope: { artist: { ALPHA_BETA: 0.75 } } },
    { general: { alpha: 0.8 } },
    { general: { alpha_beta: 0.2 } },
    { general: { alpha_beta: 1 } },
    { general: { alpha_beta: null } },
    { general: { '100%_literal': 0.8 } },
    { general: { '100ZZ_literal': 0.8 } },
    null,
  ])
  t.after(() => db.close())
  const cases: Array<[AutoTagSearchParams, number[]]> = [
    [{ general_tags: [{ tag: 'alpha_beta' }] }, [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    [{ general_tags: [{ tag: 'alpha_beta', min_score: 0.5, max_score: 0.9 }] }, [1, 2, 3, 4, 5]],
    [{ general_tags: [{ tag: 'alpha_beta', min_score: 0.8, max_score: 0.9 }] }, [2, 4]],
    // Explicit 0..1 bounds suppress token-only variants but leave scores unrestricted, including null.
    [{ general_tags: [{ tag: 'alpha_beta', min_score: 0, max_score: 1 }] }, [1, 2, 3, 4, 5, 7, 8, 9]],
    [{ general_tags: [{ tag: '100%_literal', min_score: 0.5 }] }, [10]],
    [{ general_tags: [{ tag: 'alpha_beta', min_score: 0.5, max_score: 0.9 }, { tag: 'required', min_score: 0.9 }] }, [1]],
  ]
  for (const [search, expected] of cases) assert.deepEqual(await matchingIds(db, search), expected, JSON.stringify(search))
})

test('legacy character SQL preserves both stored paths, variants and score parameter order', async t => {
  t.mock.method(AutoTagIndexService, 'hasIndexTable', () => false)
  const db = legacyDb([
    { character: { sailor_moon: 0.7 } },
    { tagger: { character: { 'sailor moon': 0.8 } } },
    { character: { sailormoon: 0.9 } },
    { character: { sailor: 0.8 } },
    { character: { sailor_moon: null } },
    { character: {} },
    { tagger: { character: { '100%_literal': 0.7 } } },
    { character: { '100ZZ_literal': 0.7 } },
    { tagger: { character: { sailor_moon: 0.3 } } },
  ])
  t.after(() => db.close())
  const cases: Array<[AutoTagSearchParams, number[]]> = [
    [{ character: { name: 'sailor_moon' } }, [1, 2, 3, 4, 5, 9]],
    [{ character: { name: 'sailor_moon', min_score: 0.5, max_score: 0.9 } }, [1, 2, 3]],
    [{ character: { name: 'sailor_moon', min_score: 0.8, max_score: 0.9 } }, [2, 3]],
    [{ character: { name: 'sailor_moon', min_score: 0, max_score: 1 } }, [1, 2, 3, 5, 9]],
    [{ character: { name: '100%_literal', min_score: 0.5 } }, [7]],
  ]
  for (const [search, expected] of cases) assert.deepEqual(await matchingIds(db, search), expected, JSON.stringify(search))
})
