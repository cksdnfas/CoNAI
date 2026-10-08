import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// Migrations and the services resolve runtime paths at import time; keep everything in a scratch folder.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-similarity-index-'))
process.env.RUNTIME_BASE_PATH = scratchDir
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'
import { db, migrationManager } from '../src/database/init'
import { MigrationManager } from '../src/database/migrationManager'
import * as migration042 from '../src/database/migrations/042_add_media_similarity_index'
import { ImageSimilarityModel } from '../src/models/Image/ImageSimilarityModel'
import { colorDescriptorColumns, MediaImageFeaturesModel } from '../src/models/Image/MediaImageFeaturesModel'
import { planBandLayout, greedyDuplicateGroups } from '../src/models/Image/duplicateGrouping'
import {
  bandProbeRadius,
  bandProbeValues,
  hamming64,
  hammingSql,
  hashBands,
  hashParams,
  parseHash64,
  popcount32,
} from '../src/models/Image/similarityIndexSql'
import { encodeColorHistogram, ImageSimilarityService } from '../src/services/imageSimilarity'
import { PromptSimilarityService } from '../src/services/promptSimilarityService'
import { DuplicateGroupScanStore } from '../src/services/duplicateGroupScanStore'
import type { ColorHistogram } from '../src/types/similarity'

/**
 * Indexed similarity search (migration 042): band probing must never miss a match, the index must follow every
 * write, and every indexed search must return exactly what the original full candidate scan returns.
 */

// ---------- deterministic data ----------
let seed = 20261008
function rand(): number {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randInt = (n: number) => Math.floor(rand() * n)
const toHex = (hi: number, lo: number) => (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0')
const randomHash = () => toHex(randInt(2 ** 32), randInt(2 ** 32))
function flipBits(hex: string, bits: number[]): string {
  const value = parseHash64(hex)!
  let { hi, lo } = value
  for (const bit of bits) {
    if (bit < 32) hi = (hi ^ (1 << (31 - bit))) >>> 0
    else lo = (lo ^ (1 << (63 - bit))) >>> 0
  }
  return toHex(hi, lo)
}
function randomFlips(hex: string, count: number): string {
  const bits = new Set<number>()
  while (bits.size < count) bits.add(randInt(64))
  return flipBits(hex, [...bits])
}
function bigIntDistance(left: string, right: string): number {
  let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  let distance = 0
  while (xor > 0n) { xor &= xor - 1n; distance += 1 }
  return distance
}

function makeHistogram(base: [number, number, number], spread: number, withDescriptor: boolean): ColorHistogram {
  const channels = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)]
  for (let pixel = 0; pixel < 1024; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.max(0, Math.min(255, Math.round(base[channel] + (rand() + rand() - 1) * spread)))
      channels[channel][value] += 1
    }
  }
  const histogram: ColorHistogram = {
    r: channels[0].map((count) => count / 1024),
    g: channels[1].map((count) => count / 1024),
    b: channels[2].map((count) => count / 1024),
  }
  if (withDescriptor) histogram.descriptor = ImageSimilarityService.colorDescriptor(histogram)
  return histogram
}

// ---------- pure helpers ----------
test('popcount and Hamming helpers agree with BigInt', () => {
  for (let i = 0; i < 2000; i += 1) {
    const left = randomHash()
    const right = rand() < 0.5 ? randomFlips(left, randInt(65)) : randomHash()
    assert.equal(hamming64(parseHash64(left)!, parseHash64(right)!), bigIntDistance(left, right))
    const value = randInt(2 ** 32)
    assert.equal(popcount32(value), value.toString(2).split('').filter((c) => c === '1').length)
  }
  assert.equal(parseHash64('0123456789abcdeF')?.hi, 0x01234567)
  assert.equal(parseHash64('0123456789abcde'), null)
  assert.equal(parseHash64('0123456789abcdeg'), null)
})

