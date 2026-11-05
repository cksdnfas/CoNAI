import './support/testTemp'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

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
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { registerImageBatchResizeJobHandlers, resizeImageFile } = await import('../src/services/imageBatchResize/imageBatchResizeService')
  const { registerMediaEditJobHandlers, startMediaEditJob } = await import('../src/services/mediaEdit/mediaEditService')
  const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
  const { waitForRuntimeJob } = await import('../src/services/sprite/spriteService')
  const { ImageFileModel } = await import('../src/models/Image/ImageFileModel')
  const { ImageGroupModel } = await import('../src/models/Group')
  const { pillowLanczosResize } = await import('../src/services/imageBatchResize/pillowResample')
  const { decodeImage } = await import('../src/services/sprite/spriteEncode')
  const { shutdownSpriteWorker } = await import('../src/services/sprite/spriteWorkerClient')
  const { saveSpriteOutputToLibrary, findLibraryMedia } = await import('../src/services/sprite/spriteLibrary')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { MediaPostprocessVisibilityService } = await import('../src/services/mediaPostprocessVisibilityService')
  // Complete the fixture's background boundary synchronously, without keeping files open at teardown.
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', (_filePath: string, hash: string) => MediaPostprocessVisibilityService.markReady(hash))
  t.mock.method(BackgroundQueueService, 'addPromptCollectionTask', () => {})
  registerImageBatchResizeJobHandlers()
  registerMediaEditJobHandlers()
  sharp.cache(false)
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
  const otherMakerId = account('other-maker', 'guest', ['images.view', 'images.edit', 'images.upload'])
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
  const { createMcpServer } = await import('../src/mcp/server')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const connect = async (accountId: number) => {
    const mcp = createMcpServer({ scopes: ['read', 'generate'], source: 'http', baseUrl: origin, requester: { accountId, accountType: accountId === adminId ? 'admin' : 'guest' } })
    const client = new Client({ name: 'resize-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    return { client, close: async () => { await client.close(); await mcp.close() } }
  }
  const edit = async (name: string, args: Record<string, unknown>) => {
    const session = await connect(makerId)
    try {
      const response = await session.client.callTool({ name, arguments: { ...args, wait_seconds: 60 } }) as { isError?: boolean; content: Array<{ text: string }> }
      assert.notEqual(response.isError, true, response.content[0].text)
      const payload = JSON.parse(response.content[0].text)
      assert.equal(payload.status, 'completed', payload.error)
      return payload
    } finally { await session.close() }
  }

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

  await t.test('save_video_frame saves the actual last decoded frame with a download and owner-scoped job result', async () => {
    const session = await connect(makerId)
    try {
      const started = await session.client.callTool({ name: 'save_video_frame', arguments: { composite_hash: video, at_seconds: [0], position: 'last', wait_seconds: 0 } }) as { content: Array<{ text: string }> }
      const jobId = JSON.parse(started.content[0].text).job_id
      assert.ok(jobId)
      const result = await edit('get_media_edit_job', { job_id: jobId })
      assert.equal(result.saved.length, 2)
      assert.equal(result.saved[0].seconds, 0)
      assert.ok(Math.abs(result.saved[1].seconds - 23 / 12) < 0.00001, '24 frames at 12 fps: final frame starts at 23/12, not EOF or frame zero')
      assert.match(result.saved[1].download.download_url, new RegExp(`/api/images/${result.saved[1].composite_hash}/download/original$`))
      const saved = await sharp(findLibraryMedia(result.saved[1].composite_hash)!.filePath).metadata()
      assert.deepEqual([saved.width, saved.height, saved.format], [128, 128, 'png'])
      const other = await connect(otherMakerId)
      try {
        const denied = await other.client.callTool({ name: 'get_media_edit_job', arguments: { job_id: jobId } }) as { isError?: boolean }
        assert.equal(denied.isError, true)
      } finally { await other.close() }
      for (const id of [readerId, editorId]) {
        const denied = await connect(id)
        try {
          const names = (await denied.client.listTools()).tools.map((tool) => tool.name)
          for (const name of ['save_video_frame', 'crop_images', 'convert_images', 'clip_video']) assert.equal(names.includes(name), false)
        } finally { await denied.close() }
      }
      const indexed = await edit('save_video_frame', { composite_hash: video, frame_index: 23, format: 'webp' })
      assert.ok(Math.abs(indexed.saved[0].seconds - 23 / 12) < 0.00001)
      assert.equal((await sharp(findLibraryMedia(indexed.saved[0].composite_hash)!.filePath).metadata()).format, 'webp')
      const partial = await edit('save_video_frame', { composite_hash: video, at_seconds: [20], frame_index: 240, position: 'middle' })
      assert.ok(partial.saved[0].seconds >= 1 && partial.saved[0].seconds < 1.1)
      assert.equal(partial.failed[0].seconds, 20)
      assert.equal(partial.failed[1].frame_index, 240)
    } finally { await session.close() }
  })

  await t.test('crop_images crops in source pixels, reports invalid rectangles and video skips, preserves originals', async () => {
    const result = await edit('crop_images', { composite_hashes: [imageA, imageB, video], rect: { x: 35, y: 0, width: 8, height: 8 }, group_path: 'edit-test/crops' })
    assert.equal(result.saved.length, 1, '48px source fits, 40px source does not')
    assert.equal(result.saved[0].source_composite_hash, imageB)
    assert.equal(result.failed[0].source, imageA)
    assert.equal(result.skipped[0].source, video)
    const saved = findLibraryMedia(result.saved[0].composite_hash)!
    const metadata = await sharp(saved.filePath).metadata()
    assert.deepEqual([metadata.width, metadata.height, metadata.format], [8, 8, 'png'])
    const sourcePixels = await sharp(findLibraryMedia(imageB)!.filePath).raw().toBuffer({ resolveWithObject: true })
    const cropped = await sharp(saved.filePath).raw().toBuffer()
    assert.deepEqual(cropped.subarray(0, sourcePixels.info.channels), sourcePixels.data.subarray(35 * sourcePixels.info.channels, 36 * sourcePixels.info.channels))
    assert.equal(result.group_id, GroupPathService.resolveOrCreate('edit-test/crops').groupId)
    assert.deepEqual([fileSha(imageA), fileSha(imageB)], before)
    const oriented = await saveSpriteOutputToLibrary({
      bytes: await sharp({ create: { width: 16, height: 8, channels: 3, background: '#ff0000' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
      extension: 'jpg', mimeType: 'image/jpeg', group: { groupPath: 'edit-test/inputs' },
    })
    const rotated = await edit('crop_images', { composite_hashes: [oriented.compositeHash], rect: { x: 0, y: 12, width: 8, height: 4 } })
    const rotatedImage = await sharp(findLibraryMedia(rotated.saved[0].composite_hash)!.filePath).metadata()
    assert.deepEqual([rotatedImage.width, rotatedImage.height], [8, 4])
  })

  await t.test('convert_images retains alpha for PNG/WebP and flattens JPEG onto white by default', async () => {
    const transparent = await saveSpriteOutputToLibrary({
      bytes: await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(),
      extension: 'png', mimeType: 'image/png', group: { groupPath: 'edit-test/inputs' },
    })
    const original = fileSha(transparent.compositeHash)
    for (const format of ['png', 'webp', 'jpeg']) {
      const result = await edit('convert_images', { composite_hashes: [transparent.compositeHash, video], format, quality: 100 })
      assert.equal(result.saved.length, format === 'png' ? 0 : 1)
      assert.equal(result.skipped[0].source, video)
      const saved = findLibraryMedia((format === 'png' ? result.identical : result.saved)[0].composite_hash)!
      const metadata = await sharp(saved.filePath).metadata()
      assert.equal(metadata.format, format)
      const pixel = await sharp(saved.filePath).ensureAlpha().raw().toBuffer()
      if (format === 'jpeg') assert.deepEqual([...pixel.subarray(0, 4)], [255, 255, 255, 255])
      else assert.equal(pixel[3], 0)
    }
    assert.equal(fileSha(transparent.compositeHash), original)
  })

  await t.test('clip_video stream-copies source containers and re-encodes resized video or animated formats', async () => {
    const { probeVideo } = await import('../src/services/sprite/spriteFfmpeg')
    const invalid = startMediaEditJob({ operation: 'clip_video', compositeHash: imageA, startSeconds: 0, endSeconds: 1, contentRatingLimit: null, requestedByAccountId: makerId })
    const failed = await waitForRuntimeJob(invalid.jobId, 60000)
    assert.equal(failed!.status, 'failed')
    assert.match(failed!.failureMessage!, /library video/)
    const original = fileSha(video)
    const copied = await edit('clip_video', { composite_hash: video, start_seconds: 0, end_seconds: 1 })
    assert.equal(copied.stream_copy, true)
    assert.equal(findLibraryMedia(copied.saved[0].composite_hash)!.mimeType, 'video/mp4')
    for (const format of ['mp4', 'webm', 'gif', 'webp']) {
      const result = await edit('clip_video', { composite_hash: video, start_seconds: 0.25, end_seconds: 1.25, format, width: 64, fps: 6 })
      assert.equal(result.stream_copy, false)
      const saved = findLibraryMedia(result.saved[0].composite_hash)!
      if (format === 'gif' || format === 'webp') {
        const metadata = await sharp(fs.readFileSync(saved.filePath)).metadata()
        assert.equal(metadata.width, 64)
        assert.ok((metadata.pages ?? 1) > 1)
        const captured = await edit('save_video_frame', { composite_hash: saved.compositeHash, position: 'last' })
        assert.ok(captured.saved[0].seconds > 0)
      } else {
        const info = await probeVideo(saved.filePath)
        assert.deepEqual([info.width, info.height, info.fps], [64, 64, 6])
        assert.ok(Math.abs(info.duration - 1) < 0.2)
      }
    }
    assert.equal(fileSha(video), original)
  })

  await t.test('media edit results over 64 KiB round trip through the status tool and expire with their job', async (t) => {
    const groupId = GroupPathService.resolveOrCreate('edit-test/large-result').groupId
    const result = {
      groupId,
      saved: Array.from({ length: 40 }, () => ({ source: imageA, compositeHash: imageB })),
      identical: [],
      skipped: Array.from({ length: 460 }, (_, index) => ({ source: index.toString(16).padStart(48, '0'), reason: 'Only still images are supported; videos and animations are skipped.' })),
      failed: [],
    }
    assert.ok(Buffer.byteLength(JSON.stringify(result)) > 64 * 1024)
    const job = RuntimeJobStore.create({ kind: 'media-edit', params: {}, singletonKey: null, requestedByAccountId: makerId })
    RuntimeJobStore.markCompleted(job.jobId, result)
    const resultFile = path.join(root, 'artifacts', 'runtime-job-results', `${job.jobId}.json`)
    assert.equal(fs.existsSync(resultFile), true)
    const createReadStream = fs.createReadStream
    const outputPath = findLibraryMedia(imageB)!.filePath
    let reads = 0
    t.mock.method(fs, 'createReadStream', (...args: Parameters<typeof createReadStream>) => {
      if (args[0] === outputPath) reads++
      return createReadStream(...args)
    })
    const restored = await edit('get_media_edit_job', { job_id: job.jobId })
    const polled = await edit('get_media_edit_job', { job_id: job.jobId })
    assert.equal(restored.saved.length, 40)
    assert.deepEqual(polled.saved, restored.saved)
    assert.equal(reads, 1, 'one descriptor hash shared by duplicate entries and repeated status calls')
    assert.deepEqual(restored.skipped, result.skipped)
    assert.deepEqual(RuntimeJobStore.get(job.jobId, { includeResultFile: true })!.result, result)
    user.getUserSettingsDb().prepare("UPDATE runtime_jobs SET completed_at = '2000-01-01 00:00:00' WHERE job_id = ?").run(job.jobId)
    RuntimeJobStore.pruneExpired()
    assert.equal(RuntimeJobStore.get(job.jobId), null)
    assert.equal(fs.existsSync(resultFile), false)
  })

  await t.test('identical image edits retain the source files and groups without registering duplicate outputs', async () => {
    const originalFiles = ImageFileModel.findAllByHash(imageA).map((file) => file.id)
    const originalPath = findLibraryMedia(imageA)!.filePath
    const groupId = GroupPathService.resolveOrCreate('edit-test/identical').groupId
    for (const [name, args] of [
      ['convert_images', { format: 'png' }],
      ['crop_images', { rect: { x: 0, y: 0, width: 40, height: 30 } }],
    ] as const) {
      const result = await edit(name, { composite_hashes: [imageA], group_id: groupId, ...args })
      assert.deepEqual(result.saved, [])
      assert.deepEqual(result.identical, [{ source_composite_hash: imageA, composite_hash: imageA }])
      assert.deepEqual(ImageFileModel.findAllByHash(imageA).map((file) => file.id), originalFiles)
      assert.equal(findLibraryMedia(imageA)!.filePath, originalPath)
      assert.equal(ImageGroupModel.isImageInGroup(groupId, imageA), false)
      assert.equal(fileSha(imageA), before[0])
    }
  })

  await t.test('a second media edit waits for the running media edit before reading or decoding its source', async (t) => {
    const sourcePath = findLibraryMedia(imageA)!.filePath
    const readFile = fs.promises.readFile
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reading = new Promise<void>((resolve) => { entered = resolve })
    let reads = 0
    const mock = t.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof readFile>) => {
      if (args[0] === sourcePath) {
        reads++
        if (reads === 1) { entered(); await gate }
      }
      return readFile(...args)
    })
    const params = { operation: 'crop_images' as const, compositeHashes: [imageA], rect: { x: 0, y: 0, width: 7, height: 5 }, contentRatingLimit: null, requestedByAccountId: makerId }
    const first = startMediaEditJob(params)
    let second: typeof first | undefined
    try {
      await reading
      second = startMediaEditJob(params)
      assert.equal(RuntimeJobStore.get(second.jobId)!.phase, 'waiting')
      assert.equal(reads, 1)
    } finally {
      release()
      await waitForRuntimeJob(first.jobId, 60000)
      if (second) await waitForRuntimeJob(second.jobId, 60000)
      mock.mock.restore()
    }
    assert.equal(RuntimeJobStore.get(first.jobId)!.status, 'completed')
    assert.equal(RuntimeJobStore.get(second!.jobId)!.status, 'completed')
  })
})
