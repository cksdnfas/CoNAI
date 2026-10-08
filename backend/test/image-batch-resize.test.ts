import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Library batch resize ("크기 변경"): Pillow-exact Lanczos against the original app's outputs, the runtime job over
 * library images (videos skipped, originals untouched, results filed in the target group), route permissions and the
 * resize_images MCP tool.
 */
test('image batch resize: parity, job, permissions and MCP', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-batch-resize-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { registerImageBatchResizeJobHandlers, resizeImageFile } = await import('../src/services/imageBatchResize/imageBatchResizeService')
  const { pillowLanczosResize } = await import('../src/services/imageBatchResize/pillowResample')
  const { decodeImage } = await import('../src/services/sprite/spriteEncode')
  const { shutdownSpriteWorker } = await import('../src/services/sprite/spriteWorkerClient')
  const { saveSpriteOutputToLibrary, findLibraryMedia } = await import('../src/services/sprite/spriteLibrary')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  // Background metadata reads of the saved outputs would still hold them open at teardown on a loaded machine.
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(BackgroundQueueService, 'addPromptCollectionTask', () => {})
  registerImageBatchResizeJobHandlers()
  t.after(async () => {
    await shutdownSpriteWorker()
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-batch-resize-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const fixtures = path.join(__dirname, 'fixtures/sprite-port/resize')
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8')) as {
    cases: Array<{ case: string; input: string; width: number; height: number; expected: string; expected_rgba_sha256: string }>
  }
  const rgbaSha = (data: Uint8Array) => crypto.createHash('sha256').update(data).digest('hex')

  await t.test('Pillow LANCZOS port matches the original app byte for byte (down, up, non-uniform, alpha)', async () => {
    for (const item of manifest.cases) {
      const resized = pillowLanczosResize(await decodeImage(path.join(fixtures, item.input)), item.width, item.height)
      assert.equal(rgbaSha(resized.data), item.expected_rgba_sha256, item.case)
      // The worker path (decode → resize → PNG encode) keeps the pixels exactly too.
      const encoded = await resizeImageFile(path.join(fixtures, item.input), { width: item.width, height: item.height, format: 'png', quality: 90 })
      assert.equal(rgbaSha((await decodeImage(encoded)).data), item.expected_rgba_sha256, `${item.case} via worker`)
    }
  })

  const account = (name: string, type: 'admin' | 'guest', permissionKeys?: string[]) => {
    const id = Number(auth.prepare('INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, ?, ?)').run(name, 'unused', type).lastInsertRowid)
    if (type === 'admin') auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(id)
    if (permissionKeys) AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: `${name}-group`, permissionKeys }).id, id)
    return id
  }
  const adminId = account('admin', 'admin')
  const readerId = account('reader', 'guest', ['images.view'])
  const editorId = account('editor', 'guest', ['images.view', 'images.edit'])
  const makerId = account('maker', 'guest', ['images.view', 'images.edit', 'images.upload'])
  invalidateConfiguredAuthCache()

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const type = id === adminId ? 'admin' : 'guest'
    Object.assign(req, { sessionID: `resize-${id ?? 'anonymous'}`, session: { authenticated: Boolean(id), accountId: id, accountType: id ? type : undefined } })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (method: string, url: string, accountId: number | undefined, body?: unknown) => {
    const response = await fetch(origin + url, {
      method,
      headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: await response.json() as any }
  }
  const waitJob = async (jobId: string, accountId: number) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const job = (await call('GET', `/api/jobs/${jobId}`, accountId)).json.data
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`job ${jobId} did not finish`)
  }

  // Library inputs: two images and a video, registered like other in-app media.
  const library = async (file: string, extension: string, mimeType: string) =>
    (await saveSpriteOutputToLibrary({ bytes: fs.readFileSync(file), extension, mimeType, group: { groupPath: 'resize-test/inputs' } })).compositeHash
  const imageA = await library(path.join(fixtures, 'inputs/gradient_rgba.png'), 'png', 'image/png')
  const imageB = await library(path.join(fixtures, 'inputs/sprite_alpha.png'), 'png', 'image/png')
  const video = await library(path.join(__dirname, 'fixtures/av-golden/sprite/inputs/magenta.mp4'), 'mp4', 'video/mp4')
  const fileSha = (hash: string) => crypto.createHash('sha256').update(fs.readFileSync(findLibraryMedia(hash)!.filePath)).digest('hex')
  const before = [fileSha(imageA), fileSha(imageB)]
  const body = { compositeHashes: [imageA, imageB, video], width: 20, height: 15 }

  await t.test('route needs images.edit and images.upload, and validates sizes up front', async () => {
    assert.equal((await call('POST', '/api/images/batch-resize', undefined, body)).status, 401)
    assert.equal((await call('POST', '/api/images/batch-resize', readerId, body)).status, 403)
    assert.equal((await call('POST', '/api/images/batch-resize', editorId, body)).status, 403, 'saving new images needs images.upload')
    assert.equal((await call('POST', '/api/images/batch-resize', makerId, { ...body, width: 0 })).status, 422)
    assert.equal((await call('POST', '/api/images/batch-resize', makerId, { ...body, width: 16384, height: 16384 })).status, 422, 'over 64 Mi pixels')
    assert.equal((await call('POST', '/api/images/batch-resize', makerId, { ...body, format: 'webp', quality: 0 })).status, 422)
    assert.equal((await call('POST', '/api/images/batch-resize', makerId, { ...body, compositeHashes: [video] })).status, 422, 'nothing resizable')
    assert.equal((await call('POST', '/api/images/batch-resize', makerId, { ...body, compositeHashes: [imageA, imageA] })).status, 422, 'duplicates')
  })

  await t.test('job resizes images into "크기 변경", skips the video, leaves originals untouched', async () => {
    const started = await call('POST', '/api/images/batch-resize', makerId, body)
    assert.equal(started.status, 202)
    const job = await waitJob(started.json.data.jobId, makerId)
    assert.equal(job.status, 'completed', job.failureMessage ?? '')
    assert.equal(job.result.saved.length, 2)
    assert.deepEqual(job.result.skipped.map((item: { source: string }) => item.source), [video])
    const groupId = GroupPathService.resolve('크기 변경', { create: false })?.groupId
    assert.ok(groupId)
    assert.equal(job.result.groupId, groupId)
    const members = (main.db.prepare('SELECT composite_hash FROM image_groups WHERE group_id = ?').all(groupId) as Array<{ composite_hash: string }>).map((row) => row.composite_hash)
    for (const saved of job.result.saved) {
      assert.ok(members.includes(saved.compositeHash))
      const output = await decodeImage(findLibraryMedia(saved.compositeHash)!.filePath)
      assert.deepEqual([output.width, output.height], [20, 15])
    }
    const parity = job.result.saved.find((item: { source: string }) => item.source === imageA)
    assert.equal(rgbaSha((await decodeImage(findLibraryMedia(parity.compositeHash)!.filePath)).data), manifest.cases[0].expected_rgba_sha256)
    assert.deepEqual([fileSha(imageA), fileSha(imageB)], before, 'originals unchanged')
  })

  await t.test('explicit target group and WebP output', async () => {
    const target = GroupPathService.resolveOrCreate('resize-test/out').groupId
    const started = await call('POST', '/api/images/batch-resize', adminId, { compositeHashes: [imageB], width: 12, height: 12, format: 'webp', quality: 80, groupId: target })
    const job = await waitJob(started.json.data.jobId, adminId)
    assert.equal(job.status, 'completed', job.failureMessage ?? '')
    assert.equal(job.result.groupId, target)
    assert.equal(findLibraryMedia(job.result.saved[0].compositeHash)!.mimeType, 'image/webp')
    assert.equal((await call('POST', '/api/images/batch-resize', adminId, { compositeHashes: [imageB], width: 12, height: 12, groupId: 999999 })).status, 404)
  })

  await t.test('resize_images MCP tool: listed for image editors who can upload, returns new hashes', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const connect = async (accountId: number) => {
      const mcp = createMcpServer({ scopes: ['read', 'generate'], source: 'http', baseUrl: origin, requester: { accountId, accountType: accountId === adminId ? 'admin' : 'guest' } })
      const client = new Client({ name: 'resize-test', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
      return { client, close: async () => { await client.close(); await mcp.close() } }
    }
    const listed = async (accountId: number) => {
      const session = await connect(accountId)
      try {
        return (await session.client.listTools()).tools.some((tool) => tool.name === 'resize_images')
      } finally {
        await session.close()
      }
    }
    assert.equal(await listed(readerId), false)
    assert.equal(await listed(editorId), false)
    assert.equal(await listed(makerId), true)
    const session = await connect(makerId)
    try {
      const result = await session.client.callTool({ name: 'resize_images', arguments: { composite_hashes: [imageA], width: 10, height: 10, wait_seconds: 60 } }) as { content: Array<{ text: string }>; isError?: boolean }
      assert.notEqual(result.isError, true, result.content[0].text)
      const payload = JSON.parse(result.content[0].text)
      assert.equal(payload.status, 'completed')
      assert.equal(payload.composite_hashes.length, 1)
      assert.equal(payload.saved[0].source_composite_hash, imageA)
      const pathInput = await session.client.callTool({ name: 'resize_images', arguments: { composite_hashes: ['not-a-hash'], width: 10, height: 10 } }) as { isError?: boolean }
      assert.equal(pathInput.isError, true)
    } finally {
      await session.close()
    }
  })
})