test('SQL Hamming distance equals the JS distance', () => {
  const memory = new Database(':memory:')
  memory.exec('CREATE TABLE t (p_hi INTEGER, p_lo INTEGER, expected INTEGER)')
  const target = parseHash64(randomHash())!
  const insert = memory.prepare('INSERT INTO t VALUES (?, ?, ?)')
  for (let i = 0; i < 3000; i += 1) {
    const other = parseHash64(i % 3 === 0 ? randomFlips(toHex(target.hi, target.lo), randInt(65)) : randomHash())!
    insert.run(other.hi, other.lo, hamming64(target, other))
  }
  insert.run(0, 0, hamming64(target, { hi: 0, lo: 0 }))
  insert.run(0xffffffff, 0xffffffff, hamming64(target, { hi: 0xffffffff, lo: 0xffffffff }))
  const wrong = memory.prepare(`SELECT COUNT(*) AS c FROM t s WHERE ${hammingSql('s', 'p', 't')} != s.expected`).get(hashParams('t', target)) as { c: number }
  assert.equal(wrong.c, 0)
  memory.close()
})

test('band probing finds every hash within the threshold (pigeonhole over four 16-bit bands)', () => {
  const found = (target: string, other: string, threshold: number) => {
    const radius = bandProbeRadius(threshold)
    const targetBands = hashBands(parseHash64(target)!)
    const otherBands = hashBands(parseHash64(other)!)
    return targetBands.some((band, index) => bandProbeValues(band, radius).includes(otherBands[index]))
  }
  const base = randomHash()
  // Exhaustive for one and two flipped bits at every threshold that can include them.
  for (let a = 0; a < 64; a += 1) {
    for (let threshold = 1; threshold <= 15; threshold += 1) assert.ok(found(base, flipBits(base, [a]), threshold))
    for (let b = a + 1; b < 64; b += 1) {
      for (let threshold = 2; threshold <= 15; threshold += 1) assert.ok(found(base, flipBits(base, [a, b]), threshold), `${a},${b} t=${threshold}`)
    }
  }
  // Randomised for every distance up to every threshold 0..15, including all bits packed into one band.
  for (let threshold = 0; threshold <= 15; threshold += 1) {
    for (let distance = 0; distance <= threshold; distance += 1) {
      for (let trial = 0; trial < 150; trial += 1) {
        const target = randomHash()
        assert.ok(found(target, randomFlips(target, distance), threshold), `d=${distance} t=${threshold}`)
      }
      if (distance <= 16) {
        const packed = Array.from({ length: distance }, (_unused, index) => index) // all in band 0
        assert.ok(found(base, flipBits(base, packed), threshold) || distance > threshold)
      }
    }
  }
  assert.deepEqual(bandProbeValues(0, 0), [0])
  assert.equal(bandProbeValues(0, 3).length, 1 + 16 + 120 + 560)
  assert.equal(new Set(bandProbeValues(12345, 3)).size, 697)
})

test('greedy grouping equals the O(n²) greedy scan for every threshold, including uneven band layouts', async () => {
  for (const threshold of [0, 1, 2, 3, 5, 8, 12]) {
    const count = 600
    const hashes: string[] = []
    for (let i = 0; i < count; i += 1) {
      hashes.push(i > 20 && rand() < 0.4 ? randomFlips(hashes[randInt(hashes.length)], randInt(threshold + 3)) : randomHash())
    }
    const hi = Uint32Array.from(hashes, (hash) => parseHash64(hash)!.hi)
    const lo = Uint32Array.from(hashes, (hash) => parseHash64(hash)!.lo)
    const layout = planBandLayout(count, threshold)
    assert.ok(layout)
    const keepSingleton = (position: number) => position % 7 === 0
    const banded = await greedyDuplicateGroups(hi, lo, threshold, layout!, keepSingleton)

    const reference: number[][] = []
    const grouped = new Uint8Array(count)
    for (let i = 0; i < count; i += 1) {
      if (grouped[i]) continue
      grouped[i] = 1
      const group = [i]
      for (let j = i + 1; j < count; j += 1) {
        if (!grouped[j] && bigIntDistance(hashes[i], hashes[j]) <= threshold) { group.push(j); grouped[j] = 1 }
      }
      if (group.length > 1 || keepSingleton(i)) reference.push(group)
    }
    assert.deepEqual(banded, reference, `threshold ${threshold}`)
  }
  assert.equal(planBandLayout(1_000_000, 30), null, 'refuses thresholds that would compare most pairs')
})

