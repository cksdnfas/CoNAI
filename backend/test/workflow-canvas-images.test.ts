import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import express from 'express'

test('canvas images keep newest-first metadata and page ties without omissions', { timeout: 60_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-canvas-images-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { default: router } = await import('../src/routes/workflows/execution.routes')
  const app = express()
  app.use('/api/workflows', router)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/api/workflows/canvas-images`
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    user.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-canvas-images-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const canvas = path.join(root, 'canvas')
  const empty = await (await fetch(base)).json() as any
  assert.equal(empty.success, true)
  assert.equal(empty.canvasPath, canvas)
  assert.deepEqual(empty.data, [])
  assert.deepEqual(empty.pagination, { limit: 100, nextCursor: null, hasMore: false })

  const names = ['new.png', 'a.webp', 'b.jpg', 'c.gif', 'old.JPEG']
  const dates = ['2026-01-03', '2026-01-02', '2026-01-02', '2026-01-02', '2026-01-01']
  await Promise.all(names.map(async (name, index) => {
    const file = path.join(canvas, name)
    await fs.promises.writeFile(file, `image-${index}`)
    const date = new Date(`${dates[index]}T00:00:00Z`)
    await fs.promises.utimes(file, date, date)
  }))
  await fs.promises.writeFile(path.join(canvas, 'not-an-image.txt'), 'ignore')
  await fs.promises.mkdir(path.join(canvas, 'not-a-file.png'))

  const seen: string[] = []
  let cursor: string | null = null
  do {
    const response = await fetch(`${base}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    assert.equal(response.status, 200)
    const page = await response.json() as any
    assert.ok(page.data.length > 0 && page.data.length <= 2)
    for (const image of page.data) {
      const index = names.indexOf(image.filename)
      assert.ok(index >= 0)
      assert.equal(image.size, Buffer.byteLength(`image-${index}`))
      assert.equal(image.modified, `${dates[index]}T00:00:00.000Z`)
      assert.ok(image.path.endsWith(`/${image.filename}`))
      assert.ok(Number.isFinite(Date.parse(image.created)))
      seen.push(image.filename)
    }
    assert.equal(page.pagination.hasMore, page.pagination.nextCursor !== null)
    cursor = page.pagination.nextCursor
  } while (cursor)
  assert.deepEqual(seen, names)
  const defaults = await (await fetch(base)).json() as any
  assert.deepEqual(defaults.data.map((image: any) => image.filename), names, 'small existing consumers retain their full list')
  for (const query of ['limit=0', 'limit=201', 'limit=2.5', 'cursor=broken', `cursor=${Buffer.from('{"modified":null,"filename":"x"}').toString('base64url')}`]) {
    assert.equal((await fetch(`${base}?${query}`)).status, 400, query)
  }
})
