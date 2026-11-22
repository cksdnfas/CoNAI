import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { test } from 'node:test'
import AdmZip from 'adm-zip'

/**
 * A shared plugin page lends what its package declares (appTools, server actions, capabilities) to every viewer and
 * nothing else: undeclared tools, role checks and deleting keep the viewer's own permissions.
 */
test('shared plugin pages lend only the declared scope', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-plugin-scope-test-'))
  process.env.RUNTIME_BASE_PATH = path.join(root, '.private')
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const host = await import('../src/services/plugins/pluginHost')
  const app = await import('../src/services/plugins/pluginAppActions')
  const bridge = await import('../src/services/plugins/pluginAppBridge')
  const { pluginDb } = await import('../src/services/plugins/pluginStore')
  const { pluginAppToolScope } = await import('../src/services/plugins/pluginAppPolicy')
  const grants = await import('../src/services/generation-queue/queueMcpImageGrant')
  const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
  t.after(async () => {
    auth.close(); user.closeUserSettingsDb(); main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-plugin-scope-test-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  // The built-in guest group's keys this test relies on the viewer lacking.
  const stripped = ['plugins.view', 'images.view', 'files.view', 'files.edit', 'files.delete', 'workflows.view', 'generation.execute']
  const removed = auth.prepare(`SELECT g.id AS group_id, p.id AS permission_id FROM auth_permission_groups g JOIN auth_group_permissions gp ON gp.group_id = g.id JOIN auth_permissions p ON p.id = gp.permission_id
    WHERE g.group_key = 'guest' AND p.permission_key IN (${stripped.map(() => '?').join(',')})`).all(...stripped) as Array<{ group_id: number; permission_id: number }>
  // A throwaway database: nothing to restore afterwards.
  for (const row of removed) auth.prepare('DELETE FROM auth_group_permissions WHERE group_id = ? AND permission_id = ?').run(row.group_id, row.permission_id)
  const addAccount = (name: string) => Number(auth.prepare("INSERT INTO auth_accounts(username, password_hash, account_type) VALUES (?, 'unused', 'guest')").run(name).lastInsertRowid)
  const viewerId = addAccount('scope-viewer'), memberId = addAccount('scope-member')
  auth.prepare("INSERT INTO auth_accounts(username, password_hash, account_type) VALUES ('scope-admin', 'unused', 'admin')").run()
  // A member opens plugin pages without sharing but holds none of the feature keys.
  AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: 'scope-plugin-only', permissionKeys: ['plugins.view'] }).id, memberId)
  invalidateConfiguredAuthCache(); invalidateResolvedAuthAccessCache()
  const viewer = { requester: { accountId: viewerId, accountType: 'guest' as const }, sessionId: 'scope-viewer-session' }
  const member = { requester: { accountId: memberId, accountType: 'guest' as const }, sessionId: 'scope-member-session' }
  const viewerFile = FileStoreService.writeText(`account:${viewerId}`, null, 'note.txt', 'hello', { create: true })

  const manifest = {
    apiVersion: 1, id: 'lend-probe', name: 'Lend probe', version: '1.0.0', description: '',
    capabilities: ['files.read', 'files.write', 'media.pick'],
    appTools: ['search_images', 'list_files', 'create_file_folder', 'delete_files', 'set_live_wallpaper'],
    appRoutes: ['images.read', 'workflows.read'],
    serverActions: [{ id: 'lend-probe.groups', label: 'Groups', description: '', tool: 'list_image_groups', schema: { type: 'object', properties: {} } }],
    pages: [{ id: 'main', title: 'Main', entry: 'index.html', accepts: ['.txt'], actions: [], serverActions: ['lend-probe.groups'] }],
  }
  const zip = new AdmZip()
  zip.addFile('plugin.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile('index.html', Buffer.from('<!doctype html><title>probe</title>'))
  await registry.installPlugin(zip.toBuffer()); await registry.setPluginEnabled('lend-probe', true)
  const other = new AdmZip()
  other.addLocalFolder(path.resolve(__dirname, '../../plugins/text-editor'))
  await registry.installPlugin(other.toBuffer()); await registry.setPluginEnabled('text-editor', true)
  const base = 'http://localhost:1666'
  const denied = /권한|permission|Permission|Administrator/
  const settle = async (jobId: string) => { for (let attempt = 0; attempt < 200 && ['queued', 'running'].includes(RuntimeJobStore.get(jobId)!.status); attempt++) await new Promise((resolve) => setTimeout(resolve, 10)) }

  await t.test('install rejects unknown appTools; a stored package drops them', () => {
    assert.throws(() => registry.parsePluginManifest({ ...manifest, appTools: ['no_such_tool'] }), /appTools/)
    assert.deepEqual(registry.parsePluginManifest({ ...manifest, appTools: ['no_such_tool', 'search_images'] }, true).appTools, ['search_images'])
    assert.throws(() => registry.parsePluginManifest({ ...manifest, appRoutes: ['admin.everything'] }), /appRoutes/)
    assert.deepEqual(registry.parsePluginManifest({ ...manifest, appRoutes: ['admin.everything', 'images.read'] }, true).appRoutes, ['images.read'])
    assert.throws(() => registry.parsePluginManifest({ ...manifest, appRoutes: ['media.pick'] }), /appRoutes/, 'the picker comes with its capability')
  })

  const memberWindow = host.openPluginInstance('lend-probe', 'main', [], member)
  const memberBound = () => app.pluginInstanceAppContext(memberWindow.id, member, base)
  const search = { tool: 'search_images', arguments: { limit: 1 } }

  await t.test('without a share the window runs with the viewer’s own keys', async () => {
    assert.throws(() => host.openPluginInstance('lend-probe', 'main', [], viewer), /권한/)
    await assert.rejects(app.runPluginAppTool('lend-probe', search, memberBound().context), denied)
  })

  registry.setPluginPagePublic('lend-probe', 'main', true)
  const viewerWindow = host.openPluginInstance('lend-probe', 'main', [viewerFile.id], viewer)
  const bound = () => app.pluginInstanceAppContext(viewerWindow.id, viewer, base)

  await t.test('declared tools run for a viewer without their keys, in an already open window too', async () => {
    const result = await app.runPluginAppTool('lend-probe', search, bound().context)
    assert.equal(result.status, 'completed')
    assert.equal((result as { result: { isError?: boolean } }).result.isError, undefined)
    assert.equal((await app.runPluginAppTool('lend-probe', search, memberBound().context)).status, 'completed', 'lending follows the page being shared now')
    assert.equal((await app.runPluginAppTool('lend-probe', { tool: 'list_files', arguments: {} }, bound().context)).status, 'completed')
  })

  await t.test('undeclared tools, role checks and deleting stay with the viewer', async () => {
    await assert.rejects(app.runPluginAppTool('lend-probe', { tool: 'get_image_metadata', arguments: { composite_hash: 'a'.repeat(64) } }, bound().context), denied)
    await assert.rejects(app.runPluginAppTool('lend-probe', { tool: 'set_live_wallpaper', arguments: {}, requestId: 'scope-wallpaper' }, bound().context), denied)
    await assert.rejects(app.runPluginAppTool('lend-probe', { tool: 'delete_files', arguments: { file_ids: [viewerFile.id] }, requestId: 'scope-delete' }, bound().context), /files\.delete|권한|Permission/)
  })

  await t.test('a server action’s tool is lent through that action only', async () => {
    assert.equal((await app.runPluginServerAction({ pluginId: 'lend-probe', action: 'lend-probe.groups', arguments: {} }, bound().context)).status, 'completed')
    await assert.rejects(app.runPluginAppTool('lend-probe', { tool: 'list_image_groups', arguments: {} }, bound().context), denied)
  })

  await t.test('the window’s marker lends for its own plugin only', async () => {
    await assert.rejects(app.runPluginAppTool('text-editor', search, bound().context), denied)
  })

  await t.test('listing offers declared tools and hides the rest', async () => {
    assert.equal((await app.listPluginAppTools('lend-probe', bound().context, { tool: 'search_images' })).tools.length, 1)
    assert.deepEqual((await app.listPluginAppTools('lend-probe', bound().context, { tool: 'get_image_metadata' })).tools, [])
  })

  await t.test('server-module calls from the window borrow the same scope', async () => {
    const scope = { pluginId: 'lend-probe', pageId: 'main' }
    const result = await bridge.callTrustedAppTool(viewer.requester, 'search_images', { limit: 1 }, base, undefined, undefined, scope) as { isError?: boolean }
    assert.notEqual(result.isError, true)
    await assert.rejects(bridge.callTrustedAppTool(viewer.requester, 'search_images', { limit: 1 }, base), denied)
    await assert.rejects(bridge.callTrustedAppTool(viewer.requester, 'search_images', { limit: 1 }, base, undefined, undefined, { pluginId: 'text-editor', pageId: 'editor' }), denied)
  })

  await t.test('declared native routes are lent to requests from the window only', async () => {
    const express = (await import('express')).default
    const { pluginRouteLending } = await import('../src/middleware/pluginRouteLending')
    const { allowAnonymousPermission, requirePermission } = await import('../src/middleware/authMiddleware')
    const { getRequester } = await import('../src/routes/requester-session-helpers')
    const { requesterPermissionKeys } = await import('../src/middleware/featureAccess')
    const web = express()
    // Stands in for the login session: the test picks whose session a request carries.
    web.use((req, _res, next) => {
      const who = req.get('x-test-session') === 'member' ? member : viewer
      ;(req as unknown as { session: object }).session = { authenticated: true, accountId: who.requester.accountId }
      ;(req as unknown as { sessionID: string }).sessionID = who.sessionId
      next()
    })
    web.use('/api', pluginRouteLending)
    web.get('/api/images/:hash/thumbnail', allowAnonymousPermission('images.view'), (req, res) => { res.json({ query: req.query }) })
    web.get('/api/workflows', requirePermission('workflows.view'), (req, res) => { res.json({ requester: requesterPermissionKeys(getRequester(req)).includes('workflows.view') }) })
    web.get('/api/generation-history', requirePermission('images.view'), (_req, res) => { res.json({}) })
    web.get('/api/images', allowAnonymousPermission('images.view'), (_req, res) => { res.json({}) })
    const listener = web.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => listener.once('listening', resolve))
    try {
      const origin = `http://127.0.0.1:${(listener.address() as import('node:net').AddressInfo).port}`
      const get = (route: string, headers: Record<string, string> = {}) => fetch(`${origin}${route}`, { headers })
      const windowHeader = { 'X-CoNAI-Plugin-Instance': viewerWindow.id }
      const media = await get(`/api/images/${'a'.repeat(48)}/thumbnail?size=2&conaiPluginInstance=${viewerWindow.id}`)
      assert.equal(media.status, 200, 'media address naming the window')
      assert.deepEqual((await media.json()).query, { size: '2' }, 'the window parameter is removed before the route')
      assert.equal((await get(`/api/images/${'a'.repeat(48)}/thumbnail`, windowHeader)).status, 200)
      assert.notEqual((await get(`/api/images/${'a'.repeat(48)}/thumbnail`)).status, 200, 'no window: the viewer’s own keys')
      const workflows = await get('/api/workflows', windowHeader)
      assert.equal(workflows.status, 200)
      assert.equal((await workflows.json()).requester, true, 'services the route calls see the lent keys')
      assert.equal((await get('/api/generation-history', windowHeader)).status, 403, 'undeclared route')
      assert.equal((await get('/api/images', windowHeader)).status, 200, 'media.pick lends the host picker’s library listing')
      assert.notEqual((await get('/api/images')).status, 200)
      assert.equal((await get('/api/workflows', { ...windowHeader, 'x-test-session': 'member' })).status, 403, 'another session cannot borrow this window')
      registry.setPluginPagePublic('lend-probe', 'main', false)
      assert.equal((await get('/api/workflows', windowHeader)).status, 403, 'unshared: nothing lent')
      registry.setPluginPagePublic('lend-probe', 'main', true)
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()))
    }
  })

  await t.test('declared host features are lent: file reads and reviewed saves', () => {
    const read = host.readPluginFile(viewerWindow.id, viewerFile.id, viewer)
    assert.equal(read.text, 'hello')
    const proposal = host.proposePluginWrite(viewerWindow.id, { fileId: viewerFile.id, revision: read.revision, text: 'changed' }, viewer)
    const approval = host.approvePluginWrite(proposal.id, viewer)
    if (approval.applied) throw new Error('Expected a fresh approval')
    host.applyPluginWrite(proposal.id, approval.approval, viewer)
    assert.equal(FileStoreService.readEditableText(`account:${viewerId}`, viewerFile.id).text, 'changed')
  })

  await t.test('a lent write runs as a job and is rechecked when it executes', async () => {
    const started = await app.runPluginAppTool('lend-probe', { tool: 'create_file_folder', arguments: { name: 'lent-folder' }, requestId: 'scope-folder-direct' }, bound().context)
    assert.ok('jobId' in started && started.jobId)
    await settle(started.jobId!)
    assert.equal(app.getPluginAppRequest(started.id, bound().context).status, 'completed')
    const stored = JSON.parse((pluginDb().prepare('SELECT context FROM plugin_app_requests WHERE id = ?').get(started.id) as { context: string }).context)
    assert.deepEqual(stored.pluginPublicScope, { pluginId: 'lend-probe', pageId: 'main' }, 'only the plain marker is stored')
    const review = app.pluginInstanceAppContext(viewerWindow.id, viewer, base, true)
    const pending = await app.runPluginAppTool('lend-probe', { tool: 'create_file_folder', arguments: { name: 'lent-later' }, requestId: 'scope-folder-review' }, review.context)
    assert.ok('id' in pending && pending.status === 'pending')
    registry.setPluginPagePublic('lend-probe', 'main', false)
    assert.throws(() => app.applyPluginAppRequest(pending.id, member), /찾을 수 없어/)
    assert.throws(() => app.applyPluginAppRequest(pending.id, viewer), denied, 'unsharing before execution revokes the lent write')
    registry.setPluginPagePublic('lend-probe', 'main', true)
  })

  await t.test('stopping the share revokes lending in open windows', async () => {
    registry.setPluginPagePublic('lend-probe', 'main', false)
    await assert.rejects(app.runPluginAppTool('lend-probe', search, memberBound().context), denied)
    assert.throws(() => host.readPluginFile(viewerWindow.id, viewerFile.id, viewer), /권한/)
    registry.setPluginPagePublic('lend-probe', 'main', true)
  })

  await t.test('a share made under other declarations lends nothing until shared again', async () => {
    pluginDb().prepare("UPDATE plugin_public_pages SET scope = 'stale' WHERE plugin_id = 'lend-probe'").run()
    assert.deepEqual(registry.listPlugins().find((plugin) => plugin.manifest.id === 'lend-probe')?.publicLendStale, ['main'])
    await assert.rejects(app.runPluginAppTool('lend-probe', search, bound().context), denied)
    registry.setPluginPagePublic('lend-probe', 'main', true)
    assert.equal(registry.listPlugins().find((plugin) => plugin.manifest.id === 'lend-probe')?.publicLendStale, undefined)
    assert.equal((await app.runPluginAppTool('lend-probe', search, bound().context)).status, 'completed')
  })

  await t.test('queued library inputs carry a share-bound grant', async () => {
    const generationProbe = new AdmZip()
    generationProbe.addFile('plugin.json', Buffer.from(JSON.stringify({ ...manifest, id: 'lend-submit', appTools: ['submit_generation_job'], serverActions: [], pages: [{ ...manifest.pages[0], serverActions: [] }] })))
    generationProbe.addFile('index.html', Buffer.from('<!doctype html><title>probe</title>'))
    await registry.installPlugin(generationProbe.toBuffer()); await registry.setPluginEnabled('lend-submit', true)
    const scope = { pluginId: 'lend-submit', pageId: 'main' }
    const promptData = { image: { composite_hash: 'b'.repeat(64) } }
    const grant = grants.createPluginPublicQueueImageGrant(scope, viewerId, 7, promptData)
    assert.throws(() => grants.requireMcpQueueImageGrant(grant, 7, promptData, viewerId), /images\.view/, 'not shared: refused')
    registry.setPluginPagePublic('lend-submit', 'main', true)
    assert.doesNotThrow(() => grants.requireMcpQueueImageGrant(grant, 7, promptData, viewerId))
    assert.throws(() => grants.requireMcpQueueImageGrant(grant, 7, promptData, memberId), /Invalid/, 'bound to the submitting account')
    assert.throws(() => grants.requireMcpQueueImageGrant(grant, 7, { image: { composite_hash: 'c'.repeat(64) } }, viewerId), /Invalid/, 'bound to the input')
    assert.throws(() => grants.requireMcpQueueImageGrant({ ...grant, pageId: 'other' }, 7, promptData, viewerId), /Invalid/)
    registry.setPluginPagePublic('lend-submit', 'main', false)
    assert.throws(() => grants.requireMcpQueueImageGrant(grant, 7, promptData, viewerId), /images\.view/, 'unsharing revokes queued grants')
  })

  await t.test('bundled packages declare exactly the native tools they call', () => {
    for (const id of ['video-canvas', 'hyperframes']) {
      const folder = path.resolve(__dirname, '../../plugins', id)
      const declared = registry.parsePluginManifest(JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'))).appTools ?? []
      const called = new Set<string>()
      for (const name of fs.readdirSync(folder).filter((entry) => /\.(m?js)$/.test(entry))) {
        for (const match of fs.readFileSync(path.join(folder, name), 'utf8').matchAll(/(?:native|call|tool|tools\.call)\(\s*'([a-z_]+)'/g)) {
          if (pluginAppToolScope(match[1])) called.add(match[1])
        }
      }
      assert.deepEqual([...declared].sort(), [...called].sort(), id)
    }
  })

  await t.test('the route table matches exact shapes only', async () => {
    const { matchPluginAppRoutes } = await import('../src/services/plugins/pluginAppRoutes')
    for (const route of ['/api/images/count', '/api/images/random', '/api/images/semantic-search', '/api/images/untagged-count', '/api/generation-history/recent', '/api/generation-history/statistics', '/api/workflow-input-assets/../x']) {
      assert.deepEqual(matchPluginAppRoutes('GET', route), [], route)
    }
    assert.deepEqual(matchPluginAppRoutes('GET', `/api/images/${'a'.repeat(48)}/thumbnail`), ['images.read', 'media.pick'])
    assert.deepEqual(matchPluginAppRoutes('DELETE', `/api/images/${'a'.repeat(48)}`), [])
    assert.deepEqual(matchPluginAppRoutes('POST', '/api/generation-queue', { value: { service_type: 'comfyui' } }), ['generation-queue'])
    for (const service_type of ['novelai', 'codex', undefined]) assert.deepEqual(matchPluginAppRoutes('POST', '/api/generation-queue', { value: { service_type } }), [], String(service_type))
  })

  await t.test('bundled packages declare the native routes they call', async () => {
    const { matchPluginAppRoutes } = await import('../src/services/plugins/pluginAppRoutes')
    const methods = ['GET', 'POST', 'DELETE']
    for (const id of ['video-canvas', 'hyperframes', 'moss-bbox-studio']) {
      const folder = path.resolve(__dirname, '../../plugins', id)
      const declared = new Set(registry.parsePluginManifest(JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'))).appRoutes ?? [])
      for (const name of fs.readdirSync(folder).filter((entry) => /\.(m?js)$/.test(entry) && entry !== 'conai-plugin.js')) {
        for (const match of fs.readFileSync(path.join(folder, name), 'utf8').matchAll(/['"`](\/api\/[^'"`?]*)/g)) {
          // A real-shaped value for each ${…}: numeric ids where the table wants digits, otherwise a media hash.
          const candidates = ['1', 'a'.repeat(48), 'b'.repeat(32)].map((sample) => match[1].replace(/\$\{[^}]*\}/g, sample))
          assert.ok(candidates.some((route) => methods.some((method) => matchPluginAppRoutes(method, route).some((routeId) => declared.has(routeId)))), `${id}/${name}: ${match[1]}`)
        }
      }
    }
  })
})