// ---------- database-backed ----------
const HASH_COLUMNS = ['p_hi', 'p_lo', 'p_b0', 'p_b1', 'p_b2', 'p_b3', 'd_hi', 'd_lo', 'a_hi', 'a_lo', 'pos_hi', 'pos_lo', 'neg_hi', 'neg_lo', 'auto_hi', 'auto_lo', 'prompt_unparsed']

function expectedIndexRow(row: { perceptual_hash: string | null; dhash: string | null; ahash: string | null; prompt_similarity_algorithm: string | null; pos: string | null; neg: string | null; auto: string | null }) {
  const p = parseHash64(row.perceptual_hash)
  const d = parseHash64(row.dhash)
  const a = parseHash64(row.ahash)
  const simhash = row.prompt_similarity_algorithm === 'simhash'
  const fp = (value: string | null) => (simhash ? parseHash64(value) : null)
  const bands = p ? hashBands(p) : [null, null, null, null]
  const unparsed = simhash && [row.pos, row.neg, row.auto].some((value) => value !== null && parseHash64(value) === null) ? 1 : 0
  return [p?.hi ?? null, p?.lo ?? null, ...bands, d?.hi ?? null, d?.lo ?? null, a?.hi ?? null, a?.lo ?? null,
    fp(row.pos)?.hi ?? null, fp(row.pos)?.lo ?? null, fp(row.neg)?.hi ?? null, fp(row.neg)?.lo ?? null, fp(row.auto)?.hi ?? null, fp(row.auto)?.lo ?? null, unparsed]
}

function readIndexRows(database: Database.Database) {
  return database.prepare(`
    SELECT mm.composite_hash, mm.perceptual_hash, mm.dhash, mm.ahash, mm.prompt_similarity_algorithm,
      mm.pos_prompt_fingerprint AS pos, mm.neg_prompt_fingerprint AS neg, mm.auto_prompt_fingerprint AS auto,
      ${HASH_COLUMNS.map((column) => `s.${column} AS s_${column}`).join(', ')}
    FROM media_metadata mm LEFT JOIN media_similarity_index s ON s.media_id = mm.media_id
    ORDER BY mm.media_id
  `).all() as any[]
}

let folderId = 1
let mediaCounter = 0
// Unique per run: other test files may share this process and its database.
const runPrefix = randomUUID().replace(/-/g, '').slice(0, 16)
const insertMedia = (values: Record<string, unknown>) => {
  mediaCounter += 1
  const hash = (values.composite_hash as string) ?? `${runPrefix}${mediaCounter.toString(16).padStart(8, '0')}${'0'.repeat(24)}`
  db.prepare(`
    INSERT INTO media_metadata (composite_hash, perceptual_hash, dhash, ahash, width, height, rating_score, postprocess_status,
      prompt_similarity_algorithm, prompt_similarity_version, pos_prompt_fingerprint, neg_prompt_fingerprint, auto_prompt_fingerprint,
      pos_prompt_normalized, neg_prompt_normalized, auto_prompt_normalized, auto_tags, auto_tag_state)
    VALUES (@hash, @p, @d, @a, @w, @h, @rating, @pp, @alg, 1, @pos, @neg, @auto, @posN, @negN, @autoN, '{}', 'done')
  `).run({
    hash, p: null, d: null, a: null, w: 512, h: 512, rating: 0, pp: 'ready', alg: 'simhash', pos: null, neg: null, auto: null,
    posN: null, negN: null, autoN: null,
    ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'composite_hash')),
  })
  return hash
}
const insertFile = (hash: string, status = 'active') => db.prepare(`
  INSERT INTO image_files (composite_hash, file_type, original_file_path, folder_id, file_status, file_size, mime_type)
  VALUES (?, 'image', ?, ?, ?, ?, 'image/png')
`).run(hash, `D:/t/${hash}-${randInt(1e9)}.png`, folderId, status, 1000 + randInt(100000))

before(async () => {
  await migrationManager.migrate({ requireBaseline: true })
  folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
})

after(() => {
  db.close()
})

