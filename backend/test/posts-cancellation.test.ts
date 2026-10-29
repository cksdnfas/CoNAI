import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('post list HTTP disconnect aborts request-owned search', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-post-disconnect-'))
  process.env.RUNTIME_BASE_PATH = root
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const { PostStore } = await import('../src/services/posts/postStore')
  const router = (await import('../src/routes/posts.routes')).default
  const express = (await import('express')).default
  const app = express()
  app.use((req, _res, next) => { Object.assign(req, { session: {}, sessionID: 'test' }); next() })
  app.use('/api/posts', router)
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    auth.getAuthDb().close()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>(resolve => logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  let entered!: () => void
  let aborted!: () => void
  t.mock.method(PostStore, 'list', async (_actor, _query, options) => {
    assert.ok(options?.signal)
    entered()
    await new Promise<void>(resolve => options.signal!.addEventListener('abort', resolve, { once: true }))
    aborted()
    options.signal.throwIfAborted()
    throw new Error('search continued after disconnect')
  })
  for (const route of ['/api/posts?sort=relevance', '/api/posts/knowledge/review-queue']) {
    const started = new Promise<void>(resolve => { entered = resolve })
    const stopped = new Promise<void>(resolve => { aborted = resolve })
    const request = http.get(`http://127.0.0.1:${(server.address() as { port: number }).port}${route}`)
    request.on('error', () => undefined)
    await started
    request.destroy()
    await stopped
  }
})
