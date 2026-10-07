import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

test('permissions: independent pages, features, migration, grants, scopes and routes', { timeout: 60000 }, async (t) => {
  // Isolate all runtime paths before importing modules that open databases or settings.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-image-permissions-'))
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
  const { createAuthTables } = await import('../src/database/authDbSchema')
  const { seedAccessControlDefaults, migrateImageViewPermission, migrateIndependentFeaturePermissions, LEGACY_IMAGE_VIEW_PERMISSION_KEYS } = await import('../src/database/authDbSeed')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthAccessControlService, invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { allowImagesView, requireRequesterImagePermission } = await import('../src/middleware/imageAccess')
  const { canAccessHistoryRecord } = await import('../src/routes/generation-history/historyRouteHelpers')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-image-permissions-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { buildPermissionSections, setPermissionGrant } = await import('../../frontend/src/features/settings/components/security-permission-catalog')

  await t.test('versioned migration converts only explicit legacy grants and never repeats', () => {
    const db = new Database(':memory:')
    createAuthTables(db)
    seedAccessControlDefaults(db)
    const grant = (group: number, key: string, allowed = 1) => db.prepare('INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT ?, id, ? FROM auth_permissions WHERE permission_key = ?').run(group, allowed, key)
    const groups = [...LEGACY_IMAGE_VIEW_PERMISSION_KEYS, 'page.files.view', 'upload.create', 'denied', 'explicit-denial']
    groups.forEach((key, index) => {
      db.prepare('INSERT INTO auth_permission_groups (id, group_key, name) VALUES (?, ?, ?)').run(100 + index, key, key)
      if (key === 'denied') grant(100 + index, 'page.home.view', 0)
      else if (key === 'explicit-denial') { grant(100 + index, 'page.home.view'); grant(100 + index, 'images.view', 0) }
      else grant(100 + index, key)
    })
    db.prepare("DELETE FROM auth_seed_state WHERE seed_key IN ('images_view_v1', 'files_view_v1', 'workflows_view_v1')").run()
    db.exec("CREATE TRIGGER fail_image_marker BEFORE INSERT ON auth_seed_state WHEN NEW.seed_key = 'images_view_v1' BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
    assert.throws(() => migrateImageViewPermission(db), /test rollback/)
    assert.equal(db.prepare('SELECT 1 FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id WHERE gp.group_id = 100 AND p.permission_key = ?').get('images.view'), undefined)
    db.exec('DROP TRIGGER fail_image_marker')
    seedAccessControlDefaults(db)
    groups.forEach((key, index) => {
      const row = db.prepare('SELECT allowed FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id WHERE gp.group_id = ? AND p.permission_key = ?').get(100 + index, 'images.view') as { allowed: number } | undefined
      assert.equal(row?.allowed === 1, LEGACY_IMAGE_VIEW_PERMISSION_KEYS.includes(key as never), key)
    })
    db.prepare('DELETE FROM auth_group_permissions WHERE group_id = 100 AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = ?)').run('images.view')
    seedAccessControlDefaults(db)
    assert.equal(db.prepare('SELECT 1 FROM auth_group_permissions WHERE group_id = 100 AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = ?)').get('images.view'), undefined)
    assert.ok(db.prepare('SELECT 1 FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id JOIN auth_permission_groups g ON g.id = gp.group_id WHERE g.group_key = ? AND p.permission_key = ? AND gp.allowed = 1').get('admin', 'images.view'))
    db.close()
  })

  await t.test('feature migration is finite, atomic and preserves later choices', () => {
    const db = new Database(':memory:')
    createAuthTables(db)
    seedAccessControlDefaults(db)
    const mappings = [['page.prompts.view', 'prompts.view'], ['page.wildcards.view', 'wildcards.view'], ['page.generation.view', 'generation.execute'], ['chat.codex.use', 'page.chat.view'], ['chat.llm.use', 'page.chat.view']]
    mappings.forEach(([legacy], index) => {
      db.prepare('INSERT INTO auth_permission_groups (id, group_key, name) VALUES (?, ?, ?)').run(200 + index, legacy, legacy)
      db.prepare('INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT ?, id, 1 FROM auth_permissions WHERE permission_key = ?').run(200 + index, legacy)
    })
    db.prepare("INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT 201, id, 0 FROM auth_permissions WHERE permission_key = 'wildcards.view'").run()
    db.prepare("DELETE FROM auth_seed_state WHERE seed_key = 'independent_features_v1'").run()
    db.exec("CREATE TRIGGER fail_feature_marker BEFORE INSERT ON auth_seed_state WHEN NEW.seed_key = 'independent_features_v1' BEGIN SELECT RAISE(ABORT, 'feature rollback'); END")
    assert.throws(() => migrateIndependentFeaturePermissions(db), /feature rollback/)
    const has = (id: number, key: string) => db.prepare('SELECT allowed FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id WHERE gp.group_id = ? AND p.permission_key = ?').get(id, key) as { allowed: number } | undefined
    assert.equal(has(200, 'prompts.view'), undefined)
    db.exec('DROP TRIGGER fail_feature_marker')
    seedAccessControlDefaults(db)
    mappings.forEach(([, feature], index) => assert.equal(has(200 + index, feature)?.allowed, index === 1 ? 0 : 1))
    for (const id of [203, 204]) assert.equal(has(id, 'generation.execute'), undefined, 'chat use never becomes broad execution')
    for (const key of ['prompts.create', 'prompts.update', 'prompts.delete', 'workflows.update']) assert.equal(has(200, key), undefined)
    db.prepare("DELETE FROM auth_group_permissions WHERE group_id = 202 AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'generation.execute')").run()
    seedAccessControlDefaults(db)
    assert.equal(has(202, 'generation.execute'), undefined)
    assert.ok(has(3, 'generation.execute')?.allowed)
    db.close()
  })

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = req.header('x-test-session') ?? `test-${id ?? 'anonymous'}`
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id ? 'guest' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const status = async (url: string, accountId?: number, method = 'GET', sessionId?: string) => {
    const response = await fetch(origin + url, { method, headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), ...(sessionId ? { 'x-test-session': sessionId } : {}), 'Content-Type': 'application/json' }, ...(method === 'GET' || method === 'HEAD' ? {} : { body: '{}' }) })
    await response.arrayBuffer()
    return response.status
  }
  await t.test('trusted bootstrap includes image viewing; remote bootstrap stays denied', async () => {
    assert.equal(await status('/api/images/metadata/bad', undefined, 'GET', 'pre-setup'), 400)
    assert.equal(await status('/api/generation-queue', undefined, 'POST'), 400)
    assert.equal((await import('../src/services/generationTargetGroupService')).canAssignGenerationGroup(null), true)
    let rejected = 0
    allowImagesView({ socket: { remoteAddress: '192.0.2.1' }, headers: {}, session: {} } as never, { status: (code: number) => ({ json: () => { rejected = code } }) } as never, () => assert.fail('remote bootstrap'))
    assert.equal(rejected, 401)
  })
  const bootstrapSession = { ...sessions.get('pre-setup') }
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-test', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  invalidateConfiguredAuthCache()
  await t.test('configured auth clears reused pre-setup sessions and stops advertising bootstrap admin', async () => {
    for (const [sid, url] of [['residual-media', '/api/images/metadata/bad'], ['residual-auth', '/save/missing.png']]) {
      sessions.set(sid, { ...bootstrapSession })
      assert.equal(await status(url, undefined, 'GET', sid), 401)
      assert.equal(sessions.get(sid)?.authenticated, false)
      assert.equal(sessions.get(sid)?.permissionKeys, undefined)
    }
    sessions.set('residual-status', { ...bootstrapSession })
    const payload = await (await fetch(origin + '/api/auth/status', { headers: { 'x-test-session': 'residual-status' } })).json() as { authenticated: boolean; isAdmin: boolean; accountType: string | null; permissionKeys: string[] }
    assert.equal(payload.authenticated, false)
    assert.equal(payload.isAdmin, false)
    assert.equal(payload.accountType, null)
    assert.equal(payload.permissionKeys.includes('images.view'), false)
  })
  const group = AuthPermissionGroup.createCustomGroup({ name: 'image-reader', permissionKeys: ['images.view'] })
  const accountId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('reader', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(group.id, accountId)
  for (const directory of ['uploads', 'temp', 'save']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true })
    fs.writeFileSync(path.join(root, directory, 'permission.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64'))
  }
  await t.test('page off + image view on, inverse and action separation reach actual API mounts', async () => {
    for (const url of ['/api/images/metadata/bad', '/api/images/bad/thumbnail', '/api/images/bad/file']) assert.equal(await status(url, accountId), 400, url)
    assert.ok((sessions.get(`test-${accountId}`)?.permissionKeys as string[]).includes('images.view'))
    for (const url of ['/uploads/permission.png', '/temp/permission.png', '/save/permission.png']) assert.equal(await status(url, accountId), 200, url)
    const raw = await fetch(origin + '/uploads/permission.png', { headers: { 'x-test-account': String(accountId) } })
    assert.equal(raw.headers.get('Cache-Control'), 'private, no-cache')
    await raw.arrayBuffer()
    assert.equal(await status('/api/images/batch', accountId, 'POST'), 400)
    assert.equal(await status('/api/groups'), 401)
    assert.equal(await status('/api/groups', accountId, 'POST'), 403)
    assert.equal(await status('/api/images/bulk', accountId, 'DELETE'), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['page.home.view', 'page.image-detail.view', 'page.groups.view', 'chat.llm.use', 'generation.execute'] })
    for (const url of ['/api/images/metadata/bad', '/api/images/bad/thumbnail', '/api/images/bad/file', '/api/generation-history', '/api/runtime-media-settings/viewer', '/uploads/permission.png', '/temp/permission.png', '/save/permission.png']) assert.equal(await status(url, accountId), 403, url)
    assert.throws(() => requireRequesterImagePermission({ accountId, accountType: 'guest' }), /images.view/)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view', 'images.delete'] })
    assert.equal(await status('/api/images/bulk', accountId, 'DELETE'), 400)
    assert.equal(AuthAccessControlService.resolveForAccountId(accountId).permissionKeys.includes('page.home.view'), false)
  })
  await t.test('stored workflow media requires images.view regardless of MIME, pages or generation grants', async () => {
    const { storeWorkflowInputAssetFile } = await import('../src/services/workflowInputAssetStore')
    const fixtures = [
      { name: 'permission.png', mime: 'image/png', bytes: fs.readFileSync(path.join(root, 'uploads', 'permission.png')) },
      // Small MP4 header and two-frame GIF; authorization must not depend on media decoding.
      { name: 'permission.mp4', mime: 'video/mp4', bytes: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex') },
      { name: 'permission.gif', mime: 'image/gif', bytes: Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex') },
    ]
    const assets = fixtures.map((fixture) => {
      const temporaryPath = path.join(root, 'temp', fixture.name)
      fs.writeFileSync(temporaryPath, fixture.bytes)
      const ref = storeWorkflowInputAssetFile(temporaryPath, { fileName: fixture.name, mimeType: fixture.mime, bytes: fixture.bytes.length })
      return { ...fixture, url: `/api/workflow-input-assets/${ref.id}` }
    })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['page.home.view', 'page.generation.view', 'workflows.view', 'generation.execute'] })
    for (const asset of assets) {
      for (const suffix of ['', `?mime=${encodeURIComponent(asset.mime)}`, '?mime=audio%2Fwav', '?mime=text%2Fplain']) {
        for (const method of ['GET', 'HEAD']) assert.equal(await status(asset.url + suffix, accountId, method), 403, `${method} ${asset.name}${suffix}`)
      }
      const deniedRange = await fetch(origin + asset.url, { headers: { 'x-test-account': String(accountId), Range: 'bytes=0-3' } })
      assert.equal(deniedRange.status, 403, asset.name)
      await deniedRange.arrayBuffer()
    }
    assert.equal(await status('/api/workflow-input-assets/bad', accountId), 403, 'permission checked before asset resolution')
    assert.equal(await status('/api/workflow-input-assets', accountId, 'POST'), 400, 'upload still uses generation.execute')
    assert.equal(await status('/api/workflow-input-assets/bad', accountId, 'DELETE'), 200, 'delete still uses generation.execute')
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    for (const asset of assets) {
      assert.equal(await status(asset.url), 401, 'login boundary remains')
      for (const suffix of ['', `?mime=${encodeURIComponent(asset.mime)}`, '?mime=audio%2Fwav']) {
        const response = await fetch(origin + asset.url + suffix, { headers: { 'x-test-account': String(accountId) } })
        assert.equal(response.status, 200, asset.name + suffix)
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.bytes)
      }
      const head = await fetch(origin + asset.url, { method: 'HEAD', headers: { 'x-test-account': String(accountId) } })
      assert.equal(head.status, 200, asset.name)
      assert.equal(head.headers.get('Content-Length'), String(asset.bytes.length))
      assert.equal((await head.arrayBuffer()).byteLength, 0)
      const range = await fetch(origin + asset.url, { headers: { 'x-test-account': String(accountId), Range: 'bytes=0-3' } })
      assert.equal(range.status, 206, asset.name)
      assert.equal(range.headers.get('Content-Range'), `bytes 0-3/${asset.bytes.length}`)
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), asset.bytes.subarray(0, 4))
    }
    assert.equal(await status('/api/workflow-input-assets', accountId, 'POST'), 403)
    assert.equal(await status(assets[0].url, accountId, 'DELETE'), 403)
  })
  await t.test('HTTP history and private-file records retain ownership with images.view', async () => {
    const db = user.getUserSettingsDb()
    const addHistory = (ownerId: number) => Number(db.prepare("INSERT INTO api_generation_history (service_type, requested_by_account_id, requested_by_account_type) VALUES ('novelai', ?, 'guest')").run(ownerId).lastInsertRowid)
    const own = addHistory(accountId)
    const other = addHistory(adminId)
    assert.equal(await status(`/api/generation-history/${own}`, accountId), 200)
    for (const suffix of ['', '/file', '/thumbnail', '/image']) assert.equal(await status(`/api/generation-history/${other}${suffix}`, accountId), 403, suffix)
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const mcp = createMcpServer({ scopes: ['read', 'organize', 'generate'], source: 'http', requester: { accountId, accountType: 'admin' } })
    const client = new Client({ name: 'permission-regression', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    try {
      assert.equal((await client.callTool({ name: 'list_prompt_presets', arguments: {} })).isError, true)
      assert.equal((await client.callTool({ name: 'submit_generation_job', arguments: { service_type: 'codex', request_payload: { prompt: 'must not execute' } } })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view', 'prompts.view'] })
      assert.notEqual((await client.callTool({ name: 'list_prompt_presets', arguments: {} })).isError, true)
      assert.equal((await client.callTool({ name: 'create_prompt_preset', arguments: { name: 'denied', items: [{ description: 'denied', value: 'denied' }] } })).isError, true)
      const { PromptPresetModel } = await import('../src/models/PromptPreset')
      assert.equal(PromptPresetModel.findByName('denied'), undefined)
      const result = await client.callTool({ name: 'get_generation_history', arguments: { history_id: other } })
      assert.deepEqual(JSON.parse((result.content as Array<{ text: string }>)[0].text).records, [])
      assert.equal((await client.callTool({ name: 'resolve_image_group_path', arguments: { group_path: 'must-not-create', create: true } })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.llm.use', 'chat.tools.read'] })
      assert.equal((await client.callTool({ name: 'get_image_metadata', arguments: { composite_hash: 'a'.repeat(48) } })).isError, true)
    } finally {
      await client.close()
      await mcp.close()
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    }
    assert.equal(await status('/api/files', accountId), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view', 'files.view'] })
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const folder = FileStoreService.createFolder(fileOwnerKey(accountId), null, 'own')
    assert.equal(await status(`/api/files/${folder.id}`, accountId), 200)
    assert.equal(await status(`/api/files/${folder.id}?owner=${fileOwnerKey(adminId)}`, accountId), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    assert.equal(await status('/api/generation-history/clear?service_type=novelai', accountId, 'POST'), 200)
    assert.ok(db.prepare('SELECT 1 FROM api_generation_history WHERE id = ?').get(other))
  })
  await t.test('linked NAI and Comfy presets generate independently of page binding and general tool selection', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatToolPresetStore } = await import('../src/services/codex-chat/chatToolPresets')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { resolveChatAccess, resolveChatProfileToolGrant } = await import('../src/services/codex-chat/codexChatAccess')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { WorkflowModel } = await import('../src/models/Workflow')
    const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { parseChatPageContext } = await import('../src/services/codex-chat/chatPageContext')
    updateChatSettings({ enabled: true })
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    ComfyUIServerModel.create({ name: 'Queue fixture', endpoint: 'http://unused.invalid', is_active: true })
    const workflowId = WorkflowModel.create({ name: 'Linked workflow', workflow_json: JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }), marked_fields: [{ id: 'prompt', label: 'Prompt', type: 'text', jsonPath: '1.inputs.text', required: true }] })
    const nai = ChatGenerationPresetStore.create({ name: 'Linked NAI', kind: 'nai' })
    const comfy = ChatGenerationPresetStore.create({ name: 'Linked Comfy', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['prompt'] } })
    const general = ChatToolPresetStore.create({ name: 'Page inputs only', scopes: ['read'], toolAllowlist: ['get_current_page'] })
    const profile = ChatProfileStore.create({ name: 'Linked generator', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['read'], toolPresetId: general.id, generationPresetIds: [nai.id, comfy.id] })
    const controller = new AbortController()
    const page = normalizeChatPageSnapshot({ instanceId: 'page-instance', connectionId: 'page-connection', path: '/generation', title: 'Generation', kind: 'page', resourceId: null, fields: [] })
    assert.ok(resolveChatAccess(adminId).scopes.includes('generate'), 'administrator already holds account generation scope')
    const permittedGuestKeys = ['chat.llm.use', 'chat.tools.read', 'chat.tools.generate', 'generation.execute', 'workflows.view']
    const cases: Array<[number, 'admin' | 'guest', boolean]> = [[adminId, 'admin', false], [adminId, 'admin', true], [accountId, 'guest', false], [accountId, 'guest', true]]
    for (const [callerId, accountType, connected] of cases) {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: connected ? [...permittedGuestKeys, 'page.generation.view'] : permittedGuestKeys })
      const requester = { accountId: callerId, accountType }
      const current = ChatProfileStore.find(profile.id)!
      const connectedPage = parseChatPageContext(connected ? page : undefined, requester, current)
      if (accountType === 'guest' && !connected) assert.equal(AuthAccessControlService.hasPermission(callerId, 'page.generation.view'), false, 'generation remains available with its page disabled')
      const context = { threadId: CodexChatStore.createThread(callerId, 'linked presets', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: `linked-${callerId}-${connected}`, ...(connectedPage ? { page: connectedPage } : {}) }
      const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const grant = resolveChatProfileToolGrant(current, resolveChatAccess(callerId))
      const bridge = await openChatMcpBridge(requester, grant.scopes, grant.toolAllowlist, { chatContext: context, generationPresetIds: current.generationPresetIds })
      try {
        const names = bridge.tools.map((tool) => tool.function.name)
        assert.ok(names.includes('generate_image') && names.includes('generate_image_2'))
        assert.equal(names.includes('get_current_page'), connected)
        for (const unrelated of ['submit_generation_job', 'generate_nai', 'list_workflows', 'delete_files']) assert.equal(names.includes(unrelated), false)
        for (const [tool, service] of [['generate_image', 'novelai'], ['generate_image_2', 'comfyui']]) {
          const result = await bridge.call(tool, { prompt: 'a cat' })
          assert.notEqual(result.isError, true, JSON.stringify(result))
          const queued = JSON.parse((result.content![0] as { text: string }).text)
          const job = GenerationQueueModel.findById(queued.id)!
          assert.equal(job.service_type, service)
          assert.equal(job.requested_by_account_id, callerId)
          assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job))
          if (service === 'comfyui') assert.equal(job.workflow_id, workflowId)
        }
        ChatProfileStore.update(profile.id, { generationPresetIds: [] })
        assert.equal((await bridge.call('generate_image_2', { prompt: 'unlinked' })).isError, true)
        assert.deepEqual(resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(callerId)), { scopes: ['read'], toolAllowlist: ['get_current_page'] }, 'unlinking never enables free-form generation')
      } finally {
        stop(); await bridge.close()
        ChatProfileStore.update(profile.id, { generationPresetIds: [nai.id, comfy.id] })
      }
    }
    const guestContext = { threadId: CodexChatStore.createThread(accountId, 'denied presets', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'linked-denied' }
    const stop = registerChatReply(guestContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.llm.use', 'chat.tools.generate'] })
    const grant = resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId))
    const denied = await openChatMcpBridge({ accountId, accountType: 'guest' }, grant.scopes, grant.toolAllowlist, { chatContext: guestContext, generationPresetIds: [nai.id, comfy.id] })
    try {
      assert.equal((await denied.call('generate_image', { prompt: 'no execution grant' })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.llm.use', 'generation.execute'] })
      assert.equal(resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId)).scopes.includes('generate'), false)
      assert.equal((await denied.call('generate_image', { prompt: 'no chat grant' })).isError, true)
    } finally { stop(); await denied.close(); AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] }) }
  })
  await t.test('chat execution intersects live domain, profile, role, ownership and host boundaries', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatToolPresetStore } = await import('../src/services/codex-chat/chatToolPresets')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { requireMcpToolAccess } = await import('../src/mcp/toolAccess')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { McpArtifactService } = await import('../src/services/mcpArtifactService')
    const { enqueueMcpGenerationJob } = await import('../src/mcp/tools/generationJobTools')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    const db = user.getUserSettingsDb()
    const permissions = ['chat.llm.use', 'chat.tools.read', 'chat.tools.generate', 'chat.tools.configure', 'images.view', 'prompts.view', 'prompts.create', 'generation.execute', 'workflows.view']
    const grant = (keys = permissions) => AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
    grant()
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Security fixture', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['read', 'generate', 'configure'] })
    const context = { threadId: CodexChatStore.createThread(accountId, 'security', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'security-reply' }
    const controller = new AbortController()
    const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId, accountType: 'admin' }, ['read', 'generate', 'configure'], null, { chatContext: context })
    const cancel = sub.mock.method(GenerationQueueService, 'requestCancellation', async () => {})
    const dispatch = sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    const refresh = sub.mock.method(McpArtifactService, 'refreshDescriptor', async () => null)
    try {
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'permitted website read survives')
      assert.equal((await bridge.call('unknown_host_tool', {})).isError, true)
      assert.throws(() => requireMcpToolAccess({ scopes: ['read'], requester: { accountId, accountType: 'admin' } }, 'unclassified_future_tool'), /Unknown|Unclassified/)
      assert.equal((await bridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true, 'forged browser admin does not grant admin configuration')
      const own = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'fixture' }, requested_by_account_id: accountId, requested_by_account_type: 'guest' })
      const foreign = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'fixture' }, requested_by_account_id: adminId, requested_by_account_type: 'admin' })
      assert.notEqual((await bridge.call('get_generation_job', { job_id: own })).isError, true)
      for (const name of ['get_generation_job', 'get_generation_artifacts', 'cancel_generation_job']) assert.equal((await bridge.call(name, { job_id: foreign })).isError, true, name)
      assert.equal(cancel.mock.callCount(), 0, 'foreign cancellation denied before the side effect')
      const history = Number(db.prepare("INSERT INTO api_generation_history (service_type, requested_by_account_id, requested_by_account_type) VALUES ('novelai', ?, 'admin')").run(adminId).lastInsertRowid)
      assert.equal((await bridge.call('get_generation_history_request', { history_id: history })).isError, true)
      assert.equal((await bridge.call('refresh_artifact_download', { artifact_id: 'forged' })).isError, true)
      assert.equal(refresh.mock.callCount(), 0)
      const before = db.prepare('SELECT COUNT(*) AS count FROM generation_queue_jobs').get() as { count: number }
      assert.equal((await bridge.call('submit_generation_job', { service_type: 'codex', request_payload: { prompt: 'must not execute' } })).isError, true)
      assert.equal((await bridge.call('execute_graph_workflow', { workflow_id: 1 })).isError, true)
      for (const payload of [{ nested: { filePath: 'C:\\private\\secret' } }, { timeline_data: '{"assets":{"x":{"storagePath":"C:\\\\private\\\\secret"}}}' }, { __ref: 'queue-input', sha256: 'a'.repeat(64) }]) {
        assert.equal((await bridge.call('submit_generation_job', { service_type: 'comfyui', workflow_id: 1, inputs: payload })).isError, true)
      }
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM generation_queue_jobs').get() as { count: number }).count, before.count)
      ChatProfileStore.update(profile.id, { mcpEnabled: false })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatProfileStore.update(profile.id, { mcpEnabled: true, toolAllowlist: [] })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      const tools = ChatToolPresetStore.create({ name: 'Live tool grant', scopes: ['read'], toolAllowlist: ['list_prompt_presets'] })
      ChatProfileStore.update(profile.id, { toolPresetId: tools.id, toolAllowlist: null })
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatToolPresetStore.update(tools.id, { toolAllowlist: [] })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      db.prepare('DELETE FROM chat_tool_presets WHERE id = ?').run(tools.id)
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true, 'missing preset never restores direct grants')
      ChatProfileStore.update(profile.id, { toolPresetId: null, mcpScopes: ['read', 'generate'], toolAllowlist: null })
      grant(permissions.filter((key) => key !== 'prompts.view'))
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      grant()
      auth.prepare("UPDATE auth_accounts SET status = 'disabled' WHERE id = ?").run(accountId)
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      auth.prepare("UPDATE auth_accounts SET status = 'active' WHERE id = ?").run(accountId)
      invalidateResolvedAuthAccessCache()
      const authority = { scopes: ['generate' as const], requester: { accountId, accountType: 'guest' as const }, source: 'llm-chat' as const, chatContext: context }
      const queued = await enqueueMcpGenerationJob(authority, { service_type: 'novelai', request_payload: { prompt: 'fixture', n_samples: 1 } })
      assert.ok(queued?.id)
      assert.equal(dispatch.mock.callCount(), 1)
      close()
      const job = GenerationQueueModel.findById(queued!.id)!
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job), 'accepted queue job remains authorized after its reply ends')
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(GenerationQueueModel.findById(own)!), 'ordinary website jobs retain their contract')
      db.prepare('INSERT INTO chat_generation_links (job_id, thread_id, reply_id) VALUES (?, ?, ?)').run(own, context.threadId, 'legacy-reply')
      assert.throws(() => requireQueuedChatGenerationAccess(GenerationQueueModel.findById(own)!), /older chat generation job/)
      grant(permissions.filter((key) => key !== 'generation.execute'))
      assert.throws(() => requireQueuedChatGenerationAccess(job), /generation.execute/)
      grant()
      ChatProfileStore.update(profile.id, { mcpScopes: ['read'] })
      assert.throws(() => requireQueuedChatGenerationAccess(job), /프로필/)
      const preset = ChatGenerationPresetStore.create({ name: 'Preset boundary', kind: 'nai' })
      ChatProfileStore.update(profile.id, { mcpScopes: ['generate'], generationPresetIds: [preset.id] })
      const presetContext = { ...context, replyId: 'preset-security' }
      const stop = registerChatReply(presetContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const presets = await openChatMcpBridge(authority.requester, ['generate'], null, { chatContext: presetContext, generationPresetIds: [preset.id] })
      try {
        ChatGenerationPresetStore.update(preset.id, { nai: { promptPrefix: 'edited in the same second' } })
        assert.equal((await presets.call('generate_image', { prompt: 'must not generate' })).isError, true)
        assert.equal(dispatch.mock.callCount(), 1)
      } finally { stop(); await presets.close() }
      const administratorContext = { ...context, threadId: CodexChatStore.createThread(adminId, 'admin security', 'llm', profile.id), replyId: 'admin-demotion' }
      ChatProfileStore.update(profile.id, { generationPresetIds: [], mcpScopes: ['configure'] })
      const endAdmin = registerChatReply(administratorContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const adminBridge = await openChatMcpBridge({ accountId: adminId, accountType: 'admin' }, ['configure'], null, { chatContext: administratorContext })
      try {
        assert.notEqual((await adminBridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true)
        auth.prepare("UPDATE auth_accounts SET account_type = 'guest' WHERE id = ?").run(adminId)
        invalidateResolvedAuthAccessCache()
        assert.equal((await adminBridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true, 'live demotion removes admin authority in an open bridge')
      } finally {
        endAdmin(); await adminBridge.close()
        auth.prepare("UPDATE auth_accounts SET account_type = 'admin' WHERE id = ?").run(adminId)
        invalidateResolvedAuthAccessCache()
      }
    } finally {
      close(); await bridge.close(); grant(['images.view'])
      auth.prepare("UPDATE auth_accounts SET status = 'active' WHERE id = ?").run(accountId)
      invalidateResolvedAuthAccessCache()
    }
  })
  await t.test('account-bound artifacts keep live authenticated downloads and external keys keep signed links', async (sub) => {
    const { McpArtifactService } = await import('../src/services/mcpArtifactService')
    const { ImageUploadService } = await import('../src/services/imageUploadService')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    const record = { id: 901, requested_by_account_id: accountId, requested_by_account_type: 'guest', generation_status: 'completed', actual_composite_hash: 'a'.repeat(48), actual_mime_type: 'image/png' }
    sub.mock.method(HistoryQueryRepository, 'findByIdWithMetadata', () => record)
    sub.mock.method(HistoryQueryRepository, 'findAllWithMetadata', () => [record])
    sub.mock.method(ImageUploadService, 'getActiveFilePath', () => path.join(root, 'uploads', 'permission.png'))
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    const requester = { accountId, accountType: 'admin' as const }
    const own = await McpArtifactService.createHistoryDescriptor(record.id, origin, requester)
    assert.equal(own?.download_url, `${origin}/api/generation-history/${record.id}/file`)
    assert.ok(!own?.download_url.includes('token='))
    const external = await McpArtifactService.createHistoryDescriptor(record.id, origin)
    assert.ok(external?.download_url.includes('/mcp/artifacts/'))
    assert.ok(external?.download_url.includes('token='))
    const refreshed = await McpArtifactService.refreshDescriptor(own!.artifact_id, origin, requester)
    assert.equal(refreshed?.download_url, own?.download_url)
    record.requested_by_account_id = adminId
    await assert.rejects(McpArtifactService.refreshDescriptor(own!.artifact_id, origin, requester), /not accessible/)
    record.requested_by_account_id = accountId
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    await assert.rejects(McpArtifactService.createHistoryDescriptor(record.id, origin, requester), /images.view/)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
  })
  await t.test('functional reads and actions survive page-off, and page grants confer neither', async () => {
    const reads = ['/api/prompt-collection/search', '/api/prompt-presets', '/api/wildcards', '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists', '/api/comfyui-servers', '/api/external-api/llm-presets/options']
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['prompts.view', 'wildcards.view', 'workflows.view'] })
    for (const url of reads) assert.equal(await status(url, accountId), 200, url)
    for (const url of ['/api/prompt-presets', '/api/prompt-collection/collect', '/api/prompt-groups', '/api/wildcards', '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists', '/api/comfyui-servers']) assert.equal(await status(url, accountId, 'POST'), 403, url)
    assert.equal(await status('/api/prompt-collection/resolve-groups', accountId, 'POST'), 400)
    assert.equal(await status('/api/wildcards/parse', accountId, 'POST'), 400)
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['page.prompts.view', 'page.wildcards.view', 'page.generation.view', 'page.settings.view', 'chat.llm.use', 'chat.tools.generate'] })
    for (const url of reads) assert.equal(await status(url, accountId), 403, url)
    assert.equal(await status('/api/generation-queue', accountId), 200, 'session-only queue read survives')
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 403, 'chat scopes do not imply execution')
    for (const url of ['/api/settings', '/api/settings/general', '/api/external-api/providers', '/api/comfyui-servers']) assert.equal(await status(url, accountId, url.endsWith('general') ? 'PUT' : url.endsWith('servers') ? 'POST' : 'GET'), 403, url)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['workflows.view', 'workflows.update'] })
    assert.equal(await status('/api/custom-dropdown-lists/comfy-model-thumbnail', accountId), 403)
    assert.equal(await status('/api/nai/store/vibes/missing', accountId, 'PUT'), 403)
    assert.equal(await status('/api/nai/store/character-references', accountId, 'POST'), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['generation.execute'] })
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 400, 'execute reaches input validation without pages/images')
    assert.equal(await status('/api/graph-workflows/999999/execute', accountId, 'POST'), 404)
    assert.equal(await status('/api/workflows/999999/generate', accountId, 'POST'), 400)
    assert.equal(await status('/api/public-workflows/missing/queue', accountId, 'POST'), 404, 'publication scope remains')
    assert.equal(await status('/api/nai/generate/upscale', accountId, 'POST'), 403, 'inline upscale returns image and needs image read')
    const safeSettings = await (await fetch(origin + '/api/runtime-settings/image-save', { headers: { 'x-test-account': String(accountId) } })).json() as { data: Record<string, unknown> }
    assert.deepEqual(Object.keys(safeSettings.data), ['imageSave'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    assert.equal(await status('/api/custom-dropdown-lists/comfy-model-thumbnail', accountId), 400, 'bitmap reads do not require workflow data/page rights')
    assert.equal(await status('/api/settings', adminId), 200, 'admin configuration independent of navigation')
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['prompts.view', 'wildcards.view', 'workflows.view'])
    for (const url of reads) assert.equal(await status(url), 401, 'preserve login boundary: ' + url)
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', [])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
  })
  await t.test('SSE uses live functional grants, rejects bootstrap residue and never writes sessions', async () => {
    const { resolveEventStreamAccess, resolvePermittedEventStreamTopics, createEventStreamAccessRevalidator } = await import('../src/routes/events/event-stream-auth')
    const residue = { authenticated: true, accountType: 'admin', permissionKeys: ['page.generation.view', 'images.view', 'workflows.view'] }
    assert.deepEqual(resolveEventStreamAccess({ session: residue } as never), { ok: false, status: 401 })
    assert.deepEqual(residue, { authenticated: true, accountType: 'admin', permissionKeys: ['page.generation.view', 'images.view', 'workflows.view'] })
    assert.deepEqual(createEventStreamAccessRevalidator(null, ['generation-queue'], true)(), { ok: false, reason: 'unauthenticated' })
    assert.deepEqual(resolvePermittedEventStreamTopics(['page.generation.view'], ['generation-queue', 'generation-history', 'graph-execution', 'runtime-job']), ['generation-queue', 'runtime-job'])
    assert.deepEqual(resolvePermittedEventStreamTopics(['images.view', 'workflows.view'], ['generation-history', 'graph-execution']), ['generation-history', 'graph-execution'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['workflows.view'] })
    const revalidate = createEventStreamAccessRevalidator(accountId, ['graph-execution'])
    assert.deepEqual(revalidate(), { ok: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.deepEqual(revalidate(), { ok: false, reason: 'permission-revoked' })
    assert.deepEqual(createEventStreamAccessRevalidator(accountId, ['generation-queue'])(), { ok: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['prompts.view'] })
    const nonTopicRevalidate = createEventStreamAccessRevalidator(accountId, ['generation-queue'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.deepEqual(nonTopicRevalidate(), { ok: false, reason: 'permission-revoked' }, 'revoking a non-topic grant refreshes shared auth state')
    const addedGrantRevalidate = createEventStreamAccessRevalidator(accountId, ['generation-queue'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['prompts.view'] })
    assert.deepEqual(addedGrantRevalidate(), { ok: false, reason: 'permission-revoked' }, 'grant additions also refresh shared auth state')
    const { requireChatPageDataAccess } = await import('../src/services/codex-chat/chatPageContext')
    assert.doesNotThrow(() => requireChatPageDataAccess({ accountId, accountType: 'guest' }, 'presets'))
    const permissionRow = auth.prepare("SELECT id FROM auth_permissions WHERE permission_key = 'prompts.view'").get() as { id: number }
    auth.prepare("UPDATE auth_permissions SET permission_key = 'test.missing.prompts.view' WHERE id = ?").run(permissionRow.id)
    invalidateResolvedAuthAccessCache()
    try { assert.throws(() => requireChatPageDataAccess({ accountId, accountType: 'guest' }, 'presets'), /prompts.view/, 'missing catalog rows never bypass the domain grant') }
    finally {
      auth.prepare("UPDATE auth_permissions SET permission_key = 'prompts.view' WHERE id = ?").run(permissionRow.id)
      invalidateResolvedAuthAccessCache()
    }
    assert.equal((await import('../src/services/generationTargetGroupService')).canAssignGenerationGroup(null), false)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
  })
  await t.test('anonymous and inherited grants use the same feature and scoped replacements roll back', async () => {
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['images.view', 'page.home.view'])
    assert.equal(await status('/api/images/metadata/bad'), 400)
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['images.view'])
    assert.equal(await status('/api/images/metadata/bad'), 400)
    assert.ok(AuthAccessControlService.resolveForGroupKey('guest').permissionKeys.includes('images.view'))
    auth.exec("CREATE TRIGGER fail_replace BEFORE INSERT ON auth_group_permissions WHEN NEW.permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'page.home.view') BEGIN SELECT RAISE(ABORT, 'test replacement rollback'); END")
    assert.throws(() => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['page.home.view']), /rollback/)
    auth.exec('DROP TRIGGER fail_replace')
    assert.ok(AuthAccessControlService.resolveForGroupKey('anonymous').permissionKeys.includes('images.view'))
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['page.home.view'])
    assert.equal(await status('/api/images/metadata/bad'), 401)
    invalidateResolvedAuthAccessCache()
  })
  await t.test('image grants do not confer another account history or private files; UI page toggles keep actions', async () => {
    const request = { session: { authenticated: true, accountId, accountType: 'guest' } } as never
    assert.equal(canAccessHistoryRecord(request, { requested_by_account_id: accountId, requested_by_account_type: 'guest' }), true)
    assert.equal(canAccessHistoryRecord(request, { requested_by_account_id: adminId, requested_by_account_type: 'admin' }), false)
    assert.equal(AuthAccessControlService.hasPermission(accountId, 'files.view'), false)
    const { resolveFeaturePermissions } = await import('../../frontend/src/features/auth/use-feature-permissions')
    const { resolveAccountDraftOwner } = await import('../../frontend/src/features/auth/auth-permissions')
    const readerDraftOwner = resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId })
    assert.equal(readerDraftOwner, resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId }), 'same-account reload keeps its draft namespace')
    assert.notEqual(readerDraftOwner, resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId: adminId }), 'another account never shares the draft namespace')
    assert.notEqual(resolveAccountDraftOwner({ authenticated: true, hasCredentials: false, accountId: null }), resolveAccountDraftOwner({ authenticated: false, hasCredentials: true, accountId: null }), 'bootstrap drafts are not anonymous drafts after setup')
    assert.equal(resolveFeaturePermissions(['page.generation.view', 'page.prompts.view'], true).canExecuteGeneration, false)
    assert.equal(resolveFeaturePermissions(['generation.execute'], true).canExecuteGeneration, true)
    assert.equal(resolveFeaturePermissions(['prompts.view', 'workflows.view'], true).canUpdateWorkflows, false)
    const keys = ['page.home.view', 'images.view', 'images.metadata.edit', 'groups.update']
    assert.deepEqual(setPermissionGrant(keys, 'page.home.view', false), keys.slice(1))
    const sections = buildPermissionSections(AuthPermissionGroup.listBuiltInEditablePermissions().map((row) => ({ permissionKey: row.permission_key, label: row.description ?? row.permission_key })))
    assert.equal(sections.find((section) => section.rows.some((row) => row.key === 'images.view'))?.kind, 'feature')
    assert.ok(sections.flatMap((section) => section.rows).every((row) => row.parentKey === null))
  })
})
