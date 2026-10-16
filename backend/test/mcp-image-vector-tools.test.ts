import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * The chat's image-embedding tools: search_images_by_meaning (the library's 설명 search) and find_similar_images
 * (the detail page's 내용 유사 / 화풍 유사), with the Python worker replaced by a concept-vector fake. They answer
 * like the routes: off → says so, no vector → says so, hidden tiers never come back.
 */

const CONCEPTS: string[][] = [['cat', '고양이'], ['city', '도시'], ['soup', '국']]
const DIM = 256

function fakeVector(text: string) {
  const vector = new Float32Array(DIM)
  vector[DIM - 1] = 1
  CONCEPTS.forEach((words, axis) => {
    for (const word of words) if (text.includes(word)) vector[axis] += 1.5
  })
  let norm = 0
  for (const value of vector) norm += value * value
  return vector.map((value) => value / Math.sqrt(norm))
}

const base64 = (vector: Float32Array) => Buffer.from(vector.buffer).toString('base64')
const hash = (n: number) => n.toString(16).padStart(48, '0')

test('mcp image vector tools: meaning search, similar content and style, off and missing-vector answers', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-mcp-image-vector-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.AI_RUNTIME_DIR = path.join(root, 'ai-runtime')
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const db = main.db

  const { settingsService } = await import('../src/services/settingsService')
  const embedding = await import('../src/services/aiWorker/textEmbeddingService')
  embedding.embeddingRuntime.checkDependencies = async () => ({ available: true, message: 'ok', missingPackages: [], python: 'fake' })
  t.mock.method(embedding.textWorker, 'request', async (op: string, payload: any) => {
    if (op === 'embed') return { device: 'cpu', items: payload.items.map((item: { text: string }) => [{ start: 0, end: item.text.length, vector: base64(fakeVector(item.text)) }]) }
    if (op === 'embed_images') return { device: 'cpu', items: payload.images.map((file: string) => ({ vector: base64(fakeVector(path.basename(file))) })) }
    throw new Error(`unexpected op ${op}`)
  })
  const { indexPendingImages } = await import('../src/services/embeddings/imageIndex')
  const { saveMediaStyleVector } = await import('../src/services/aiWorker/aiVisionService')
  const { RatingScoreModel } = await import('../src/models/RatingScore')

  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const insertMedia = db.prepare("INSERT INTO media_metadata (composite_hash, prompt, model_name) VALUES (?, ?, 'test-model')")
  const insertFile = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_type, file_size, mime_type) VALUES (?, ?, ?, 'active', 'image', 1, 'image/png')")
  const add = (n: number, name: string) => {
    insertMedia.run(hash(n), `prompt of ${name}`)
    insertFile.run(hash(n), `D:\\lib\\${name}`, folderId)
  }
  db.transaction(() => {
    add(1, 'cat-sofa.png')
    add(2, 'cat-window.png')
    add(3, 'city-night.png')
    add(4, 'soup-bowl.png')
    add(5, 'cat-garden.png')
  })()

  const { createMcpServer } = await import('../src/mcp/server')
  const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http' })
  const client = new Client({ name: 'image-vector-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
  t.after(async () => {
    await client.close()
    await mcp.close()
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
    return { isError: reply.isError === true, text: reply.content[0]?.text ?? '', data: reply.isError ? null : JSON.parse(reply.content[0].text) }
  }

  const names = (await client.listTools()).tools.map((tool) => tool.name)
  assert.ok(names.includes('search_images_by_meaning') && names.includes('find_similar_images'))

  // Off: both say how it is turned on; style still works without image search.
  const off = await call('search_images_by_meaning', { text: 'cat' })
  assert.equal(off.isError, true)
  assert.match(off.text, /off/i)
  assert.match((await call('find_similar_images', { composite_hash: hash(1), basis: 'content' })).text, /off/i)

  settingsService.updateEmbeddingSettings({ enabled: true, imageSearch: true })
  for (let pass = 0; pass < 10; pass += 1) if (await indexPendingImages(5) === 0) break

  const cats = await call('search_images_by_meaning', { text: '고양이', limit: 3 })
  assert.equal(cats.isError, false)
  assert.deepEqual(cats.data.images.map((image: any) => image.composite_hash).sort(), [hash(1), hash(2), hash(5)].sort())
  assert.ok(cats.data.images.every((image: any) => image.similarity > 64 && image.media_type === 'image' && image.model_name === 'test-model'))
  assert.match(cats.data.images[0].prompt, /^prompt of cat-/)

  await t.test('MCP cancellation reaches the shared embedding work without a model failure backoff', async t => {
    const request = embedding.textWorker.request.bind(embedding.textWorker)
    let release!: () => void
    let entered!: (signal: AbortSignal) => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<AbortSignal>(resolve => { entered = resolve })
    t.mock.method(embedding.textWorker, 'request', async (...args: Parameters<typeof request>) => {
      if (args[0] === 'embed') { entered(args[2]!.signal!); await gate }
      return request(...args)
    })
    const controller = new AbortController()
    const pending = client.callTool({ name: 'search_images_by_meaning', arguments: { text: 'cancelled cat' } }, { signal: controller.signal })
    let timer: NodeJS.Timeout | undefined
    try {
      const signal = await started
      const cancelled = new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      controller.abort()
      await assert.rejects(pending)
      await Promise.race([cancelled, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('embedding did not receive MCP cancellation')), 1000) })])
      assert.equal(embedding.embeddingFailure(), null)
    } finally {
      clearTimeout(timer)
      release()
      await embedding.embedQuery('cancelled cat') // Let the abandoned inference settle before restoring its mock.
    }
  })

  // Similar content leaves the image itself out.
  const similar = await call('find_similar_images', { composite_hash: hash(1), basis: 'content', limit: 2 })
  assert.equal(similar.isError, false)
  assert.equal(similar.data.images.some((image: any) => image.composite_hash === hash(1)), false)
  assert.ok([hash(2), hash(5)].includes(similar.data.images[0].composite_hash))

  // Style needs Kaloscope's vectors.
  const noStyle = await call('find_similar_images', { composite_hash: hash(3), basis: 'style' })
  assert.equal(noStyle.isError, true)
  assert.match(noStyle.text, /no style vector/)
  const axis = (i: number) => Array.from({ length: 256 }, (_, k) => (k === i ? 1 : k === 255 ? 0.2 : 0))
  saveMediaStyleVector(hash(3), axis(0))
  saveMediaStyleVector(hash(4), axis(0))
  saveMediaStyleVector(hash(1), axis(9))
  const style = await call('find_similar_images', { composite_hash: hash(3), basis: 'style', limit: 1 })
  assert.deepEqual(style.data.images.map((image: any) => image.composite_hash), [hash(4)])

  // Hidden rating tiers: neither as a result nor as the image to compare.
  RatingScoreModel.createTier({ tier_name: '테스트 숨김', min_score: 10000, max_score: null, tier_order: -100, color: '#000000', feed_visibility: 'hide' })
  db.prepare('UPDATE media_metadata SET rating_score = 10001 WHERE composite_hash = ?').run(hash(2))
  const visible = await call('search_images_by_meaning', { text: 'cat', limit: 5 })
  assert.equal(visible.data.images.some((image: any) => image.composite_hash === hash(2)), false)
  const hiddenTarget = await call('find_similar_images', { composite_hash: hash(2), basis: 'content' })
  assert.equal(hiddenTarget.isError, true)
  assert.match(hiddenTarget.text, /not found/)
  assert.match((await call('find_similar_images', { composite_hash: hash(99), basis: 'content' })).text, /not found/)
})
