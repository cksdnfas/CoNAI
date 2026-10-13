import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Image embeddings, Node side, with the Python worker replaced by a concept-vector fake: the background walk over the
 * library (still images with an active file, newest first, then new ones), search by description, similar images by
 * content and by style, the safety filter, pruning, and the routes.
 */

const CONCEPTS: string[][] = [['cat', '고양이'], ['city', '도시'], ['soup', '국']]
const DIM = 256

function fakeVector(text: string, dim = DIM) {
  const vector = new Float32Array(dim)
  vector[CONCEPTS.length] = 1
  CONCEPTS.forEach((words, axis) => {
    for (const word of words) if (text.includes(word)) vector[axis] += 1.5
  })
  let norm = 0
  for (const value of vector) norm += value * value
  return vector.map((value) => value / Math.sqrt(norm))
}

const base64 = (vector: Float32Array) => Buffer.from(vector.buffer).toString('base64')
const hash = (n: number) => n.toString(16).padStart(48, '0')

test('image semantic: index walk, text search, similar images, safety, prune, routes, library search by meaning', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-image-semantic-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.AI_RUNTIME_DIR = path.join(root, 'ai-runtime')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const db = main.db

  const { settingsService } = await import('../src/services/settingsService')
  const embedding = await import('../src/services/aiWorker/textEmbeddingService')
  const requests: Array<{ op: string; payload: any; signal?: AbortSignal }> = []
  let dependencyChecks = 0
  let embedGate: Promise<void> | undefined
  embedding.embeddingRuntime.checkDependencies = async () => {
    dependencyChecks++
    return { available: true, message: 'ok', missingPackages: [], python: 'fake' }
  }
  t.mock.method(embedding.textWorker, 'request', async (op: string, payload: any, options?: { signal?: AbortSignal }) => {
    requests.push({ op, payload, signal: options?.signal })
    // Text at the full dimension, images at its prefix; text searches over images cut the query down.
    if (op === 'embed') assert.equal(payload.dim, embedding.EMBEDDING_DIM)
    if (op === 'embed_images') assert.equal(payload.dim, embedding.IMAGE_EMBEDDING_DIM)
    if (op === 'embed') await embedGate
    if (op === 'embed') return { device: 'cpu', items: payload.items.map((item: { text: string }) => [{ start: 0, end: item.text.length, vector: base64(fakeVector(item.text, payload.dim)) }]) }
    if (op === 'embed_images') {
      return { device: 'cpu', items: payload.images.map((file: string) => (file.includes('broken') ? { error: 'cannot identify image file' } : { vector: base64(fakeVector(path.basename(file), payload.dim)) })) }
    }
    throw new Error(`unexpected op ${op}`)
  })
  const { indexPendingImages, imageIndexCount, imageIndexInternals, pruneImageVectors, searchImagesByText, similarImagesByVector } = await import('../src/services/embeddings/imageIndex')
  const { saveMediaStyleVector } = await import('../src/services/aiWorker/aiVisionService')
  const { RatingScoreModel } = await import('../src/models/RatingScore')

  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)')
  const insertFile = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_type, file_size, mime_type) VALUES (?, ?, ?, ?, ?, 1, ?)")
  const add = (n: number, name: string, status = 'active', type = 'image') => {
    insertMedia.run(hash(n))
    insertFile.run(hash(n), `D:\\lib\\${name}`, folderId, status, type, type === 'video' ? 'video/mp4' : 'image/png')
  }
  db.transaction(() => {
    add(1, 'cat-sofa.png')
    add(2, 'cat-window.png')
    add(3, 'city-night.png')
    add(4, 'soup-bowl.png')
    add(5, 'cat-video.mp4', 'active', 'video')
    add(6, 'cat-gone.png', 'missing')
    add(7, 'broken.png')
  })()

  // Off: nothing is embedded and the worker keeps its text-only instance.
  assert.equal(await indexPendingImages(), 0)
  assert.equal(embedding.embeddingVariant(), 'text')

  settingsService.updateEmbeddingSettings({ enabled: true, imageSearch: true })
  assert.equal(embedding.embeddingVariant(), 'full')

  await t.test('transient worker failure retains the image cursor for the next retry', async t => {
    const before = imageIndexInternals.state()
    t.mock.method(embedding.textWorker, 'request', () => Promise.reject(Object.assign(new Error('stopped'), { errorType: 'WorkerStopped' })))
    await assert.rejects(indexPendingImages(), /stopped/)
    assert.deepEqual(imageIndexInternals.state(), before)
    t.mock.restoreAll()
  })

  let looked = 0
  for (let pass = 0; pass < 10; pass += 1) {
    const done = await indexPendingImages()
    if (done === 0) break
    looked += done
  }
  assert.equal(looked, 5, 'four images and the unreadable one; the video and the missing file are never sent')
  assert.equal(imageIndexCount(), 4)
  assert.ok(requests.filter((request) => request.op === 'embed_images').every((request) => request.payload.images.length === 1),
    'background indexing yields to interactive searches after each image')
  const sent = requests.filter((request) => request.op === 'embed_images').flatMap((request) => request.payload.images as string[])
  assert.deepEqual(sent.map((file) => path.win32.basename(file)), ['broken.png', 'soup-bowl.png', 'city-night.png', 'cat-window.png', 'cat-sofa.png'])
  assert.equal(imageIndexInternals.state().fullPass, true)

  // A new image after the full walk is picked up; the unreadable one waits for the walk to start over.
  add(8, 'cat-garden.png')
  assert.equal(await indexPendingImages(), 1)
  assert.equal(await indexPendingImages(), 0)
  assert.equal(imageIndexCount(), 5)
  imageIndexInternals.ageWalk()
  assert.equal(await indexPendingImages(), 1, 'a new walk retries the unreadable image')
  assert.equal(await indexPendingImages(), 0)
  assert.equal(path.win32.basename(requests.filter((request) => request.op === 'embed_images').at(-1)!.payload.images[0]), 'broken.png')

  // Text search ranks by meaning; queries go out with the full instance's variant.
  const cats = await searchImagesByText('고양이 사진', 3)
  assert.deepEqual(cats?.slice(0, 3).map((hit) => hit.compositeHash).sort(), [hash(1), hash(2), hash(8)].sort())
  assert.equal(requests.filter((request) => request.op === 'embed').at(-1)?.payload.variant, 'full')

  await t.test('warm searches skip runtime probes; cold workers still check dependencies', async (t) => {
    assert.equal(dependencyChecks, 2, 'the failed batch and its successful retry check the cold runtime')
    const cold = t.mock.method(embedding.textWorker, 'loadedModels', () => new Map())
    await Promise.all([embedding.embedQuery('cold cat'), embedding.embedQuery('cold city')])
    assert.equal(dependencyChecks, 3, 'concurrent cold requests share one dependency check')
    cold.mock.restore()
    await embedding.embedQuery('warm cat')
    assert.equal(dependencyChecks, 3)
  })

  await t.test('concurrent searches and retries share work, with independent deadlines and cached copies', async () => {
    embedding.resetEmbeddingBackoff()
    const before = requests.length
    let release!: () => void
    embedGate = new Promise<void>((resolve) => { release = resolve })
    try {
      const short = embedding.embedQuery('shared cat', { waitMs: 5 })
      const patient = embedding.embedQuery(' shared cat ')
      assert.equal(await short, null)
      const retry = embedding.embedQuery('shared cat')
      assert.equal(requests.length - before, 1)
      release()
      const [a, b] = await Promise.all([patient, retry])
      assert.ok(a && b)
      assert.deepEqual(a, b)
      a.fill(0)
      assert.deepEqual(await embedding.embedQuery('shared cat'), b, 'callers cannot mutate the cache')
      assert.equal(requests.length - before, 1)
      await embedding.embedQuery('shared cat', { kind: 'similarity' })
      assert.equal(requests.length - before, 2, 'different tasks have different vectors')
    } finally {
      release()
      embedGate = undefined
    }
  })

  await t.test('reset cannot repopulate the cache with an old in-flight result', async () => {
    let release!: () => void
    embedGate = new Promise<void>((resolve) => { release = resolve })
    const old = embedding.embedQuery('reset cat')
    embedding.resetEmbeddingBackoff()
    release()
    await old
    embedGate = undefined
    const before = requests.length
    await embedding.embedQuery('reset cat')
    assert.equal(requests.length - before, 1)
  })

  await t.test('single and multi-query waits share one batch and cancelling one preserves other consumers', async () => {
    embedding.resetEmbeddingBackoff()
    const before = requests.length
    let release!: () => void
    embedGate = new Promise<void>(resolve => { release = resolve })
    try {
      const multi = embedding.embedQueries(['batch cat', 'batch city', 'batch cat'])
      const controller = new AbortController()
      const cancelled = embedding.embedQuery('batch cat', { signal: controller.signal })
      await new Promise<void>(resolve => setImmediate(resolve))
      controller.abort()
      assert.equal(await cancelled, null)
      assert.equal(requests.length - before, 1)
      assert.equal(requests.at(-1)!.payload.items.length, 2, 'duplicate texts join the same vector')
      assert.equal(requests.at(-1)!.signal!.aborted, false, 'the multi-query caller still needs the work')
      release()
      const result = (await multi)!
      assert.deepEqual(result[0], result[2])
      result[0].fill(0)
      assert.deepEqual(await embedding.embedQuery('batch cat'), result[2])
      assert.equal(requests.length - before, 1)
    } finally { release(); embedGate = undefined }
  })

  await t.test('a settings reset while checking dependencies cannot restart the disabled model', async t => {
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    t.mock.method(embedding.textWorker, 'loadedModels', () => new Map())
    t.mock.method(embedding.embeddingRuntime, 'checkDependencies', async () => { entered(); await gate; return { available: true, message: 'ok', missingPackages: [], python: 'fake' } })
    embedding.resetEmbeddingBackoff()
    const before = requests.length
    const warm = embedding.warmEmbeddingModel()
    await started
    settingsService.updateEmbeddingSettings({ enabled: false })
    embedding.resetEmbeddingBackoff()
    release()
    assert.equal(await warm, false)
    assert.equal(requests.length, before)
    assert.equal(embedding.embeddingFailure(), null)
    settingsService.updateEmbeddingSettings({ enabled: true })
  })

  await t.test('failed query work is removed so a later search can recover', async (t) => {
    const request = embedding.textWorker.request.bind(embedding.textWorker)
    let calls = 0
    t.mock.method(embedding.textWorker, 'request', (...args: Parameters<typeof request>) => {
      if (++calls === 1) return Promise.reject(Object.assign(new Error('worker stopped'), { errorType: 'WorkerStopped' }))
      return request(...args)
    })
    assert.equal(await embedding.embedQuery('recovered cat'), null)
    assert.ok(await embedding.embedQuery('recovered cat'))
    assert.ok(await embedding.embedQuery('recovered cat'))
    assert.equal(calls, 2, 'failure is retried; success is cached')
  })

  await t.test('concurrent library searches share the ranking and refresh it without re-embedding', async (t) => {
    const { vectorStore } = await import('../src/services/vectors/vectorStore')
    const { rankImagesByText } = await import('../src/services/embeddings/imageIndex')
    const search = t.mock.method(vectorStore, 'search')
    const before = requests.length
    const [a, b] = await Promise.all([rankImagesByText('rank cat'), rankImagesByText(' rank cat ')])
    assert.deepEqual(a, b)
    assert.equal(search.mock.callCount(), 1)
    imageIndexInternals.reset()
    await rankImagesByText('rank cat')
    assert.equal(search.mock.callCount(), 2, 'results can refresh as the library changes')
    assert.equal(requests.length - before, 1, 'the query vector survives a ranking refresh')
  })

  // Hidden rating tiers never come back.
  RatingScoreModel.createTier({ tier_name: '테스트 숨김', min_score: 10000, max_score: null, tier_order: -100, color: '#000000', feed_visibility: 'hide' })
  db.prepare('UPDATE media_metadata SET rating_score = 10001 WHERE composite_hash = ?').run(hash(2))
  const visibleCats = await searchImagesByText('cat', 3)
  assert.equal(visibleCats?.some((hit) => hit.compositeHash === hash(2)), false)

  // Similar by content excludes the image itself; by style needs Kaloscope's vectors.
  const similar = similarImagesByVector(hash(1), 'content', 2)
  assert.equal(similar?.[0].compositeHash, hash(8))
  assert.equal(similar?.some((hit) => hit.compositeHash === hash(1)), false)
  assert.equal(similarImagesByVector(hash(3), 'style', 5), null)
  const axis = (i: number) => Array.from({ length: 256 }, (_, k) => (k === i ? 1 : k === 255 ? 0.2 : 0))
  saveMediaStyleVector(hash(3), axis(0))
  saveMediaStyleVector(hash(4), axis(0))
  saveMediaStyleVector(hash(1), axis(9))
  assert.deepEqual(similarImagesByVector(hash(3), 'style', 1)?.map((hit) => hit.compositeHash), [hash(4)])

  // Routes.
  const express = (await import('express')).default
  const { semanticImageRoutes } = await import('../src/routes/images/semantic.routes')
  const app = express()
  app.use('/api/images', semanticImageRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const get = async (url: string) => {
    const response = await fetch(origin + url)
    return { status: response.status, body: await response.json() }
  }
  const search = await get('/api/images/semantic-search?q=soup&limit=2')
  assert.equal(search.status, 200)
  assert.equal(search.body.data.images[0].image.composite_hash, hash(4))
  assert.ok(search.body.data.images[0].similarity > 90)
  assert.equal((await get('/api/images/semantic-search')).status, 400)
  const style = await get(`/api/images/${hash(3)}/similar-style?limit=5`)
  assert.equal(style.status, 200)
  assert.deepEqual(style.body.data.similar.map((item: any) => item.image.composite_hash), [hash(4), hash(1)])
  assert.equal((await get(`/api/images/${hash(2)}/similar-content`)).status, 403)
  assert.equal((await get(`/api/images/${hash(99)}/similar-content`)).status, 404)
  assert.equal((await get(`/api/images/${hash(7)}/similar-content`)).status, 409, 'no vector for the unreadable image')

  // Which sections the detail page shows.
  assert.deepEqual((await get(`/api/images/${hash(3)}/vector-similarity`)).body.data, { content: true, style: true })
  assert.deepEqual((await get(`/api/images/${hash(7)}/vector-similarity`)).body.data, { content: false, style: false })

  // Library search ordered by a description, mixed with chip filters; hidden tiers stay out.
  const complexRoutes = (await import('../src/routes/images/complex-search.routes')).default
  const searchApp = express()
  searchApp.use(express.json())
  searchApp.use('/api/images/search/complex', complexRoutes)
  const searchServer = http.createServer(searchApp)
  await new Promise<void>((resolve) => searchServer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => searchServer.close(() => resolve())))
  const searchOrigin = `http://127.0.0.1:${(searchServer.address() as { port: number }).port}`
  const complex = async (body: unknown) => {
    const response = await fetch(`${searchOrigin}/api/images/search/complex`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  db.prepare("UPDATE media_metadata SET model_name = 'excluded-model' WHERE composite_hash = ?").run(hash(8))
  const byMeaning = await complex({ meaning: { text: 'cat' }, pagination: 'cursor', limit: 1 })
  assert.equal(byMeaning.status, 200)
  assert.equal(byMeaning.body.data.total, 2, 'the two visible cats; city/soup score under the floor, the hidden cat is filtered')
  assert.equal(byMeaning.body.data.images.length, 1)
  assert.ok(byMeaning.body.data.images[0].meaning_score > 64)
  assert.equal(byMeaning.body.data.hasMore, true)
  const nextPage = await complex({ meaning: { text: 'cat' }, pagination: 'cursor', limit: 1, cursorValue: byMeaning.body.data.nextCursorValue, cursorHash: byMeaning.body.data.nextCursorHash })
  assert.equal(nextPage.body.data.images.length, 1)
  assert.notEqual(nextPage.body.data.images[0].composite_hash, byMeaning.body.data.images[0].composite_hash)
  assert.equal(nextPage.body.data.hasMore, false)
  const filtered = await complex({
    meaning: { text: 'cat' },
    complex_filter: { exclude_group: [{ category: 'basic', type: 'model_name', value: 'excluded-model' }] },
  })
  assert.deepEqual(filtered.body.data.images.map((image: any) => image.composite_hash), [hash(1)])
  const plain = await complex({ complex_filter: { exclude_group: [{ category: 'basic', type: 'model_name', value: 'excluded-model' }] } })
  assert.equal(plain.status, 200)
  assert.equal(plain.body.data.images[0].meaning_score, undefined)

  // Media that is gone loses its vector.
  db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(hash(4))
  db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hash(4))
  settingsService.updateEmbeddingSettings({ enabled: false })
  assert.equal(pruneImageVectors(true), 2, 'content and style are both removed, even with embeddings off')
  const { vectorStore } = await import('../src/services/vectors/vectorStore')
  const { MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY } = await import('../src/services/aiWorker/aiVisionService')
  assert.equal(vectorStore.get(MEDIA_STYLE_SPACE, hash(4), MEDIA_STYLE_MODEL_KEY).length, 0)
  settingsService.updateEmbeddingSettings({ enabled: true })
  assert.equal(imageIndexCount(), 4)

  // Off again: search answers 409 and the walk stops.
  settingsService.updateEmbeddingSettings({ imageSearch: false })
  assert.equal((await get('/api/images/semantic-search?q=cat')).status, 409)
  assert.equal((await complex({ meaning: { text: 'cat' } })).status, 409)
  assert.deepEqual((await get(`/api/images/${hash(1)}/vector-similarity`)).body.data, { content: false, style: true }, 'style vectors do not depend on image search')
  assert.equal(await searchImagesByText('cat', 3), null)
  assert.equal(embedding.embeddingVariant(), 'text')

  await t.test('an image deleted while inference is pending is not indexed again', async t => {
    settingsService.updateEmbeddingSettings({ imageSearch: true })
    add(99, 'cat-race.png')
    const request = embedding.textWorker.request.bind(embedding.textWorker)
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    t.mock.method(embedding.textWorker, 'request', async (...args: Parameters<typeof request>) => {
      if (args[0] === 'embed_images') { entered(); await gate }
      return request(...args)
    })
    const pending = indexPendingImages()
    try {
      await started
      db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(hash(99))
      db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hash(99))
      release()
      await pending
      const { vectorStore } = await import('../src/services/vectors/vectorStore')
      assert.equal(vectorStore.get('media-image', hash(99), embedding.IMAGE_EMBEDDING_MODEL_KEY).length, 0)
    } finally { release(); await pending; settingsService.updateEmbeddingSettings({ imageSearch: false }) }
  })
})
