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
  const { seedAccessControlDefaults } = await import('../src/database/authDbSeed')
  const { PERMISSION_KEYS, withPagePermissions } = await import('@conai/shared')
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

  await t.test('permissions v2 folds old keys once and moves member-only anonymous grants to guests', () => {
    const db = new Database(':memory:')
    createAuthTables(db)
    // An auth database from before v2: old keys exist, grants use them, and nothing has been converted yet.
    const legacy = ['page.home.view', 'prompts.view', 'groups.update', 'prompts.create', 'upload.create', 'files.organize', 'wildcards.lora.scan', 'workflows.update', 'chat.codex.use', 'chat.tools.read', 'images.copy']
    for (const key of legacy) db.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run(key, key, 'x')
    for (const key of ['anonymous', 'editor', 'uploader', 'agent']) db.prepare('INSERT INTO auth_permission_groups (group_key, name) VALUES (?, ?)').run(key, key)
    const grant = (group: string, key: string) => db.prepare('INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = ? AND p.permission_key = ?').run(group, key)
    grant('anonymous', 'page.home.view'); grant('anonymous', 'prompts.view')
    grant('editor', 'groups.update'); grant('editor', 'prompts.create'); grant('editor', 'wildcards.lora.scan'); grant('editor', 'workflows.update')
    grant('uploader', 'upload.create'); grant('uploader', 'files.organize'); grant('uploader', 'images.copy')
    grant('agent', 'chat.codex.use'); grant('agent', 'chat.tools.read')
    seedAccessControlDefaults(db)
    const keys = (group: string) => (db.prepare('SELECT p.permission_key AS key FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id JOIN auth_permission_groups g ON g.id = gp.group_id WHERE g.group_key = ? AND gp.allowed = 1 ORDER BY key').all(group) as Array<{ key: string }>).map((row) => row.key)
    assert.deepEqual(keys('editor'), ['images.edit', 'prompts.edit', 'wildcards.edit', 'workflows.edit'])
    assert.deepEqual(keys('uploader'), ['files.edit', 'images.upload'])
    assert.deepEqual(keys('agent'), ['chat.agent.use', 'chat.diagnostics.view', 'images.view'], 'older conversions still run first; bot tool keys are gone')
    assert.deepEqual(keys('anonymous'), ['auth.guest.create', 'images.view'], 'visitors keep only what a signed-out visitor can use')
    assert.ok(keys('guest').includes('prompts.view'), 'member-only anonymous grants move to the group every account inherits')
    assert.deepEqual(keys('admin'), [...PERMISSION_KEYS].sort())
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM auth_permissions WHERE permission_key NOT IN (${PERMISSION_KEYS.map(() => '?').join(', ')})`).get(...PERMISSION_KEYS).n, 0)
    db.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'editor') AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'images.edit')").run()
    seedAccessControlDefaults(db)
    assert.ok(!keys('editor').includes('images.edit'), 'restart never restores a later revocation')
    db.close()
  })

  await t.test('pages follow the features they show and are never stored', () => {
    assert.deepEqual(withPagePermissions(['images.view'], false).filter((key) => key.startsWith('page.')).sort(), ['page.groups.view', 'page.home.view', 'page.image-detail.view', 'page.wallpaper.runtime.view', 'page.wallpaper.view'])
    assert.ok(withPagePermissions(['images.view', 'images.edit'], false).includes('page.metadata-editor.view'))
    assert.ok(!withPagePermissions(['images.edit'], false).includes('page.metadata-editor.view'), 'the metadata page also needs image viewing')
    assert.ok(withPagePermissions(['workflows.view'], false).includes('page.generation.view'))
    assert.ok(withPagePermissions(['chat.agent.use'], false).includes('page.chat.view'))
    assert.ok(!withPagePermissions(PERMISSION_KEYS, false).includes('page.settings.view'), 'settings follow the administrator role')
    assert.ok(withPagePermissions([], true).includes('page.settings.view'))
    assert.deepEqual(withPagePermissions(['page.home.view'], false), [], 'a stored page key never survives')
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
  await t.test('CLI sign-in management is admin-only and Claude tool grants are independent and revocable', async () => {
    for (const agent of ['codex', 'claude']) {
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`, accountId), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/update`, accountId, 'POST'), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`, adminId), 200)
    }
    assert.equal(await status('/api/settings/agent-cli/unknown/login', adminId), 400)
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Claude permission fixture', engine: 'claude', mcpEnabled: true, mcpScopes: ['read'] })
    const chatContext = { threadId: CodexChatStore.createThread(accountId, 'Claude permissions', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'claude-permission-reply' }
    const endReply = registerChatReply(chatContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const requester = { accountId, accountType: 'guest' as const }
    // Tools are offered from the account's grants when the reply starts; each call rechecks them.
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.agent.use', 'prompts.view'] })
    const bridge = await openChatMcpBridge(requester, ['read'], null, { chatContext })
    try {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use', 'prompts.view'] })
      assert.throws(() => LlmChatService.requireStartableProfile(requester, profile.id), /권한/)
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.agent.use', 'prompts.view'] })
      assert.equal(LlmChatService.requireStartableProfile(requester, profile.id).engine, 'claude')
      const permitted = await bridge.call('list_prompt_presets', {})
      assert.notEqual(permitted.isError, true, JSON.stringify(permitted))
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['prompts.view'] })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
    } finally { endReply(); await bridge.close(); AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] }) }
  })
  await t.test('a profile limited to some groups serves only their members and administrators', async () => {
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
    const { resolveChatAccess, canUseChatProfile } = await import('../src/services/codex-chat/codexChatAccess')
    updateChatSettings({ enabled: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use'] })
    const team = AuthPermissionGroup.createCustomGroup({ name: 'team-only', permissionKeys: [] })
    const profile = ChatProfileStore.create({ name: 'Team only', engine: 'llm', providerName: 'fixture', allowedGroupKeys: [team.group_key, 'guest', 'missing-group'] })
    try {
      assert.deepEqual(profile.allowedGroupKeys, [team.group_key], 'unknown groups and the everyone-groups are dropped')
      const requester = { accountId, accountType: 'guest' as const }
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), profile), false)
      assert.throws(() => LlmChatService.requireStartableProfile(requester, profile.id), /권한/)
      assert.equal(canUseChatProfile(resolveChatAccess(adminId), profile), true, 'administrators always may')
      AuthPermissionGroup.addAccountMembership(team.id, accountId)
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), profile), true)
      AuthPermissionGroup.removeAccountMembership(team.id, accountId)
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), ChatProfileStore.find(profile.id)!), true, 'an empty list means everyone with the engine key')
    } finally {
      ChatProfileStore.delete(profile.id)
      AuthPermissionGroup.deleteCustomGroup(team.id)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] })
    }
  })
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
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use', 'generation.execute'] })
    for (const url of ['/api/images/metadata/bad', '/api/images/bad/thumbnail', '/api/images/bad/file', '/api/generation-history', '/api/runtime-media-settings/viewer', '/uploads/permission.png', '/temp/permission.png', '/save/permission.png']) assert.equal(await status(url, accountId), 403, url)
    assert.throws(() => requireRequesterImagePermission({ accountId, accountType: 'guest' }), /images.view/)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view', 'images.delete'] })
    assert.equal(await status('/api/images/bulk', accountId, 'DELETE'), 400)
    assert.equal(AuthAccessControlService.resolveForAccountId(accountId).permissionKeys.includes('page.home.view'), true, 'the home page follows image viewing')
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
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['workflows.view', 'generation.execute'] })
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
    const connect = async () => {
      const server = createMcpServer({ scopes: ['read', 'organize', 'generate'], source: 'http', requester: { accountId, accountType: 'admin' } })
      const connected = new Client({ name: 'permission-regression', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([server.connect(serverTransport), connected.connect(clientTransport)])
      return { server, connected }
    }
    let { server: mcp, connected: client } = await connect()
    try {
      assert.equal((await client.callTool({ name: 'list_prompt_presets', arguments: {} })).isError, true)
      assert.equal((await client.callTool({ name: 'submit_generation_job', arguments: { service_type: 'codex', request_payload: { prompt: 'must not execute' } } })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view', 'prompts.view'] })
      await client.close(); await mcp.close()
      ;({ server: mcp, connected: client } = await connect())
      assert.notEqual((await client.callTool({ name: 'list_prompt_presets', arguments: {} })).isError, true)
      assert.equal((await client.callTool({ name: 'create_prompt_preset', arguments: { name: 'denied', items: [{ description: 'denied', value: 'denied' }] } })).isError, true)
      const { PromptPresetModel } = await import('../src/models/PromptPreset')
      assert.equal(PromptPresetModel.findByName('denied'), undefined)
      const result = await client.callTool({ name: 'get_generation_history', arguments: { history_id: other } })
      assert.deepEqual(JSON.parse((result.content as Array<{ text: string }>)[0].text).records, [])
      assert.equal((await client.callTool({ name: 'resolve_image_group_path', arguments: { group_path: 'must-not-create', create: true } })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use'] })
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
  await t.test('current page connection follows page access without additional profile or chat read grants', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { parseChatPageContext } = await import('../src/services/codex-chat/chatPageContext')
    const { issueCodexChatMcpToken, authenticateCodexChatMcpRequest, revokeCodexChatMcpToken } = await import('../src/services/codex-chat/codexChatAccess')
    const { requireMcpToolAccess } = await import('../src/mcp/toolAccess')
    const { WorkflowModel } = await import('../src/models/Workflow')
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Page connection only', engine: 'llm', providerName: 'fixture', mcpEnabled: false, mcpScopes: [], toolAllowlist: [] })
    const visible = { instanceId: 'visible-page', connectionId: 'visible-connection', path: '/generation', title: 'Generation', kind: 'nai', resourceId: null, fields: [{ id: 'prompt', label: 'Prompt', type: 'text', value: 'visible draft', editable: false }], data: { files: [{ id: 'private-file' }] } }
    const keys = ['chat.use', 'chat.agent.use', 'generation.execute']
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
    const controller = new AbortController()
    try {
      for (const callerId of [adminId, accountId]) {
        const requester = { accountId: callerId, accountType: callerId === adminId ? 'admin' as const : 'guest' as const }
        const page = parseChatPageContext(visible, requester)!
        const context = { threadId: CodexChatStore.createThread(callerId, 'connected page', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: `page-only-${callerId}`, page }
        const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
        const bridge = await openChatMcpBridge(requester, [], [], { chatContext: context })
        const unbound = await openChatMcpBridge(requester, [], [], { chatContext: { ...context, page: undefined } })
        try {
          assert.equal(unbound.tools.some((tool) => tool.function.name === 'get_current_page'), false, 'page access never connects a page without user opt-in')
          const read = await bridge.call('get_current_page', {})
          assert.notEqual(read.isError, true, JSON.stringify(read))
          assert.match(JSON.stringify(read.content), /visible draft/)
          for (const tool of ['submit_generation_job', 'generate_nai', 'list_files', 'delete_files', 'propose_page_changes']) assert.equal(bridge.tools.some((entry) => entry.function.name === tool), false)
          if (callerId === accountId) {
            assert.equal((await bridge.call('read_page_data', { key: 'files' })).isError, true, 'current page access does not grant private file access')
            assert.doesNotMatch(JSON.stringify(read.content), /private-file/)
            const overview = parseChatPageContext({ ...visible, path: '/access', kind: 'page', fields: [] }, requester)
            assert.ok(overview, 'accessible overview requires no chat.tools.read grant')
            const workflowId = WorkflowModel.create({ name: 'Public page fixture', workflow_json: '{}', is_public_page: true, public_slug: 'page-access-fixture' })
            const published = { ...visible, path: '/public/workflows/page-access-fixture', kind: 'comfyui', resourceId: String(workflowId), fields: [] }
            assert.ok(parseChatPageContext(published, requester), 'published page follows native page access')
            WorkflowModel.update(workflowId, { is_public_page: false })
            assert.throws(() => parseChatPageContext(published, requester), /공개/)
            AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys.filter((key) => key !== 'generation.execute') })
            assert.throws(() => parseChatPageContext(visible, requester), /페이지/)
            assert.equal((await bridge.call('get_current_page', {})).isError, true, 'page revocation applies to an open reply')
            AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['generation.execute'] })
            assert.equal((await bridge.call('get_current_page', {})).isError, true, 'page access does not grant chat use')
            AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
          }
        } finally { stop(); await bridge.close(); await unbound.close() }
      }
      const codexProfile = ChatProfileStore.create({ name: 'Codex page only', engine: 'codex', mcpEnabled: false, toolAllowlist: [] })
      const context = { threadId: CodexChatStore.createThread(accountId, 'codex connected page', 'codex', codexProfile.id), profileId: codexProfile.id, kind: 'direct' as const, replyId: 'codex-page-only', page: parseChatPageContext(visible, { accountId, accountType: 'guest' })! }
      const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const token = issueCodexChatMcpToken({ accountId, accountType: 'guest' }, [], [], [], context)
      try {
        const authority = authenticateCodexChatMcpRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never, token)
        assert.ok(authority, 'Codex page connection needs no extra MCP read scope')
        assert.doesNotThrow(() => requireMcpToolAccess(authority, 'get_current_page'))
        assert.throws(() => requireMcpToolAccess(authority, 'submit_generation_job'), /Unknown|permitted/)
      } finally { stop(); revokeCodexChatMcpToken(token) }
    } finally { AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['images.view'] }) }
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
    const profile = ChatProfileStore.create({ name: 'Linked generator', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page'], generationPresetIds: [nai.id, comfy.id] })
    const controller = new AbortController()
    const page = normalizeChatPageSnapshot({ instanceId: 'page-instance', connectionId: 'page-connection', path: '/generation', title: 'Generation', kind: 'page', resourceId: null, fields: [] })
    assert.ok(resolveChatAccess(adminId).scopes.includes('generate'), 'administrator already holds account generation scope')
    const permittedGuestKeys = ['chat.use', 'generation.execute', 'workflows.view']
    const cases: Array<[number, 'admin' | 'guest', boolean]> = [[adminId, 'admin', false], [adminId, 'admin', true], [accountId, 'guest', false], [accountId, 'guest', true]]
    for (const [callerId, accountType, connected] of cases) {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: permittedGuestKeys })
      const requester = { accountId: callerId, accountType }
      const current = ChatProfileStore.find(profile.id)!
      const connectedPage = parseChatPageContext(connected ? page : undefined, requester)
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
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use'] })
    const grant = resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId))
    const denied = await openChatMcpBridge({ accountId, accountType: 'guest' }, grant.scopes, grant.toolAllowlist, { chatContext: guestContext, generationPresetIds: [nai.id, comfy.id] })
    try {
      assert.equal((await denied.call('generate_image', { prompt: 'no execution grant' })).isError, true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use', 'generation.execute'] })
      assert.ok(resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId)).scopes.includes('generate'), 'the bot follows the account generation grant')
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['generation.execute'] })
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
    const permissions = ['chat.use', 'images.view', 'prompts.view', 'prompts.edit', 'generation.execute', 'workflows.view']
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
      ChatProfileStore.update(profile.id, { mcpScopes: tools.scopes, toolAllowlist: tools.toolAllowlist })
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatToolPresetStore.update(tools.id, { toolAllowlist: [] })
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'a loaded preset is a copy: editing the preset leaves the profile alone')
      ChatToolPresetStore.delete(tools.id)
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'deleting the preset leaves the profile alone')
      ChatProfileStore.update(profile.id, { mcpScopes: ['read', 'generate'], toolAllowlist: null })
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
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['chat.use'] })
    for (const url of reads) assert.equal(await status(url, accountId), 403, url)
    assert.equal(await status('/api/generation-queue', accountId), 200, 'session-only queue read survives')
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 403, 'chat use does not imply execution')
    for (const url of ['/api/settings', '/api/settings/general', '/api/external-api/providers', '/api/comfyui-servers']) assert.equal(await status(url, accountId, url.endsWith('general') ? 'PUT' : url.endsWith('servers') ? 'POST' : 'GET'), 403, url)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['workflows.view', 'workflows.edit'] })
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
    assert.throws(() => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['prompts.view', 'wildcards.view', 'workflows.view']), /invalid/, 'visitors cannot be given member-only features')
    for (const url of reads) assert.equal(await status(url), 401, 'preserve login boundary: ' + url)
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
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['images.view'])
    assert.equal(await status('/api/images/metadata/bad'), 400)
    assert.ok(AuthAccessControlService.resolveForGroupKey('guest').permissionKeys.includes('images.view'))
    assert.ok(AuthAccessControlService.resolveForGroupKey('anonymous').permissionKeys.includes('page.home.view'), 'the visitor home page follows image viewing')
    auth.exec("CREATE TRIGGER fail_replace BEFORE INSERT ON auth_group_permissions WHEN NEW.permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'auth.guest.create') BEGIN SELECT RAISE(ABORT, 'test replacement rollback'); END")
    assert.throws(() => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['auth.guest.create']), /rollback/)
    auth.exec('DROP TRIGGER fail_replace')
    assert.ok(AuthAccessControlService.resolveForGroupKey('anonymous').permissionKeys.includes('images.view'))
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['auth.guest.create'])
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
    const keys = ['page.home.view', 'images.view', 'images.edit', 'images.edit']
    assert.deepEqual(setPermissionGrant(keys, 'page.home.view', false), keys.slice(1))
    const available = AuthPermissionGroup.listBuiltInEditablePermissions().map((row) => ({ permissionKey: row.permission_key, label: row.description ?? row.permission_key }))
    const memberRows = buildPermissionSections(available, 'guest').flatMap((section) => section.rows.map((row) => row.key))
    assert.ok(memberRows.every((key) => !key.startsWith('page.')), 'pages are never granted')
    assert.ok(!memberRows.includes('auth.guest.create'), 'guest signup is only for visitors')
    assert.deepEqual(buildPermissionSections(available, 'anonymous').flatMap((section) => section.rows.map((row) => row.key)), ['images.view', 'auth.guest.create'])
  })
})
