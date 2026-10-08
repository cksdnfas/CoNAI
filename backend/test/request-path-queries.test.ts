import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

/**
 * Request-path query changes (migration 043 and friends): sargable calendar-day bounds, aggregate caches and their
 * invalidation, paged id lists, and the rewritten group / folder / complex-search page queries, which must return
 * exactly what the former SQL returned. Runs against throwaway databases under the OS temp dir.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-request-path-'))
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
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { QueryCacheService } = await import('../src/services/QueryCacheService')
  QueryCacheService.initialize()
  return { db: main.db }
}

const booted = boot()

const hash = (n: number) => n.toString(16).padStart(48, '0')
const pad = (n: number) => String(n).padStart(2, '0')

/** Seed media with ties on dates, several files per hash, groups with ties on (order_index, added_date). */
async function seed() {
  const { db } = await booted
  if (db.prepare("SELECT 1 FROM groups WHERE name = 'rp-big'").get()) {
    return db
  }
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare(`
    INSERT INTO media_metadata (composite_hash, first_seen_date, metadata_updated_date, rating_score, postprocess_status, model_name, lora_models, auto_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFile = db.prepare(`
    INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type, last_verified_date)
    VALUES (?, ?, ?, ?, ?, 'image/png', ?)
  `)
  const models = ['Alpha_v1', 'alpha_v2', 'Beta', 'Ünicode-Model', 'gamma%_x']
  db.transaction(() => {
    for (let i = 1; i <= 240; i += 1) {
      const h = hash(i)
      // 12 media per day -> plenty of equal first_seen_date values at minute precision.
      const day = 1 + Math.floor(i / 12)
      const date = `2026-01-${pad(day)} ${pad(i % 3)}:00:00`
      const rating = { general: (i % 10) / 10, sensitive: 0.1, questionable: 0.05, explicit: (i % 7) / 10 }
      insertMedia.run(h, date, date, i % 50, i % 37 === 0 ? 'pending' : 'ready', models[i % models.length],
        i % 4 === 0 ? JSON.stringify([` lora_${i % 6} `, `LoRA_${i % 5}`]) : null,
        JSON.stringify({ tagger: { rating, general: { [`tag_${i % 9}`]: 0.8 } } }))
      insertFile.run(h, `D:\\rp\\${i}.png`, folderId, i % 29 === 0 ? 'missing' : 'active', 1000 + i, `2026-02-0${1 + (i % 5)} 00:00:00`)
      if (i % 6 === 0) {
        insertFile.run(h, `D:\\rp\\dup-${i}.png`, folderId, 'active', 2000 + i, '2026-02-09 00:00:00')
      }
    }
    const big = Number(db.prepare("INSERT INTO groups (name) VALUES ('rp-big')").run().lastInsertRowid)
    const child = Number(db.prepare("INSERT INTO groups (name, parent_id) VALUES ('rp-child', ?)").run(big).lastInsertRowid)
    const insertMember = db.prepare('INSERT INTO image_groups (group_id, composite_hash, added_date, order_index, collection_type) VALUES (?, ?, ?, ?, ?)')
    for (let i = 1; i <= 200; i += 1) {
      insertMember.run(big, hash(i), `2026-03-0${1 + (i % 3)} 00:00:00`, i % 11 === 0 ? 1 : 0, i % 4 === 0 ? 'manual' : 'auto')
    }
    for (let i = 150; i <= 240; i += 1) {
      insertMember.run(child, hash(i), `2026-03-0${1 + (i % 4)} 00:00:00`, i % 13 === 0 ? 2 : 0, 'manual')
    }
    const folder = Number(db.prepare(`
      INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name) VALUES ('rp-folder', 'D:\\rp', 'rp-folder')
    `).run().lastInsertRowid)
    const insertFolderImage = db.prepare('INSERT INTO auto_folder_group_images (group_id, composite_hash) VALUES (?, ?)')
    for (let i = 1; i <= 240; i += 2) insertFolderImage.run(folder, hash(i))
    const smallFolder = Number(db.prepare(`
      INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name) VALUES ('rp-small', 'D:\\rp\\small', 'rp-small')
    `).run().lastInsertRowid)
    for (let i = 3; i <= 240; i += 23) insertFolderImage.run(smallFolder, hash(i))
    const allFolder = Number(db.prepare(`
      INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name) VALUES ('rp-all', 'D:\\rp\\all', 'rp-all')
    `).run().lastInsertRowid)
    for (let i = 1; i <= 240; i += 1) if (i % 40 !== 0) insertFolderImage.run(allFolder, hash(i))
  })()
  db.exec('ANALYZE')
  return db
}

const groupId = (db: Database.Database, name: string) => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id

test('calendar-day bounds match the DATE() form for every stored shape and parameter', async () => {
  const { buildOnOrAfterDateSql, buildOnOrBeforeDateSql } = await import('../src/utils/sqlDateRange')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, d TEXT)')
  const stored = [
    '2025-12-31 23:59:59', '2026-01-01 00:00:00', '2026-01-01 12:30:00', '2026-01-01 23:59:59', '2026-01-02 00:00:00',
    '2026-01-01T08:00:00.000Z', '2026-01-01', '2025-12-31T23:59:59.999Z', null,
  ]
  stored.forEach((value) => db.prepare('INSERT INTO t (d) VALUES (?)').run(value))
  const ids = (sql: string, param: unknown) => (db.prepare(`SELECT id FROM t WHERE ${sql} ORDER BY id`).all(param) as Array<{ id: number }>).map((row) => row.id)
  for (const param of ['2026-01-01', '2026-01-01 15:00:00', '2026-01-01T23:00', '2025-12-31', '2026-01-02', 'not a date', null]) {
    assert.deepEqual(ids(buildOnOrAfterDateSql('d'), param), ids('DATE(d) >= DATE(?)', param), `start ${param}`)
    assert.deepEqual(ids(buildOnOrBeforeDateSql('d'), param), ids('DATE(d) <= DATE(?)', param), `end ${param}`)
  }
  db.exec('CREATE INDEX idx_t_d ON t(d)')
  const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM t WHERE ${buildOnOrAfterDateSql('d')} AND ${buildOnOrBeforeDateSql('d')}`)
    .all('2026-01-01', '2026-01-01') as Array<{ detail: string }>).map((row) => row.detail).join(' | ')
  assert.match(plan, /SEARCH t USING (COVERING )?INDEX idx_t_d \(d>\? AND d<\?\)/, 'the bounds are an index range')
})

