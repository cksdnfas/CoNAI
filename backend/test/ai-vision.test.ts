import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * The unified AI worker's Node side: outdated Kaloscope results go back to the auto-tag queue, the merge keeps the
 * tagger when Kaloscope fails, and the vector store round-trips style vectors through vectors.db.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-ai-vision-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}
process.env.AI_RUNTIME_DIR = path.join(root, 'ai-runtime')

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

test('ai vision: outdated Kaloscope results are counted and re-queued, current ones stay', async () => {
  const { db } = await boot()
  const { kaloscopeTaggerService } = await import('../src/services/kaloscopeTaggerService')
  const { KALOSCOPE_MODEL } = await import('../src/services/autoTagsComposeService')

  const insert = db.prepare('INSERT INTO media_metadata (composite_hash, auto_tags) VALUES (?, ?)')
  db.transaction(() => {
    insert.run(hash(1), JSON.stringify({ version: 2, tagger: { model: 'vit' }, kaloscope: { model: 'kaloscope-onnx', status: 'success', artists: { a: 0.9 } } }))
    insert.run(hash(2), JSON.stringify({ version: 2, tagger: { model: 'vit' }, kaloscope: { model: KALOSCOPE_MODEL, status: 'success', artists: { b: 0.8 } } }))
    insert.run(hash(3), JSON.stringify({ version: 2, kaloscope: { model: 'kaloscope-onnx', status: 'failed' } }))
    insert.run(hash(4), JSON.stringify({ version: 2, tagger: { model: 'vit' } }))
    // Enough rows to cross a 500-row chunk boundary.
    for (let n = 10; n < 1210; n += 1) {
      insert.run(hash(n), JSON.stringify({ version: 2, kaloscope: { model: n % 2 ? KALOSCOPE_MODEL : 'kaloscope-onnx' } }))
    }
  })()

  assert.equal(kaloscopeTaggerService.countOutdatedResults(), 602)
  assert.equal(await kaloscopeTaggerService.requeueOutdatedResults(), 602)
  assert.equal(kaloscopeTaggerService.countOutdatedResults(), 0)

  const autoTags = (n: number) => (db.prepare('SELECT auto_tags FROM media_metadata WHERE composite_hash = ?').get(hash(n)) as { auto_tags: string }).auto_tags
  assert.deepEqual(JSON.parse(autoTags(1)), { version: 2, tagger: { model: 'vit' } })
  assert.equal(JSON.parse(autoTags(2)).kaloscope.model, KALOSCOPE_MODEL)
  // The media_metadata triggers re-arm the auto-tag queue for the dropped results only.
  db.prepare("UPDATE media_metadata SET auto_tag_state = 'done' WHERE composite_hash = ?").run(hash(2))
  const state = (n: number) => (db.prepare('SELECT auto_tag_state FROM media_metadata WHERE composite_hash = ?').get(hash(n)) as { auto_tag_state: string }).auto_tag_state
  assert.equal(state(1), 'pending')
  assert.equal(state(2), 'done')
  assert.deepEqual(JSON.parse(autoTags(3)), { version: 2 })
})

test('ai vision: merge keeps the tagger result when Kaloscope failed', async () => {
  const { buildMergedAutoTags } = await import('../src/services/hashTaggingService')
  const tagger = { success: true, taglist: '1girl', rating: { general: 1, sensitive: 0, questionable: 0, explicit: 0 }, general: { '1girl': 0.9 }, character: {}, model: 'vit' }
  const merged = JSON.parse(buildMergedAutoTags(null, tagger, { success: false, error: 'boom', error_type: 'WorkerError' }))
  assert.equal(merged.tagger.model, 'vit')
  assert.equal(merged.kaloscope, undefined)

  const both = JSON.parse(buildMergedAutoTags(null, tagger, { success: true, model: 'kaloscope-3.0-preview', topk: 2, artists: { x: 0.5 }, taglist: 'x' }))
  assert.deepEqual(both.kaloscope.artists, { x: 0.5 })
  assert.equal(both.kaloscope.status, 'success')
})

