import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * /api/sprite and the sprite MCP tools over a real app: library input, permissions per route, job ownership, saving
 * to the library with the settings embedded, and the frames-ZIP artifact.
 */
test('sprite REST + MCP: permissions, ownership, library save and artifacts', { timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-sprite-api-'))
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
  const { registerSpriteJobHandlers } = await import('../src/services/sprite/spriteService')
  const { shutdownSpriteWorker } = await import('../src/services/sprite/spriteWorkerClient')
  const { saveSpriteOutputToLibrary, readSpriteSettings } = await import('../src/services/sprite/spriteLibrary')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { McpArtifactService } = await import('../src/services/mcpArtifactService')
  registerSpriteJobHandlers()
  t.after(async () => {
    await shutdownSpriteWorker()
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-sprite-api-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
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
  app.use(express.json({ limit: '60mb' }))
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const type = id === adminId ? 'admin' : 'guest'
    Object.assign(req, { sessionID: `sprite-${id ?? 'anonymous'}`, session: { authenticated: Boolean(id), accountId: id, accountType: id ? type : undefined } })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (method: string, url: string, accountId: number | undefined, body?: unknown) => {
    const response = await fetch(origin + url, {
      method,
      headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const type = response.headers.get('content-type') ?? ''
    return { status: response.status, headers: response.headers, json: type.includes('json') ? await response.json() as any : null, bytes: type.includes('json') ? null : Buffer.from(await response.arrayBuffer()) }
  }
  const waitJob = async (jobId: string, accountId: number) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const job = (await call('GET', `/api/jobs/${jobId}`, accountId)).json.data
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`job ${jobId} did not finish`)
  }

  // A library video, registered like any other upload.
  const video = await saveSpriteOutputToLibrary({
    bytes: fs.readFileSync(path.join(__dirname, 'fixtures/av-golden/sprite/inputs/magenta.mp4')),
    extension: 'mp4', mimeType: 'video/mp4', group: { groupPath: 'sprite-test/inputs' },
  })
  const videoHash = video.compositeHash
  const extractBody = { videoHash, options: { intervalSeconds: 0.25 }, save: true }

  await t.test('routes require images.view / images.edit / images.upload', async () => {
    assert.equal((await call('GET', `/api/sprite/videos/${videoHash}/info`, undefined)).status, 401)
    const info = await call('GET', `/api/sprite/videos/${videoHash}/info`, readerId)
    assert.equal(info.status, 200)
    assert.deepEqual([info.json.data.width, info.json.data.height, info.json.data.frameCount], [128, 128, 24])
    assert.equal((await call('POST', '/api/sprite/extract', readerId, extractBody)).status, 403, 'running needs images.edit')
    assert.equal((await call('POST', '/api/sprite/extract', editorId, extractBody)).status, 403, 'saving needs images.upload')
    assert.equal((await call('POST', '/api/sprite/extract-batch', editorId, { videoHashes: [videoHash] })).status, 403)
    assert.equal((await call('POST', '/api/sprite/normalize', readerId, { sheets: [] })).status, 403)
    assert.equal((await call('POST', '/api/sprite/animation', readerId, {})).status, 403)
    assert.equal((await call('POST', '/api/sprite/builds/00000000-0000-4000-8000-000000000000/save', editorId, {})).status, 403)
    assert.equal((await call('POST', '/api/sprite/extract', editorId, { ...extractBody, save: false, videoHash: 'f'.repeat(48) })).status, 404, 'unknown video')
    const bad = await call('POST', '/api/sprite/extract', editorId, { ...extractBody, save: false, options: { keyColors: ['#FF00FF', '#00FF00'], despill: true } })
    assert.equal(bad.status, 422)
    assert.equal(bad.json.error, '디스필은 색상 하나만 지정할 수 있습니다.')
  })

  let buildId = ''
  let sheetHash = ''
  await t.test('extract job saves the sheet to "스프라이트" with its settings', async () => {
    const started = await call('POST', '/api/sprite/extract', makerId, extractBody)
    assert.equal(started.status, 202)
    assert.equal((await call('GET', `/api/jobs/${started.json.data.jobId}`, otherMakerId)).status, 403, 'job owner only')
    const job = await waitJob(started.json.data.jobId, makerId)
    assert.equal(job.status, 'completed', job.failureMessage ?? '')
    buildId = job.result.buildId
    sheetHash = job.result.saved.compositeHash
    assert.deepEqual([job.result.frameCount, job.result.frameIndices], [8, [0, 3, 6, 9, 12, 15, 18, 21]])
    assert.equal(job.result.saved.groupId, GroupPathService.resolve('스프라이트', { create: false })?.groupId)
    const settings = await readSpriteSettings(sheetHash) as Record<string, any>
    assert.equal(settings.kind, 'sprite-sheet')
    assert.equal(settings.source.compositeHash, videoHash)
    assert.deepEqual([settings.options.despill, settings.options.tolerance, settings.options.softness], [true, 0.08, 0.92])
    const viaRoute = await call('GET', `/api/sprite/settings/${sheetHash}`, readerId)
    assert.deepEqual(viaRoute.json.data, settings)
  })

  await t.test('builds are re-laid out, zipped and saved without re-extracting, owner only', async () => {
    assert.equal((await call('GET', `/api/sprite/builds/${buildId}`, otherMakerId)).status, 403)
    assert.equal((await call('GET', `/api/sprite/builds/${buildId}`, adminId)).status, 200)
    const summary = await call('GET', `/api/sprite/builds/${buildId}`, makerId)
    assert.equal(summary.json.data.frameCount, 8)
    const sheet = await call('GET', `/api/sprite/builds/${buildId}/sheet?columns=4&spacing=2`, makerId)
    assert.equal(sheet.status, 200)
    assert.deepEqual([sheet.headers.get('x-sheet-columns'), sheet.headers.get('x-sheet-rows')], ['4', '2'])
    assert.equal(Number(sheet.headers.get('x-sheet-width')), summary.json.data.frameWidth * 4 + 6)
    const frame = await call('GET', `/api/sprite/builds/${buildId}/frames/0?size=32`, makerId)
    assert.equal(frame.headers.get('content-type'), 'image/png')
    const zip = await call('GET', `/api/sprite/builds/${buildId}/frames.zip`, makerId)
    assert.equal(zip.status, 200)
    assert.equal(zip.bytes?.subarray(0, 2).toString(), 'PK')
    const saved = await call('POST', `/api/sprite/builds/${buildId}/save`, makerId, { render: { columns: 2 }, group: { groupPath: 'sprite-test/out' } })
    assert.equal(saved.status, 200)
    assert.notEqual(saved.json.data.compositeHash, sheetHash)
    assert.equal(saved.json.data.groupId, GroupPathService.resolve('sprite-test/out', { create: false })?.groupId)
    assert.equal((await call('GET', '/api/sprite/builds/00000000-0000-4000-8000-000000000000', makerId)).status, 410)
  })

  await t.test('normalise and animate library sheets', async () => {
    const normalized = await call('POST', '/api/sprite/normalize', makerId, { sheets: [{ imageHash: sheetHash, options: { columns: 3, rows: 3, frameCount: 8 } }], options: {}, save: true })
    assert.equal(normalized.status, 202, JSON.stringify(normalized.json))
    const normJob = await waitJob(normalized.json.data.jobId, makerId)
    assert.equal(normJob.status, 'completed', normJob.failureMessage ?? '')
    assert.equal(normJob.result.sheets.length, 1)
    assert.ok(normJob.result.sheets[0].compositeHash)
    const download = await call('GET', `/api/sprite/results/${normJob.result.workspaceId}/download`, makerId)
    assert.equal(download.headers.get('content-type'), 'application/zip')
    assert.equal((await call('GET', `/api/sprite/results/${normJob.result.workspaceId}/download`, otherMakerId)).status, 403)

    const animated = await call('POST', '/api/sprite/animation', makerId, { sheetHash, options: { columns: 3, rows: 3, frameCount: 8 }, save: true })
    const animJob = await waitJob(animated.json.data.jobId, makerId)
    assert.equal(animJob.status, 'completed', animJob.failureMessage ?? '')
    assert.deepEqual([animJob.result.mimeType, animJob.result.frameCount], ['image/webp', 8])
    assert.equal(((await readSpriteSettings(animJob.result.saved.compositeHash)) as Record<string, string>).kind, 'sprite-animation')
  })

  await t.test('MCP tools: listing follows the account, results carry composite hashes, frames ZIP artifact', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const connect = async (accountId: number, source: 'http' | 'codex-chat' = 'http') => {
      const mcp = createMcpServer({ scopes: ['read', 'generate'], source, baseUrl: origin, requester: { accountId, accountType: accountId === adminId ? 'admin' : 'guest' } })
      const client = new Client({ name: 'sprite-test', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
      return { mcp, client, close: async () => { await client.close(); await mcp.close() } }
    }
    const names = async (accountId: number, source: 'http' | 'codex-chat' = 'http') => {
      const session = await connect(accountId, source)
      try {
        return (await session.client.listTools()).tools.map((tool) => tool.name).filter((name) => /sprite|video_info/.test(name)).sort()
      } finally {
        await session.close()
      }
    }
    assert.deepEqual(await names(readerId), ['download_sprite_frames', 'get_sprite_job', 'get_video_info', 'wait_sprite_job'])
    assert.deepEqual(await names(editorId), ['download_sprite_frames', 'get_sprite_job', 'get_video_info', 'wait_sprite_job'], 'builders need images.upload too')
    assert.deepEqual(await names(makerId), ['create_sprite_animation', 'download_sprite_frames', 'extract_sprite_sheet', 'extract_sprite_sheets_batch', 'get_sprite_job', 'get_video_info', 'normalize_sprite_sheets', 'wait_sprite_job'])
    assert.ok(!(await names(makerId, 'codex-chat')).includes('wait_sprite_job'), 'chat replies never block on a job')

    const maker = await connect(makerId)
    const other = await connect(otherMakerId)
    try {
      const text = (result: any) => JSON.parse(result.content[0].text)
      const extracted = text(await maker.client.callTool({ name: 'extract_sprite_sheet', arguments: { composite_hash: videoHash, options: { sample_count: 4, key_colors: ['#FF00FF'] }, wait_seconds: 60 } }))
      assert.equal(extracted.status, 'completed', JSON.stringify(extracted))
      assert.equal(extracted.composite_hashes.length, 1)
      assert.equal(extracted.result.frameCount, 4)
      const denied = await other.client.callTool({ name: 'get_sprite_job', arguments: { job_id: extracted.job_id } })
      assert.equal(denied.isError, true)
      const download = text(await maker.client.callTool({ name: 'download_sprite_frames', arguments: { build_id: extracted.build_id } }))
      assert.equal(download.frame_count, 4)
      assert.match(download.artifact.download_url, new RegExp(`/api/sprite/results/${extracted.build_id}/download\\?file=`))
      const resolved = McpArtifactService.resolve(download.artifact.artifact_id)
      assert.ok(resolved && fs.existsSync(resolved.absolutePath))
      assert.equal(resolved.mimeType, 'application/zip')
      const viaUrl = await call('GET', new URL(download.artifact.download_url).pathname + new URL(download.artifact.download_url).search, makerId)
      assert.equal(viaUrl.bytes?.subarray(0, 2).toString(), 'PK')
      assert.equal((await other.client.callTool({ name: 'refresh_artifact_download', arguments: { artifact_id: download.artifact.artifact_id } })).isError, true)
      assert.notEqual((await maker.client.callTool({ name: 'refresh_artifact_download', arguments: { artifact_id: download.artifact.artifact_id } })).isError, true)
      assert.equal((await other.client.callTool({ name: 'download_sprite_frames', arguments: { build_id: extracted.build_id } })).isError, true)

      const fromDataUrl = text(await maker.client.callTool({ name: 'extract_sprite_sheet', arguments: {
        data_url: `data:video/mp4;base64,${fs.readFileSync(path.join(__dirname, 'fixtures/av-golden/sprite/inputs/green.mp4')).toString('base64')}`,
        options: { key_colors: ['#00FF00'], despill: false, sample_count: 3 }, save: false, wait_seconds: 60,
      } }))
      assert.equal(fromDataUrl.status, 'completed', JSON.stringify(fromDataUrl))
      assert.deepEqual(fromDataUrl.composite_hashes, [], 'save: false keeps it out of the library')
      assert.ok(GroupPathService.resolve('스프라이트/원본 영상', { create: false }), 'the uploaded video is filed with the sprite sources')
      const pathInput = await maker.client.callTool({ name: 'extract_sprite_sheet', arguments: { file_path: 'C:/secret.mp4' } as never })
      assert.equal(pathInput.isError, true)
    } finally {
      await maker.close()
      await other.close()
    }
  })
})