test('migration 043 keeps first_seen_date filled and maintains the group version row', async () => {
  const { db } = await booted
  db.prepare("INSERT INTO media_metadata (composite_hash, first_seen_date, metadata_updated_date) VALUES (?, NULL, '2024-05-05 05:05:05')").run(hash(9001))
  assert.equal((db.prepare('SELECT first_seen_date AS d FROM media_metadata WHERE composite_hash = ?').get(hash(9001)) as { d: string }).d, '2024-05-05 05:05:05')
  db.prepare('UPDATE media_metadata SET first_seen_date = NULL WHERE composite_hash = ?').run(hash(9001))
  assert.equal((db.prepare('SELECT first_seen_date AS d FROM media_metadata WHERE composite_hash = ?').get(hash(9001)) as { d: string }).d, '2024-05-05 05:05:05')

  const version = () => (db.prepare("SELECT version FROM aggregate_versions WHERE scope = 'groups'").get() as { version: number }).version
  const before = version()
  const id = Number(db.prepare("INSERT INTO groups (name) VALUES ('rp-version')").run().lastInsertRowid)
  db.prepare('INSERT INTO image_groups (group_id, composite_hash) VALUES (?, ?)').run(id, hash(9001))
  db.prepare("UPDATE groups SET name = 'rp-version-2' WHERE id = ?").run(id)
  db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  assert.ok(version() >= before + 4, 'every group / membership write bumps the version')
  db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hash(9001))
})