test('triggers keep media_similarity_index in step with inserts, updates and deletes', () => {
  const cases = [
    { p: randomHash(), d: randomHash(), a: randomHash(), alg: 'simhash', pos: randomHash(), neg: null, auto: randomHash().toUpperCase() },
    { p: 'ABCDEF0123456789', d: null, a: 'zz00000000000000', alg: 'simhash', pos: 'not-a-hash', neg: null, auto: null },
    { p: null, d: randomHash(), a: null, alg: 'minhash', pos: randomHash(), neg: randomHash(), auto: null },
    { p: '123', d: randomHash(), a: randomHash(), alg: null, pos: null, neg: null, auto: null },
  ]
  const hashes = cases.map((values) => insertMedia(values))
  const check = () => {
    for (const row of readIndexRows(db).filter((item) => hashes.includes(item.composite_hash))) {
      assert.deepEqual(HASH_COLUMNS.map((column) => row[`s_${column}`]), expectedIndexRow(row), row.composite_hash)
    }
  }
  check()

  db.prepare('UPDATE media_metadata SET perceptual_hash = ?, dhash = NULL WHERE composite_hash = ?').run(randomHash(), hashes[0])
  db.prepare("UPDATE media_metadata SET pos_prompt_fingerprint = ?, prompt_similarity_algorithm = 'simhash' WHERE composite_hash = ?").run(randomHash(), hashes[2])
  db.prepare('UPDATE media_metadata SET perceptual_hash = ? WHERE composite_hash = ?').run(randomHash(), hashes[3])
  check()

  const mediaId = (db.prepare('SELECT media_id FROM media_metadata WHERE composite_hash = ?').get(hashes[1]) as { media_id: number }).media_id
  db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hashes[1])
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM media_similarity_index WHERE media_id = ?').get(mediaId) as { c: number }).c, 0)
})

test('setHistogram mirrors the colour descriptor into the index, and clears it with the histogram', () => {
  const hash = insertMedia({ p: randomHash() })
  const read = () => db.prepare(`
    SELECT s.avg_r, s.avg_g, s.avg_b, s.dom_r, s.dom_g, s.dom_b, s.luminance, s.saturation
    FROM media_similarity_index s JOIN media_metadata mm ON mm.media_id = s.media_id WHERE mm.composite_hash = ?
  `).raw().get(hash) as number[]

  const withDescriptor = makeHistogram([200, 40, 90], 40, true)
  MediaImageFeaturesModel.setHistogram(hash, withDescriptor)
  assert.deepEqual(read(), colorDescriptorColumns(withDescriptor))

  const withoutDescriptor = makeHistogram([20, 140, 220], 60, false)
  MediaImageFeaturesModel.setHistogram(hash, encodeColorHistogram(withoutDescriptor))
  assert.deepEqual(read(), colorDescriptorColumns(withoutDescriptor))
  assert.deepEqual(read(), colorDescriptorColumns(ImageSimilarityService.deserializeHistogram(MediaImageFeaturesModel.getHistogram(hash)!)))

  MediaImageFeaturesModel.setHistogram(hash, null)
  assert.deepEqual(read(), new Array(8).fill(null))
})