test('ai vision: style vectors round-trip through vectors.db and search ranks by cosine', async () => {
  await boot()
  const { vectorStore } = await import('../src/services/vectors/vectorStore')
  const { saveMediaStyleVector, MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY } = await import('../src/services/aiWorker/aiVisionService')

  const axis = (i: number, w = 1) => Array.from({ length: 256 }, (_, k) => (k === i ? w : k === i + 1 ? 0.1 : 0))
  saveMediaStyleVector(hash(100), axis(0, 3))
  saveMediaStyleVector(hash(101), axis(5))
  saveMediaStyleVector(hash(102), axis(0, 2).map((v, k) => (k === 7 ? 1 : v)))

  const stored = vectorStore.get(MEDIA_STYLE_SPACE, hash(100), MEDIA_STYLE_MODEL_KEY)
  assert.equal(stored.length, 1)
  const norm = Math.hypot(...Array.from(stored[0].vector))
  assert.ok(Math.abs(norm - 1) < 1e-5, 'stored vectors are L2-normalized')

  const hits = vectorStore.search(MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY, axis(0), { limit: 2 })
  assert.deepEqual(hits.map((hit) => hit.sourceKey), [hash(100), hash(102)])

  // Re-saving replaces, and the cached matrix follows the write.
  saveMediaStyleVector(hash(101), axis(0))
  assert.equal(vectorStore.search(MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY, axis(0), { limit: 1 })[0].score > 0.99, true)
  assert.equal(vectorStore.count(MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY), 3)
})

test('ai vision: PixAI is listed as GPU-only, refused without a usable GPU, and its artist/meta tags are kept', async (t) => {
  await boot()
  const http = await import('node:http')
  const express = (await import('express')).default
  const { taggerSettingsRoutes } = await import('../src/routes/settings/tagger-settings.routes')
  const { settingsService } = await import('../src/services/settingsService')
  const { buildMergedAutoTags } = await import('../src/services/hashTaggingService')

  const app = express()
  app.use(express.json())
  app.use('/api/settings', taggerSettingsRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }

  // No AI runtime here (and not the machine's own python), so no GPU.
  settingsService.updateAiRuntimeSettings({ pythonSource: 'custom', customPythonPath: path.join(root, 'no-python.exe') })
  const models = await call('/api/settings/tagger/models')
  const pixai = models.body.data.find((model: { name: string }) => model.name === 'pixai-v1')
  assert.equal(pixai.requiresGpu, true)
  assert.equal(pixai.available, false)
  assert.equal(models.body.data.find((model: { name: string }) => model.name === 'vit').available, undefined)

  assert.equal((await call('/api/settings/tagger', 'PUT', { model: 'pixai-v1' })).status, 400)
  assert.equal((await call('/api/settings/tagger', 'PUT', { model: 'pixai-v1', device: 'cpu' })).status, 400)
  assert.equal(settingsService.loadSettings().tagger.model, 'vit')
  assert.equal((await call('/api/settings/tagger', 'PUT', { model: 'swinv2' })).status, 200)

  const merged = JSON.parse(buildMergedAutoTags(null, {
    success: true, model: 'pixai-v1', caption: 'a', taglist: 'a', rating: { general: 0.9 }, general: { a: 0.9 }, character: {},
    artist: { someone: 0.93 }, meta: { highres: 0.8 },
  }))
  assert.deepEqual(merged.tagger.artist, { someone: 0.93 })
  assert.deepEqual(merged.tagger.meta, { highres: 0.8 })
  const plain = JSON.parse(buildMergedAutoTags(null, { success: true, model: 'vit', general: { a: 0.9 }, character: {}, artist: {} }))
  assert.equal('artist' in plain.tagger, false)
})