test('library aggregates serve within the recompute floor, refresh after it, and expire on TTL', async () => {
  const { AggregateCache } = await import('../src/services/aggregateCache')
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    AggregateCache.clearAll()
    let computed = 0
    const read = () => AggregateCache.resolve('rp-floor', () => ++computed, { scopes: ['library'], ttlMs: 60_000 })
    assert.equal(read(), 1)
    AggregateCache.invalidate('library')
    now += 5_000
    assert.equal(read(), 1, 'within 10s of computing, a just-invalidated value is still served')
    now += 6_000
    assert.equal(read(), 2, 'after the floor the value is recomputed')
    assert.equal(read(), 2, 'and cached again while nothing changes')
    now += 61_000
    assert.equal(read(), 3, 'the TTL bounds staleness')

    let groupComputed = 0
    let sourceVersion = 7
    AggregateCache.setVersionSource('groups', () => sourceVersion)
    const readGroup = () => AggregateCache.resolve('rp-groups', () => ++groupComputed, { scopes: ['groups'] })
    assert.equal(readGroup(), 1)
    assert.equal(readGroup(), 1)
    sourceVersion = 8
    assert.equal(readGroup(), 2, 'groups changes invalidate immediately (no floor)')
  } finally {
    Date.now = realNow
    AggregateCache.setVersionSource('groups', null)
  }
})

test('group caches follow membership and group writes made outside the models', async () => {
  const db = await seed()
  const { AggregateCache } = await import('../src/services/aggregateCache')
  // Re-register the DB-backed source (an earlier test replaced it with a fake).
  AggregateCache.setVersionSource('groups', () => (db.prepare("SELECT version FROM aggregate_versions WHERE scope = 'groups'").get() as { version: number }).version)
  AggregateCache.clearAll()
  const { countVisibleImagesByGroupQuery } = await import('../src/models/GroupImageQueries')
  const { GroupModel } = await import('../src/models/Group')
  const big = groupId(db, 'rp-big')
  const own = () => countVisibleImagesByGroupQuery().get(big)!.own
  const stats = () => GroupModel.findAllWithStats().find((group) => group.id === big)!

  const firstOwn = own()
  const firstCount = stats().image_count
  db.prepare('INSERT INTO image_groups (group_id, composite_hash) VALUES (?, ?)').run(big, hash(239))
  assert.equal(own(), firstOwn + 1)
  assert.equal(stats().image_count, firstCount + 1)
  db.prepare("UPDATE groups SET name = 'rp-big-renamed' WHERE id = ?").run(big)
  assert.equal(stats().name, 'rp-big-renamed')
  db.prepare("UPDATE groups SET name = 'rp-big' WHERE id = ?").run(big)
  db.prepare('DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?').run(big, hash(239))
  assert.equal(own(), firstOwn)
})