test('migration 042 backfills an existing library on fresh and existing databases', async () => {
  // Fresh DB: table, indexes and triggers exist.
  const freshPath = path.join(scratchDir, 'fresh-042.db')
  const fresh = new Database(freshPath)
  fresh.pragma('foreign_keys = ON')
  await new MigrationManager(fresh).migrate({ requireBaseline: true })
  const objects = (fresh.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%similarity_index%' OR name LIKE 'idx_media_similarity%'").all() as Array<{ name: string }>).map((row) => row.name)
  for (const name of ['media_similarity_index', 'trg_media_similarity_index_insert', 'trg_media_similarity_index_update', 'trg_media_similarity_index_delete', 'idx_media_similarity_p_b0', 'idx_media_similarity_color']) {
    assert.ok(objects.includes(name), name)
  }

  // Existing DB at 041: rows and histograms written before the index existed.
  fresh.exec(`
    DROP TRIGGER trg_media_similarity_index_insert; DROP TRIGGER trg_media_similarity_index_update;
    DROP TRIGGER trg_media_similarity_index_delete; DROP TABLE media_similarity_index;
    DELETE FROM migrations WHERE version = '042_add_media_similarity_index';
  `)
  const insert = fresh.prepare(`
    INSERT INTO media_metadata (composite_hash, perceptual_hash, dhash, ahash, prompt_similarity_algorithm, pos_prompt_fingerprint, neg_prompt_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const histograms = new Map<number, ColorHistogram>()
  for (let i = 0; i < 300; i += 1) {
    const info = insert.run(`old${i.toString().padStart(45, '0')}`, i % 17 === 0 ? null : randomHash(), randomHash(), i % 5 === 0 ? 'BAD' : randomHash(),
      i % 9 === 0 ? 'minhash' : 'simhash', i % 4 === 0 ? null : randomHash(), i % 11 === 0 ? 'xyz' : randomHash())
    if (i % 3 !== 0) {
      const histogram = makeHistogram([randInt(256), randInt(256), randInt(256)], 30, i % 2 === 0)
      histograms.set(Number(info.lastInsertRowid), histogram)
      // Legacy shapes too: counts with and without descriptor, deflated JSON, plain JSON text.
      const value = i % 10 === 1 ? JSON.stringify(histogram) : encodeColorHistogram(i % 10 === 2 ? { ...histogram, extra: 1 } as any : histogram)
      fresh.prepare('INSERT INTO media_image_features (media_id, color_histogram) VALUES (?, ?)').run(Number(info.lastInsertRowid), value)
    }
  }
  await new MigrationManager(fresh).migrate()

  for (const row of readIndexRows(fresh)) {
    assert.deepEqual(HASH_COLUMNS.map((column) => row[`s_${column}`]), expectedIndexRow(row), row.composite_hash)
  }
  const descriptors = fresh.prepare('SELECT media_id, avg_r, avg_g, avg_b, dom_r, dom_g, dom_b, luminance, saturation FROM media_similarity_index').raw().all() as number[][]
  for (const [mediaId, ...values] of descriptors) {
    const histogram = histograms.get(mediaId)
    assert.deepEqual(values, histogram ? colorDescriptorColumns(histogram) : new Array(8).fill(null), `media ${mediaId}`)
  }
  // The migration's descriptor copy agrees with the runtime one on the stored BLOBs.
  for (const [mediaId, histogram] of histograms) {
    const stored = fresh.prepare('SELECT color_histogram FROM media_image_features WHERE media_id = ?').get(mediaId) as { color_histogram: Buffer | string }
    assert.deepEqual(migration042.descriptorColumnValues(migration042.descriptorFromStoredHistogram(stored.color_histogram)), colorDescriptorColumns(histogram))
  }
  fresh.close()
})

// ---------- equivalence with the original full scan ----------
type Canon = Array<Record<string, unknown>>
function canonical(list: any[], primary: (match: any) => number[]): Canon {
  const key = (match: any) => `${match.image?.composite_hash}|${match.image?.file_id ?? ''}`
  return list
    .map((match) => ({ match, p: primary(match) }))
    .sort((a, b) => {
      for (let i = 0; i < a.p.length; i += 1) if (a.p[i] !== b.p[i]) return b.p[i] - a.p[i]
      return key(a.match) < key(b.match) ? -1 : key(a.match) > key(b.match) ? 1 : 0
    })
    .map(({ match }) => ({
      k: key(match), s: match.similarity, h: match.hammingDistance, t: match.matchType,
      c: match.colorSimilarity ?? null, cs: match.componentScores ? JSON.stringify(match.componentScores) : null,
    }))
}

let targets: string[] = []

test('seed a library with near-duplicate clusters', () => {
  const seeds: Array<{ p: string; d: string; a: string; color: [number, number, number]; pos: string; neg: string; auto: string }> = []
  for (let i = 0; i < 1500; i += 1) {
    const roll = rand()
    let s
    if (seeds.length > 10 && roll < 0.35) {
      const base = seeds[randInt(seeds.length)]
      const flips = roll < 0.07 ? 0 : roll < 0.2 ? 1 + randInt(5) : 4 + randInt(16)
      s = {
        p: randomFlips(base.p, flips), d: randomFlips(base.d, flips + randInt(3)), a: randomFlips(base.a, flips + randInt(4)),
        color: base.color.map((value) => Math.max(0, Math.min(255, value + (rand() - 0.5) * 30))) as [number, number, number],
        pos: randomFlips(base.pos, randInt(20)), neg: randomFlips(base.neg, randInt(12)), auto: randomFlips(base.auto, randInt(24)),
      }
    } else {
      s = { p: randomHash(), d: randomHash(), a: randomHash(), color: [randInt(256), randInt(256), randInt(256)] as [number, number, number], pos: randomHash(), neg: randomHash(), auto: randomHash() }
      seeds.push(s)
    }
    const hash = insertMedia({
      p: s.p, d: rand() < 0.03 ? null : s.d, a: rand() < 0.03 ? null : s.a,
      w: 512 + 64 * randInt(6), h: 512 + 64 * randInt(6), rating: randInt(30), pp: rand() < 0.01 ? 'pending' : 'ready',
      alg: rand() < 0.03 ? null : 'simhash',
      pos: rand() < 0.05 ? null : s.pos, neg: rand() < 0.3 ? null : s.neg, auto: rand() < 0.1 ? null : s.auto,
      posN: 'p', negN: 'n', autoN: 'a',
    })
    const files = rand() < 0.1 ? 2 : rand() < 0.03 ? 0 : 1
    for (let f = 0; f < files; f += 1) insertFile(hash, rand() < 0.05 ? 'missing' : 'active')
    if (rand() < 0.95) MediaImageFeaturesModel.setHistogram(hash, makeHistogram(s.color, 20 + randInt(70), rand() < 0.9))
  }
  const pool = (db.prepare(`
    SELECT mm.composite_hash FROM media_metadata mm JOIN media_image_features mf ON mf.media_id = mm.media_id
    WHERE mm.perceptual_hash IS NOT NULL AND mm.postprocess_status = 'ready' ORDER BY mm.media_id
  `).all() as Array<{ composite_hash: string }>).map((row) => row.composite_hash)
  targets = Array.from({ length: 40 }, () => pool[randInt(pool.length)])
  assert.equal(targets.length, 40)
})

test('findDuplicates: indexed candidates equal the full scan', async () => {
  let nonEmpty = 0
  for (const [index, target] of targets.entries()) {
    for (const threshold of [0, 3, 5, 8]) {
      const options = { threshold, includeMetadata: index % 2 === 0 }
      const indexed = await ImageSimilarityModel.findDuplicates(target, options)
      const full = await ImageSimilarityModel.findDuplicates(target, { ...options, candidateStrategy: 'full-scan' })
      const primary = (m: any) => [m.similarity, -m.hammingDistance]
      assert.deepEqual(canonical(indexed, primary), canonical(full, primary), `${target} t=${threshold}`)
      if (full.length > 0) nonEmpty += 1
    }
  }
  assert.ok(nonEmpty > 10, `duplicate searches with results: ${nonEmpty}`)
})

test('findSimilar: indexed candidates equal the full scan (band path, scan path, colour gate)', async () => {
  const variants = [
    { threshold: 15 }, { threshold: 5 }, { threshold: 10 }, { threshold: 16 }, { threshold: 24 },
    { threshold: 15, includeColorSimilarity: true },
    { threshold: 15, includeColorSimilarity: true, weights: { perceptualHash: 50, dHash: 30, aHash: 20, color: 15 }, thresholds: { perceptualHash: 15, dHash: 18, aHash: 20, color: 75 } },
    { threshold: 12, useMetadataFilter: true },
    { threshold: 15, weights: { perceptualHash: 0, dHash: 60, aHash: 40, color: 0 } }, // falls back to the full scan
    { threshold: 15, sortBy: 'file_size' as const },
  ]
  let nonEmpty = 0
  for (const target of targets) {
    for (const variant of variants) {
      const options = { ...variant, limit: 100000 }
      const indexed = await ImageSimilarityModel.findSimilar(target, options)
      const full = await ImageSimilarityModel.findSimilar(target, { ...options, candidateStrategy: 'full-scan' })
      const primary = variant.sortBy === 'file_size' ? (m: any) => [Number(m.image?.file_size || 0)] : (m: any) => [m.similarity]
      assert.deepEqual(canonical(indexed, primary), canonical(full, primary), `${target} ${JSON.stringify(variant)}`)
      if (full.length > 0) nonEmpty += 1
    }
  }
  assert.ok(nonEmpty > 40, `similar searches with results: ${nonEmpty}`)
})

test('findSimilarByColor: ranked descriptor scan equals the full scan, including the limit cut', async () => {
  for (const target of targets) {
    for (const threshold of [70, 85, 92, 98]) {
      const full = await ImageSimilarityModel.findSimilarByColor(target, threshold, 100000, { candidateStrategy: 'full-scan' })
      const indexed = await ImageSimilarityModel.findSimilarByColor(target, threshold, 100000)
      const primary = (m: any) => [m.colorSimilarity || 0]
      assert.deepEqual(canonical(indexed, primary), canonical(full, primary), `${target} t=${threshold}`)
      // With a small limit the indexed search keeps the best scores (ties broken by media id, then file id).
      const top = await ImageSimilarityModel.findSimilarByColor(target, threshold, 15)
      assert.deepEqual(top.map((m) => m.colorSimilarity), canonical(full, primary).slice(0, 15).map((m) => m.c))
    }
  }
})

test('prompt similarity: indexed ranking equals the full scan', () => {
  const base = PromptSimilarityService.getEffectiveSettings()
  const variants = [
    base,
    { ...base, combinedThreshold: 70, fieldThresholds: { positive: 60, negative: 40, auto: 50 } },
    { ...base, combinedThreshold: 30, fieldThresholds: { positive: 0, negative: 0, auto: 0 }, weights: { positive: 2, negative: 0, auto: 1 } },
    { ...base, combinedThreshold: 80, fieldThresholds: { positive: 75, negative: 75, auto: 75 } },
    { ...base, combinedThreshold: 0, fieldThresholds: { positive: 0, negative: 0, auto: 0 }, weights: { positive: 1, negative: 1.5, auto: 0.25 } },
  ]
  const original = PromptSimilarityService.getEffectiveSettings
  try {
    for (const target of targets) {
      for (const variant of variants) {
        PromptSimilarityService.getEffectiveSettings = () => ({ ...variant, resultLimit: 100 })
        const shape = (list: any[]) => list.map((m) => ({ k: m.image?.composite_hash, s: m.combinedSimilarity, f: JSON.stringify([m.positive, m.negative, m.auto]) }))
        const indexed = shape(PromptSimilarityService.findSimilarByCompositeHash(target, 100))
        const full = shape(PromptSimilarityService.findSimilarByCompositeHash(target, 100, { candidateStrategy: 'full-scan' }))
        assert.equal(indexed.length, full.length)
        // Same scores in the same order; at the cut, rows tied on the last score may differ (the full scan has no
        // tie order), so compare those as counts.
        assert.deepEqual(indexed.map((m) => m.s), full.map((m) => m.s))
        const cut = full.length === 100 ? full[full.length - 1].s : null
        const strict = (list: typeof full) => list.filter((m) => m.s !== cut).sort((a, b) => (b.s - a.s) || (a.k < b.k ? -1 : 1))
        assert.deepEqual(strict(indexed), strict(full), `${target} ${JSON.stringify(variant.fieldThresholds)}`)
      }
    }
  } finally {
    PromptSimilarityService.getEffectiveSettings = original
  }
})

test('findAllDuplicateGroups: banded grouping equals the full scan; refs round-trip through the scan store', async () => {
  for (const threshold of [0, 5, 8]) {
    for (const minGroupSize of [1, 2]) {
      const options = { threshold, minGroupSize, allowLargeSyncScan: true }
      const indexed = await ImageSimilarityModel.findAllDuplicateGroups(options)
      const full = await ImageSimilarityModel.findAllDuplicateGroups({ ...options, candidateStrategy: 'full-scan' })
      assert.deepEqual(indexed, full, `t=${threshold} min=${minGroupSize}`)
      if (threshold === 5 && minGroupSize === 2) assert.ok(full.length > 20)
    }
  }

  const refs = await ImageSimilarityModel.scanDuplicateGroupRefs({ threshold: 5, minGroupSize: 2 })
  DuplicateGroupScanStore.write('test-job_1', refs)
  assert.deepEqual(DuplicateGroupScanStore.read('test-job_1'), refs)
  assert.equal(DuplicateGroupScanStore.read('../escape'), null)
  assert.deepEqual(
    ImageSimilarityModel.hydrateDuplicateGroupRefs(DuplicateGroupScanStore.read('test-job_1')!.slice(0, 10)),
    (await ImageSimilarityModel.findAllDuplicateGroups({ threshold: 5, minGroupSize: 2, allowLargeSyncScan: true })).slice(0, 10),
  )
})