/** The group page SQL before the two-phase rewrite (direct and descendant sources). */
function oldGroupPage(db: Database.Database, group: number, page: number, limit: number, collectionType?: string, includeChildren = false) {
  const children = includeChildren && db.prepare('SELECT 1 FROM groups WHERE parent_id = ? LIMIT 1').get(group)
  const cte = children ? `WITH RECURSIVE target_groups(id) AS (SELECT ? UNION ALL SELECT g.id FROM groups g INNER JOIN target_groups parent ON g.parent_id = parent.id)` : ''
  const from = children ? `(
      SELECT source_ig.composite_hash, MIN(source_ig.order_index) AS order_index, MAX(source_ig.added_date) AS added_date,
        CASE WHEN SUM(source_ig.collection_type = 'manual') > 0 THEN 'manual' ELSE 'auto' END AS collection_type
      FROM image_groups source_ig
      WHERE source_ig.group_id IN (SELECT id FROM target_groups) AND source_ig.composite_hash IS NOT NULL ${collectionType ? 'AND source_ig.collection_type = ?' : ''}
      GROUP BY source_ig.composite_hash) ig` : 'image_groups ig'
  const where = children ? 'WHERE ig.composite_hash IS NOT NULL' : `WHERE ig.group_id = ? AND ig.composite_hash IS NOT NULL${collectionType ? ' AND ig.collection_type = ?' : ''}`
  const params = collectionType ? [group, collectionType] : [group]
  return db.prepare(`
    ${cte}
    SELECT COALESCE(im.composite_hash, ig.composite_hash) as composite_hash, im.width, im.height, im.thumbnail_path, im.rating_score,
      im.first_seen_date, im.metadata_updated_date, if.id as id, if.original_file_path, if.file_status, if.file_type, if.file_size,
      if.mime_type, if.scan_date, ig.collection_type, ig.order_index as cursor_order_index, ig.added_date as cursor_added_date
    FROM ${from}
    LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
    LEFT JOIN image_files if ON if.id = (SELECT MIN(if2.id) FROM image_files if2 WHERE if2.composite_hash = ig.composite_hash AND if2.file_status = 'active')
    ${where} AND 1=1 AND COALESCE(im.postprocess_status, 'ready') = 'ready'
    GROUP BY ig.composite_hash
    ORDER BY ig.order_index ASC, ig.added_date DESC, ig.composite_hash ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit)
}

test('group pages return exactly what the former GROUP BY query returned', async () => {
  const db = await seed()
  const { findImagesByGroupQuery } = await import('../src/models/GroupImageQueries')
  const big = groupId(db, 'rp-big')
  for (const [collectionType, includeChildren] of [[undefined, false], ['manual', false], ['auto', false], [undefined, true], ['manual', true]] as const) {
    for (const page of [1, 2, 5]) {
      const now = findImagesByGroupQuery(big, page, 17, collectionType, undefined, includeChildren)
      assert.deepEqual(now.images, oldGroupPage(db, big, page, 17, collectionType, includeChildren), `${collectionType} ${includeChildren} p${page}`)
    }
  }
  // Cursor pages walk the same order as offset pages.
  const all = oldGroupPage(db, big, 1, 1000) as Array<{ composite_hash: string }>
  const walked: string[] = []
  let cursor: { orderIndex: number; addedDate: string; compositeHash: string; includeTotal: boolean } | undefined
  for (let i = 0; i < 20 && walked.length < all.length; i += 1) {
    const result = findImagesByGroupQuery(big, 1, 23, undefined, cursor ?? { orderIndex: -1, addedDate: '9999', compositeHash: '', includeTotal: false })
    walked.push(...result.images.map((image) => image.composite_hash as string))
    if (!result.hasMore) break
    cursor = { orderIndex: result.nextCursorOrderIndex!, addedDate: result.nextCursorAddedDate!, compositeHash: result.nextCursorHash!, includeTotal: false }
  }
  assert.deepEqual(walked, all.map((row) => row.composite_hash))
})

test('folder pages return exactly what the former per-column subqueries returned', async () => {
  const db = await seed()
  const { AutoFolderGroupImageModel } = await import('../src/models/AutoFolderGroup')
  const folderId = (name: string) => (db.prepare('SELECT id FROM auto_folder_groups WHERE folder_path = ?').get(name) as { id: number }).id
  const old = (folder: number, page: number, limit: number) => db.prepare(`
    SELECT m.*,
    (SELECT id FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as id,
    (SELECT file_type FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as file_type,
    (SELECT mime_type FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as mime_type,
    (SELECT file_size FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as file_size,
    (SELECT original_file_path FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as original_file_path
    FROM auto_folder_group_images afgi
    INNER JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
    WHERE afgi.group_id = ? AND COALESCE(m.postprocess_status, 'ready') = 'ready'
    ORDER BY m.first_seen_date DESC, m.composite_hash DESC
    LIMIT ? OFFSET ?
  `).all(folder, limit, (page - 1) * limit)
  // rp-all holds nearly the whole library (date-index walk); rp-folder half and rp-small a few rows (membership sort).
  for (const name of ['rp-all', 'rp-folder', 'rp-small']) {
    const folder = folderId(name)
    for (const page of [1, 2, 3]) {
      assert.deepEqual(AutoFolderGroupImageModel.findImagesByGroup(folder, page, 4).images, old(folder, page, 4), `${name} page ${page}`)
    }
    const all = old(folder, 1, 1000) as Array<{ composite_hash: string }>
    const walked: string[] = []
    let cursorDate: string | undefined
    let cursorHash: string | undefined
    for (let i = 0; i < 100; i += 1) {
      const result = AutoFolderGroupImageModel.findImagesByGroup(folder, 1, 7, { useCursor: true, cursorDate, cursorHash })
      walked.push(...result.images.map((image) => image.composite_hash))
      if (!result.hasMore) break
      cursorDate = result.nextCursorDate ?? undefined
      cursorHash = result.nextCursorHash ?? undefined
    }
    assert.deepEqual(walked, all.map((row) => row.composite_hash), `${name} cursor walk`)
  }
})

test('complex search: cursor and offset pages agree, with and without the date-index walk', async () => {
  const db = await seed()
  const { ComplexFilterService } = await import('../src/services/complexFilterService')
  const { buildComplexFilterQuery } = await import('../src/services/complexFilter/complexFilterQueryBuilder')
  const filter = { and_group: [{ category: 'auto_tag', type: 'auto_tag_rating', value: '', rating_type: 'general', min_score: 0.3 }] } as never

  const offsetHashes: string[] = []
  let total = 0
  for (let page = 1; page <= 6; page += 1) {
    const result = await ComplexFilterService.executeComplexSearch(filter, { start_date: '2026-01-03', end_date: '2026-01-15' }, { page, limit: 25, includeStats: false })
    total = result.total
    offsetHashes.push(...result.images.map((image: { composite_hash: string }) => image.composite_hash))
  }
  assert.equal(offsetHashes.length, total, 'offset pages cover the total')
  assert.equal(new Set(offsetHashes).size, offsetHashes.length, 'no repeats across pages')

  const cursorHashes: string[] = []
  let cursorValue: string | number | null | undefined
  let cursorHash: string | undefined
  for (let i = 0; i < 10; i += 1) {
    const result = await ComplexFilterService.executeComplexSearch(filter, { start_date: '2026-01-03', end_date: '2026-01-15' }, {
      page: 1, limit: 25, useCursor: true, includeTotal: false, includeStats: false, cursorValue: cursorValue ?? undefined, cursorHash,
    })
    cursorHashes.push(...result.images.map((image: { composite_hash: string }) => image.composite_hash))
    if (!result.hasMore) break
    cursorValue = result.nextCursorValue
    cursorHash = result.nextCursorHash ?? undefined
  }
  assert.deepEqual(cursorHashes, offsetHashes)

  // The walk option only changes the access path.
  const weights = { general_weight: 1, sensitive_weight: 5, questionable_weight: 15, explicit_weight: 50 } as never
  const plain = buildComplexFilterQuery(filter, weights)
  const walked = buildComplexFilterQuery(filter, weights, undefined, { walkFirstSeenIndex: true })
  const order = 'ORDER BY im.first_seen_date DESC, im.composite_hash DESC LIMIT 1000'
  assert.match(walked.query, /INDEXED BY idx_metadata_first_seen_hash_desc/)
  assert.deepEqual(db.prepare(`${walked.query} ${order}`).all(...walked.params), db.prepare(`${plain.query} ${order}`).all(...plain.params))
})

test('model and LoRA suggestions filter the cached list exactly like LOWER(...) LIKE did', async () => {
  const db = await seed()
  const { AggregateCache } = await import('../src/services/aggregateCache')
  const { MediaMetadataModel } = await import('../src/models/Image/MediaMetadataModel')
  const { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } = await import('../src/utils/sqlLike')
  AggregateCache.clearAll()
  const ready = "COALESCE(media_metadata.postprocess_status, 'ready') = 'ready'"
  for (const query of ['', 'alpha', 'ALPHA', 'ü', 'Ü', '%_', 'v', 'zzz']) {
    const normalized = query.trim().toLowerCase()
    const filter = normalized ? `AND LOWER(model_name) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}` : ''
    const expected = db.prepare(`
      SELECT model_name as value, COUNT(*) as count FROM media_metadata
      WHERE model_name IS NOT NULL AND TRIM(model_name) != '' AND ${ready} ${filter}
      GROUP BY model_name ORDER BY count DESC, model_name ASC LIMIT ?
    `).all(...(normalized ? [buildSqlContainsPattern(normalized)] : []), 3)
    assert.deepEqual(MediaMetadataModel.searchModelSuggestions(query, 3), expected, `model "${query}"`)
  }
  for (const query of ['', 'lora', 'LORA_1', 'a_3', ' lora_2 ']) {
    const normalized = query.trim().toLowerCase()
    const filter = normalized ? `AND LOWER(CAST(lora_item.value AS TEXT)) LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}` : ''
    const expected = db.prepare(`
      SELECT TRIM(CAST(lora_item.value AS TEXT)) as value, COUNT(*) as count
      FROM media_metadata AS metadata
      JOIN json_each(CASE WHEN json_valid(metadata.lora_models) = 1 THEN metadata.lora_models ELSE '[]' END) AS lora_item
      WHERE metadata.lora_models IS NOT NULL AND TRIM(CAST(lora_item.value AS TEXT)) != ''
        AND COALESCE(metadata.postprocess_status, 'ready') = 'ready' ${filter}
      GROUP BY TRIM(CAST(lora_item.value AS TEXT)) ORDER BY count DESC, value ASC LIMIT ?
    `).all(...(normalized ? [buildSqlContainsPattern(normalized)] : []), 4)
    assert.deepEqual(MediaMetadataModel.searchLoraSuggestions(query, 4), expected, `lora "${query}"`)
  }
})

test('id lists come back whole when short and in stable pages when long', async () => {
  const db = await seed()
  const { getImageFileIdsForGroupQuery } = await import('../src/models/GroupImageQueries')
  const { normalizeIdPage, ID_PAGE_DEFAULT_LIMIT, ID_PAGE_MAX_LIMIT } = await import('../src/utils/idPage')
  const big = groupId(db, 'rp-big')
  const whole = getImageFileIdsForGroupQuery(big)
  assert.equal(whole.hasMore, false)
  assert.equal(whole.total, whole.ids.length)
  assert.equal(whole.nextOffset, null)

  const paged: number[] = []
  let offset = 0
  for (let i = 0; i < 100; i += 1) {
    const page = getImageFileIdsForGroupQuery(big, normalizeIdPage({ id_limit: 37, id_offset: offset }))
    assert.equal(page.total, whole.ids.length)
    paged.push(...page.ids)
    if (!page.hasMore) break
    offset = page.nextOffset!
  }
  assert.deepEqual(paged, whole.ids)

  assert.deepEqual(normalizeIdPage({}), { limit: ID_PAGE_DEFAULT_LIMIT, offset: 0 })
  assert.deepEqual(normalizeIdPage({ id_limit: '999999', id_offset: '-4' }), { limit: ID_PAGE_MAX_LIMIT, offset: 0 })
  assert.deepEqual(normalizeIdPage({ id_limit: 0, id_offset: 12.7 }), { limit: ID_PAGE_DEFAULT_LIMIT, offset: 12 })
})

test('hash lookups chunk long lists and keep the single-query order', async () => {
  const db = await seed()
  const { MediaMetadataModel } = await import('../src/models/Image/MediaMetadataModel')
  const { ImageFileModel } = await import('../src/models/Image/ImageFileModel')
  const hashes = Array.from({ length: 240 }, (_, i) => hash(240 - i))
  const many = [...hashes, ...Array.from({ length: 2500 }, (_, i) => hash(100000 + i)), hash(5)]
  const expectedMeta = db.prepare(`SELECT * FROM media_metadata WHERE composite_hash IN (${hashes.map(() => '?').join(',')})`).all(...hashes)
  assert.deepEqual(MediaMetadataModel.findByHashes(many), expectedMeta)
  const expectedFiles = db.prepare(`
    SELECT * FROM image_files WHERE composite_hash IN (${hashes.map(() => '?').join(',')}) AND file_status = 'active'
    ORDER BY composite_hash ASC, last_verified_date DESC, id DESC
  `).all(...hashes)
  assert.deepEqual(ImageFileModel.findActiveByHashes(many), expectedFiles)
})
