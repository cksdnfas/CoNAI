import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import AdmZip from 'adm-zip'

test('trusted extensions preserve package, caller, explicit approval and external-origin boundaries', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-plugin-test-'))
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
  const authAccess = await import('../src/services/authAccessControlService')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const host = await import('../src/services/plugins/pluginHost')
  const { pluginDb } = await import('../src/services/plugins/pluginStore')
  const shared = await import('@conai/shared')
  await t.test('every package in plugins/ passes the install manifest check', () => {
    const folder = path.resolve(__dirname, '../../plugins')
    const manifests = fs.readdirSync(folder).map((name) => path.join(folder, name, 'plugin.json')).filter((file) => fs.existsSync(file))
    assert.ok(manifests.length >= 3)
    // A manifest the install check refuses never reaches an instance: the bundled sync only logs it at startup.
    for (const file of manifests) assert.doesNotThrow(() => registry.parsePluginManifest(JSON.parse(fs.readFileSync(file, 'utf8'))), path.basename(path.dirname(file)))
    const manifest = (description: string) => ({ apiVersion: 1, id: 'limit-probe', name: 'Limit probe', version: '1.0.0', description: '', pages: [{ id: 'main', title: 'Main', entry: 'index.html', accepts: [], actions: [{ id: 'limit-probe.run', label: 'Run', description, effect: 'draft', tier: 'view', schema: { type: 'object', properties: {} } }] }] })
    assert.doesNotThrow(() => registry.parsePluginManifest(manifest('x'.repeat(registry.PLUGIN_ACTION_DESCRIPTION_LIMIT))))
    assert.throws(() => registry.parsePluginManifest(manifest('x'.repeat(registry.PLUGIN_ACTION_DESCRIPTION_LIMIT + 1))))
  })
  await t.test('native API paths reach all app routes without crossing origins or forging identity', () => {
    const origins = ['http://localhost:1677', 'http://localhost:1666']
    assert.equal(shared.pluginNativeApiPath('http://localhost:1666/api/files?limit=20', origins), '/api/files?limit=20')
    assert.equal(shared.pluginNativeApiPath('/api/codex-chat/admin/profiles/1', origins), '/api/codex-chat/admin/profiles/1')
    for (const value of ['/api/auth/status', '/api/settings/llm', '/api/codex-chat/admin/external-mcp', '/api/plugins/x/enabled', '/api/future-feature/run']) assert.equal(shared.pluginNativeApiPath(value, origins), value)
    assert.equal(shared.pluginNativeApiHeaders({ 'Last-Event-ID': 'cursor', 'X-CoNAI-Plugin-Host': '1' }).get('last-event-id'), 'cursor')
    for (const name of ['Authorization', 'Cookie', 'Host', 'Origin', 'X-Forwarded-For', 'X-CoNAI-Plugin-Call']) assert.throws(() => shared.pluginNativeApiHeaders({ [name]: 'forged' }))
    for (const value of ['https://outside.invalid/api/files', '//outside.invalid/api/files', '/uploads/a', '/api/files/../auth', '/api/files/%2e%2e/auth', '/api/files/%252e%252e/auth', '/api/files/..%2fauth']) {
      assert.throws(() => shared.pluginNativeApiPath(value, origins), value)
    }
  })
  t.after(async () => {
    auth.close(); user.closeUserSettingsDb(); main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-plugin-test-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const addAccount = (name: string) => Number(auth.prepare("INSERT INTO auth_accounts(username, password_hash, account_type) VALUES (?, 'unused', 'guest')").run(name).lastInsertRowid)
  const aliceId = addAccount('plugin-alice'), bobId = addAccount('plugin-bob')
  auth.prepare("INSERT INTO auth_accounts(username, password_hash, account_type) VALUES ('plugin-admin', 'unused', 'admin')").run()
  const group = AuthPermissionGroup.createCustomGroup({ name: 'plugin-file-editors', permissionKeys: ['files.view', 'files.edit', 'images.view', 'plugins.view'] })
  AuthPermissionGroup.addAccountMembership(group.id, aliceId)
  AuthPermissionGroup.addAccountMembership(group.id, bobId)
  invalidateConfiguredAuthCache()
  const alice = { requester: { accountId: aliceId, accountType: 'guest' as const }, sessionId: 'alice-session' }
  const bob = { requester: { accountId: bobId, accountType: 'guest' as const }, sessionId: 'bob-session' }
  const file = FileStoreService.writeText(`account:${aliceId}`, null, 'resource.json', '{"frame":1}', { create: true })
  const foreign = FileStoreService.writeText(`account:${bobId}`, null, 'private.json', '{"private":true}', { create: true })
  const zip = new AdmZip()
  zip.addLocalFolder(path.resolve(__dirname, '../../plugins/text-editor'))
  zip.addLocalFile(path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js'))
  const manifest = JSON.parse(zip.readAsText('plugin.json'))
  manifest.pages[0].actions.push(
    { id: 'text-editor.direct', label: 'Direct save', description: '', effect: 'save', tier: 'direct', schema: { type: 'object', properties: { path: { type: 'string' }, url: { type: 'string' }, code: { type: 'string' } }, required: ['path', 'url', 'code'] } },
    { id: 'text-editor.commit', label: 'Reviewed save', description: '', effect: 'save', tier: 'commit', schema: { type: 'object', properties: {} } },
  )
  zip.updateFile('plugin.json', Buffer.from(JSON.stringify(manifest)))
  const bytes = zip.toBuffer()

  await t.test('installed packages begin disabled and reject unsafe contracts and paths', async () => {
    const installed = (await registry.installPlugin(bytes)).plugin
    assert.equal(installed.enabled, false)
    assert.throws(() => host.openPluginInstance('text-editor', 'editor', [file.id], alice))
    await assert.rejects(registry.installPlugin(bytes), /같은 패키지/)
    await assert.rejects(registry.installPlugin(Buffer.from('invalid zip')), /ZIP/)
    const oversized = new AdmZip(bytes)
    oversized.addFile('oversized.js', Buffer.alloc(4 * 1024 * 1024 + 1))
    assert.throws(() => registry.unpackPlugin(oversized.toBuffer()), /크기/)
    for (const bad of ['../x.js', '/x.js', 'a\\x.js', 'C:/x.js', 'nul.js', 'a//x.js']) assert.throws(() => registry.pluginAssetName(bad))
    const forged = structuredClone(installed.manifest)
    forged.pages[0].actions[0].effect = 'save'
    assert.throws(() => registry.parsePluginManifest(forged))
    assert.equal(installed.manifest.pages[0].icon, 'file-text', 'a stored manifest keeps its page icon')
    assert.throws(() => registry.parsePluginManifest({ ...installed.manifest, pages: [{ ...installed.manifest.pages[0], icon: 'skull' }] }), 'pages name an icon from the host set only')
    assert.equal(registry.parsePluginManifest({ ...installed.manifest, pages: [{ ...installed.manifest.pages[0], opensImages: true }] }).pages[0].opensImages, true, 'a page may offer itself in the image detail view')
    const conditionalImages = { prompt: '^\\s*\\{[\\s\\S]*"items"\\s*:' }
    assert.deepEqual(registry.parsePluginManifest({ ...installed.manifest, pages: [{ ...installed.manifest.pages[0], opensImages: conditionalImages }] }).pages[0].opensImages, conditionalImages, 'a page may promote its action when the positive prompt matches')
    assert.throws(() => registry.parsePluginManifest({ ...installed.manifest, pages: [{ ...installed.manifest.pages[0], opensImages: { prompt: '[' } }] }), /Invalid prompt regular expression/)
    assert.throws(() => registry.parsePluginManifest({ ...installed.manifest, pages: [{ ...installed.manifest.pages[0], opensImages: 'yes' }] }), 'opensImages is a boolean or a prompt pattern')
    assert.throws(() => shared.chatPageActionTier('unknown.write'), /등록된/)
    await registry.setPluginEnabled('text-editor', true)
  })
  let instance = host.openPluginInstance('text-editor', 'editor', [file.id], alice)
  await t.test('connection leases stay session-bound and expired leases cannot be revived', () => {
    const caller = { ...alice, sessionId: 'lease-test' }
    for (let index = 0; index < 16; index++) {
      const opened = host.openPluginInstance('text-editor', 'editor', [file.id], caller)
      host.closePluginInstance(opened.id, caller)
    }
    const slots = Array.from({ length: 16 }, () => host.openPluginInstance('text-editor', 'editor', [file.id], caller))
    const soon = Date.now() + 1000
    pluginDb().prepare('UPDATE plugin_instances SET expires_at = ? WHERE id = ?').run(soon, slots[0].id)
    assert.ok(host.renewPluginInstance(slots[0].id, caller).expiresAt > soon)
    assert.throws(() => host.renewPluginInstance(slots[0].id, alice))
    pluginDb().prepare('UPDATE plugin_instances SET expires_at = ? WHERE id = ?').run(Date.now() - 1, slots[1].id)
    assert.throws(() => host.renewPluginInstance(slots[1].id, caller), /만료/)
    // Admission ignores expired rows even between periodic garbage collections.
    const replacement = host.openPluginInstance('text-editor', 'editor', [file.id], caller)
    for (const slot of [...slots, replacement]) host.closePluginInstance(slot.id, caller)
  })
  await t.test('instances are account/session bound while file access follows native permissions', () => {
    // Selected files are opening context; the app's shared file access remains available.
    const sharedSelection = host.openPluginInstance('text-editor', 'editor', [foreign.id], alice)
    assert.equal(host.readPluginFile(sharedSelection.id, foreign.id, alice).text, '{"private":true}')
    host.closePluginInstance(sharedSelection.id, alice)
    assert.throws(() => host.readPluginFile(instance.id, file.id, bob))
    assert.throws(() => host.readPluginFile(instance.id, file.id, { ...alice, sessionId: 'other-tab-session' }))
    assert.equal(host.readPluginFile(instance.id, foreign.id, alice).text, '{"private":true}')
    assert.equal(host.readPluginFile(instance.id, file.id, alice).text, '{"frame":1}')
    const pageOnly = { requester: { accountId: addAccount('plugin-no-files'), accountType: 'guest' as const }, sessionId: 'page-only-session' }
    AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: 'plugin-page-only', permissionKeys: ['plugins.view'] }).id, pageOnly.requester.accountId)
    const empty = host.openPluginInstance('text-editor', 'editor', [], pageOnly)
    assert.equal(host.requirePluginInstance(empty.id, pageOnly).page.id, 'editor', 'opening a plugin needs no unrelated file permission')
    assert.throws(() => host.readPluginFile(empty.id, file.id, pageOnly), /권한/)
    assert.throws(() => host.openPluginInstance('text-editor', 'editor', [file.id], pageOnly), /권한/)
    host.closePluginInstance(empty.id, pageOnly)
  })
  await t.test('a shared page opens without the plugin permission and closes when the share ends', () => {
    const { invalidateResolvedAuthAccessCache } = authAccess
    const guestGrant = () => auth.prepare(`SELECT g.id AS group_id, p.id AS permission_id FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = 'guest' AND p.permission_key = 'plugins.view'`).get() as { group_id: number; permission_id: number }
    const { group_id, permission_id } = guestGrant()
    auth.prepare('DELETE FROM auth_group_permissions WHERE group_id = ? AND permission_id = ?').run(group_id, permission_id)
    invalidateResolvedAuthAccessCache()
    try {
      const viewer = { requester: { accountId: addAccount('plugin-shared-viewer'), accountType: 'guest' as const }, sessionId: 'shared-viewer-session' }
      assert.throws(() => host.openPluginInstance('text-editor', 'editor', [], viewer), /권한/, 'no plugin permission, no share: refused')
      assert.equal(shared.chatPagePermission('/public/ext/text-editor/editor'), '', 'the shared address needs no page permission')
      assert.equal(shared.chatPagePermission('/ext/text-editor/editor'), 'page.extensions.view')
      assert.throws(() => registry.requirePluginPage({ path: '/public/ext/text-editor/editor' }), /공개/)
      assert.throws(() => registry.setPluginPagePublic('text-editor', 'missing-page', true), /페이지/)
      registry.setPluginPagePublic('text-editor', 'editor', true)
      assert.equal(registry.isPublicPluginPage('text-editor', 'editor'), true)
      assert.deepEqual(registry.listPlugins().find((plugin) => plugin.manifest.id === 'text-editor')?.publicPages, ['editor'])
      assert.deepEqual(registry.listPublicPluginPages().map((page) => `${page.pluginId}/${page.pageId}`), ['text-editor/editor'])
      assert.equal(registry.requirePluginPage({ path: '/public/ext/text-editor/editor' }).id, 'editor')
      const opened = host.openPluginInstance('text-editor', 'editor', [], viewer)
      assert.equal(host.renewPluginInstance(opened.id, viewer).expiresAt > Date.now(), true)
      registry.setPluginPagePublic('text-editor', 'editor', false)
      assert.throws(() => host.renewPluginInstance(opened.id, viewer), /권한/, 'ending the share ends the open window')
      assert.equal(registry.listPlugins().find((plugin) => plugin.manifest.id === 'text-editor')?.publicPages, undefined)
      host.closePluginInstance(opened.id, viewer)
    } finally {
      auth.prepare('INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed) VALUES (?, ?, 1)').run(group_id, permission_id)
      invalidateResolvedAuthAccessCache()
    }
  })
  await t.test('only host approval applies the immutable proposal; retries do not write twice', () => {
    const before = host.readPluginFile(instance.id, file.id, alice)
    const proposal = host.proposePluginWrite(instance.id, { fileId: file.id, revision: before.revision, text: '{"frame":2}' }, alice)
    assert.equal(FileStoreService.readEditableText(`account:${aliceId}`, file.id).text, before.text, 'proposing never writes')
    assert.throws(() => host.applyPluginWrite(proposal.id, '0'.repeat(48), alice), /승인/)
    assert.throws(() => host.approvePluginWrite(proposal.id, bob))
    const approval = host.approvePluginWrite(proposal.id, alice)
    assert.equal(approval.applied, false)
    if (approval.applied) throw new Error('Expected fresh approval')
    const result = host.applyPluginWrite(proposal.id, approval.approval, alice)
    const saved = FileStoreService.readEditableText(`account:${aliceId}`, file.id)
    assert.equal(saved.text, '{"frame":2}')
    assert.deepEqual(host.applyPluginWrite(proposal.id, approval.approval, alice), result)
    assert.equal(FileStoreService.readEditableText(`account:${aliceId}`, file.id).revision, saved.revision)
    const next = host.proposePluginWrite(instance.id, { fileId: file.id, revision: saved.revision, text: 'another' }, alice)
    assert.throws(() => host.applyPluginWrite(next.id, approval.approval, alice), /승인/)
  })
  await t.test('web plugin settings are account/session scoped with CAS and bounded storage', async () => {
    const { pluginStorage } = await import('../src/services/plugins/pluginStorage')
    const other = host.openPluginInstance('text-editor', 'editor', [], bob)
    try {
      const first = pluginStorage(instance.id, alice, 'set', { key: 'preferences', value: { zoom: 2 } })
      assert.equal(pluginStorage(other.id, bob, 'get', { key: 'preferences' }).value, null)
      assert.throws(() => pluginStorage(instance.id, bob, 'get', { key: 'preferences' }))
      assert.throws(() => pluginStorage(instance.id, alice, 'set', { key: 'preferences', value: 3 }), /바뀌었어/)
      const next = pluginStorage(instance.id, alice, 'set', { key: 'preferences', revision: first.revision, value: { zoom: 3 } })
      assert.deepEqual(pluginStorage(instance.id, alice, 'get', { key: 'preferences' }).value, { zoom: 3 })
      assert.throws(() => pluginStorage(instance.id, alice, 'set', { key: 'large', value: 'x'.repeat(70_000) }), /64KB/)
      pluginStorage(instance.id, alice, 'delete', { key: 'preferences', revision: next.revision })
      assert.equal(pluginStorage(instance.id, alice, 'get', { key: 'preferences' }).revision, null)
    } finally { host.closePluginInstance(other.id, bob) }
  })
  await t.test('stale writes and disabled instances cannot consume approvals', async () => {
    const original = host.readPluginFile(instance.id, file.id, alice)
    const proposal = host.proposePluginWrite(instance.id, { fileId: file.id, revision: original.revision, text: 'stale' }, alice)
    const approved = host.approvePluginWrite(proposal.id, alice)
    if (approved.applied) throw new Error('Expected approval')
    FileStoreService.updateText(`account:${aliceId}`, file.id, 'newer', { expectedRevision: original.revision })
    assert.throws(() => host.applyPluginWrite(proposal.id, approved.approval, alice))
    assert.equal(FileStoreService.readEditableText(`account:${aliceId}`, file.id).text, 'newer')
    await registry.setPluginEnabled('text-editor', false)
    assert.throws(() => host.readPluginFile(instance.id, file.id, alice))
    await registry.setPluginEnabled('text-editor', true)
    assert.throws(() => host.readPluginFile(instance.id, file.id, alice), /만료/)
    instance = host.openPluginInstance('text-editor', 'editor', [file.id], alice)
  })
  await t.test('page definitions must match the installed manifest, not iframe declarations', () => {
    const page = shared.normalizeChatPageSnapshot({ instanceId: randomUUID(), connectionId: randomUUID(), path: '/ext/text-editor/editor', title: 'Text', kind: 'extension', resourceId: '1.0.0', fields: [], actions: instance.page.actions, revision: randomUUID(), data: {} })
    registry.validatePluginPageSnapshot(page)
    assert.throws(() => registry.validatePluginPageSnapshot({ ...page, actions: page.actions!.map((action, index) => index === 0 ? { ...action, tier: action.tier === 'draft' ? 'view' as const : 'draft' as const } : action) }))
    assert.throws(() => registry.requirePluginPageAction(page, 'text-editor.unregistered', {}))
    assert.throws(() => shared.normalizeChatPageSnapshot({ ...page, fields: [{ id: 'text', label: 'Text', type: 'text', value: 'x' }] }))
    assert.throws(() => shared.normalizeChatPageSnapshot({ ...page, data: { api_key: 'secret' } }))
  })
  await t.test('MCP dispatch keeps registered extension tiers and blocks leaving a dirty editor', async () => {
    const { McpServer } = await import('@modelcontextprotocol/server')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const { registerChatPageActionTools } = await import('../src/mcp/tools/chatPageActionTools')
    const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
    const { resolveChatPageCommand } = await import('../src/services/codex-chat/chatPageBridge')
    const adminId = (auth.prepare("SELECT id FROM auth_accounts WHERE username='plugin-admin'").get() as {id:number}).id
    const pageGroup = AuthPermissionGroup.createCustomGroup({ name: 'plugin-page-assistant', permissionKeys: ['files.view', 'files.edit', 'plugins.view'] })
    AuthPermissionGroup.addAccountMembership(pageGroup.id, adminId)
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const page = shared.normalizeChatPageSnapshot({ instanceId: randomUUID(), connectionId: randomUUID(), path: '/ext/text-editor/editor', title: 'Text', kind: 'extension', resourceId: '1.0.0', fields: [], actions: instance.page.actions, revision: randomUUID(), dirty: true, data: {} })
    const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
    const { isDirectChatTool } = await import('../src/mcp/toolCatalog')
    const discoveryContext = { source: 'llm-chat' as const, scopes: [], requester, chatContext: { threadId: 1, profileId: 1, kind: 'direct' as const, page } }
    assert.equal(isContextToolAllowed(discoveryContext, 'list_plugin_pages', false), true, 'explicit extension connection supplies discovery even without general read scopes')
    assert.equal(isDirectChatTool(discoveryContext, 'list_plugin_pages'), true)
    const server = new McpServer({ name: 'plugin-page-test', version: '1' })
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const replyContext = { threadId: 1, profileId: 1, kind: 'direct' as const, replyId: randomUUID(), page }
    // Page commands are routed only from a reply that is still running.
    const releaseReply = registerChatReply(replyContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    registerChatPageActionTools(server, { source: 'llm-chat', scopes: ['read'], requester, chatContext: replyContext })
    const client = new Client({ name: 'plugin-page-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    let dispatched = 0
    const unsubscribe = subscribeToRuntimeEvents(event => {
      if (event.name !== 'chat.page.command') return
      const payload = event.payload as { commandId: string; actionId: string; tier: string; revision?: string }
      if (payload.actionId === 'text-editor.direct') {
        assert.equal(payload.tier, 'direct')
        assert.equal(payload.revision, page.revision)
      } else {
        assert.equal(payload.actionId, 'text-editor.replace')
        assert.equal(payload.tier, 'draft')
      }
      dispatched++
      resolveChatPageCommand(requester, payload.commandId, { ok: true, page })
    })
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const changed = await client.callTool({ name: 'page_act', arguments: { action: 'text-editor.replace', arguments: { before: 'old', after: 'new' } } })
      assert.notEqual(changed.isError, true, JSON.stringify(changed))
      assert.equal(dispatched, 1)
      const leave = await client.callTool({ name: 'page_act', arguments: { action: 'text-editor.select', arguments: { id: file.id } } })
      assert.equal(leave.isError, true)
      assert.match(JSON.stringify(leave), /저장하지 않은 변경/)
      assert.equal(dispatched, 1, 'dirty editor cannot dispatch a view action that loses its draft')
      const direct = await client.callTool({ name: 'page_act', arguments: { action: 'text-editor.direct', arguments: { path: 'project/main.js', url: 'https://example.invalid/reference', code: 'export const answer = 42' } } })
      assert.notEqual(direct.isError, true, JSON.stringify(direct))
      assert.equal(dispatched, 2, 'an installed direct action dispatches with its current revision')
      const commit = await client.callTool({ name: 'page_act', arguments: { action: 'text-editor.commit' } })
      assert.equal(commit.isError, true)
      assert.match(JSON.stringify(commit), /propose_page_action/)
      assert.equal(dispatched, 2, 'a commit action still needs its review card')
    } finally { unsubscribe(); releaseReply(); await client.close(); await server.close() }
  })
  await t.test('extension result deltas preserve changed, removed and newly opened document state', async () => {
    const { pageOperationView } = await import('../src/mcp/tools/chatPageView')
    const adminId = (auth.prepare("SELECT id FROM auth_accounts WHERE username='plugin-admin'").get() as { id: number }).id
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const before = shared.normalizeChatPageSnapshot({ instanceId: randomUUID(), connectionId: randomUUID(), path: '/ext/text-editor/editor', title: 'Text', kind: 'extension', resourceId: '1.0.0', fields: [], actions: instance.page.actions, revision: randomUUID(), dirty: true, data: { selected: { excerpt: 'x'.repeat(8000) }, note: 'keep' } })
    const next = { ...before, revision: randomUUID() }
    const unchanged = pageOperationView(requester, before, next, null).page as { data: unknown; unchangedData: string[]; removedData?: string[] }
    assert.deepEqual(unchanged.data, {})
    assert.deepEqual(unchanged.unchangedData, ['selected', 'note'])
    const oldShape = { ...unchanged, data: before.data, unchangedData: undefined }
    t.diagnostic(`Unchanged 8000-character extension excerpt: result before=${Buffer.byteLength(JSON.stringify(oldShape))} bytes; delta=${Buffer.byteLength(JSON.stringify(unchanged))} bytes.`)
    const changed = pageOperationView(requester, before, { ...next, data: { selected: { excerpt: 'new' } } }, null).page as { data: unknown; removedData: string[] }
    assert.deepEqual(changed.data, { selected: { excerpt: 'new' } })
    assert.deepEqual(changed.removedData, ['note'])
    const reopened = pageOperationView(requester, before, { ...next, instanceId: randomUUID() }, null).page as { data: unknown }
    assert.deepEqual(reopened.data, before.data, 'a different screen must send its document even when the excerpt matches')
  })
  await t.test('project extensions share CAS, retry and media-reference boundaries with agents', async () => {
    const { PluginFolder } = await import('../src/services/plugins/pluginFolder')
    const projectHost = await import('../src/services/plugins/pluginWorkspace')
    const packageZip = new AdmZip()
    // Exercise the host contract without depending on a personal plugin's implementation.
    packageZip.addFile('plugin.json', Buffer.from(JSON.stringify({
      apiVersion: 1, id: 'workspace-test', name: 'Workspace host test', version: '1.0.0',
      description: 'Project access, revision and media permission regression fixture',
      capabilities: ['workspace.read', 'workspace.write', 'workspace.media', 'media.process'],
      pages: [{ id: 'review', title: 'Workspace', entry: 'index.html', accepts: [], actions: [] }],
    })))
    packageZip.addFile('index.html', Buffer.from('<!doctype html><title>Workspace host test</title>'))
    await registry.installPlugin(packageZip.toBuffer()); await registry.setPluginEnabled('workspace-test', true)
    const owner = `account:${aliceId}`
    const sessions: string[] = []
    try {
      const unbound = host.openPluginInstance('text-editor', 'editor', [], alice); sessions.push(unbound.id)
      assert.equal(unbound.workspace, undefined, 'plugins without a workspace capability get no folder')
      assert.throws(() => projectHost.listPluginWorkspace(unbound.id, {}, alice), /프로젝트를 연결/)
      const connected = host.openPluginInstance('workspace-test', 'review', [], alice); sessions.push(connected.id)
      const folder = FileStoreService.get(owner, connected.workspace!.id)
      assert.equal(folder.name, 'Workspace host test')
      assert.equal(FileStoreService.get(owner, folder.parentId!).name, '플러그인', 'the plugin works in the file box under 플러그인/<name>')
      assert.equal(host.openPluginInstance('workspace-test', 'review', [], alice).workspace?.id, folder.id, 'reopening reuses the folder')
      const readonly = host.openPluginInstance('workspace-test', 'review', [], alice); sessions.push(readonly.id)
      pluginDb().prepare('UPDATE plugin_instances SET workspace=? WHERE id=?').run(JSON.stringify({ ...readonly.workspace, write: false }), readonly.id)
      await assert.rejects(projectHost.proposePluginWorkspaceWrite(readonly.id, { target: '검수.json', revision: null, text: '{}' }, alice), /읽기 전용/)
      const seed = (name: string, target: string, text: string, expectedRevision: string | null = null) => PluginFolder.apply(owner, folder.id, name, [{ kind: 'write', target, text, expectedRevision }])
      const from = FileStoreService.createFolder(owner, folder.id, 'from')
      const into = FileStoreService.createFolder(owner, folder.id, 'into')
      const original = FileStoreService.writeText(owner, from.id, 'old.md', 'original')
      FileStoreService.writeText(owner, from.id, 'new.md', 'keep here')
      FileStoreService.writeText(owner, into.id, 'old.md', 'keep there')
      const move = (name: string) => PluginFolder.apply(owner, folder.id, 'relocate', [{
        kind: 'move', target: 'from/old.md', destination: `into/${name}`, expectedRevision: original.revision!,
      }])
      assert.equal(move('old.md').status, 'failed')
      assert.equal(FileStoreService.get(owner, original.id).parentId, from.id)
      assert.equal(move('new.md').status, 'completed', 'only the final path has to be free')
      assert.equal(FileStoreService.findChild(owner, into.id, 'new.md')?.id, original.id)
      const mediaProcessing = await import('../src/services/plugins/pluginMediaProcessing')
      await assert.rejects(mediaProcessing.proposePluginMedia(connected.id, { sourceTarget: 'media.json', target: 'audio.json', revision: null, operation: { kind: 'extract_audio', quality: 5 } }, alice), /권한|permission|Permission/)
      await assert.rejects(projectHost.proposePluginWorkspaceChanges(readonly.id, { operations: [{ kind: 'mkdir', target: 'denied' }] }, alice), /읽기 전용/)
      const batch = await projectHost.proposePluginWorkspaceChanges(connected.id, { operations: [{ kind: 'mkdir', target: 'batch' }, { kind: 'write', target: 'batch/note.json', text: '{}', expectedRevision: null }] }, alice)
      await assert.rejects(projectHost.applyPluginWorkspaceWrite(batch.id, '0'.repeat(48), alice), /승인/)
      const batchApproval = await projectHost.approvePluginWorkspaceWrite(batch.id, alice)
      const batchResult = await projectHost.applyPluginWorkspaceWrite(batch.id, batchApproval.approval!, alice)
      assert.equal(batchResult.status, 'completed')
      assert.deepEqual(await projectHost.applyPluginWorkspaceWrite(batch.id, batchApproval.approval!, alice), batchResult)
      const folderInfo = await projectHost.statPluginWorkspace(connected.id, { target: 'batch' }, alice)
      assert.ok('revision' in folderInfo && folderInfo.revision, 'a single stat answers with the folder revision')
      const docInfo = (await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: 'batch/note.json' }] }, alice)).files[0]
      const moving = await projectHost.proposePluginWorkspaceChanges(connected.id, { operations: [{ kind: 'move', target: 'batch', destination: 'moved', expectedRevision: folderInfo.revision }, { kind: 'write', target: 'moved/note.json', text: '{"moved":true}', expectedRevision: docInfo.revision }] }, alice)
      const movingApproval = await projectHost.approvePluginWorkspaceWrite(moving.id, alice)
      assert.equal((await projectHost.applyPluginWorkspaceWrite(moving.id, movingApproval.approval!, alice)).status, 'completed')
      assert.equal((await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: 'moved/note.json' }] }, alice)).files[0].text, '{"moved":true}')
      assert.throws(() => projectHost.listPluginWorkspace(connected.id, {}, bob))
      await assert.rejects(projectHost.readPluginWorkspace(connected.id, { targets: [{ target: '../secret.json' }] }, alice), /경로/)
      const proposal = await projectHost.proposePluginWorkspaceWrite(connected.id, { target: '검수.json', revision: null, text: '{"note":"accepted","takes":{}}' }, alice)
      assert.equal(PluginFolder.entries(owner, folder.id).entries.some(entry => entry.target === '검수.json'), false)
      await assert.rejects(projectHost.applyPluginWorkspaceWrite(proposal.id, '0'.repeat(48), alice), /승인/)
      const approved = await projectHost.approvePluginWorkspaceWrite(proposal.id, alice)
      assert.equal(approved.applied, false)
      assert.throws(() => host.applyPluginWrite(proposal.id, approved.approval!, alice))
      const concurrent = await Promise.allSettled([projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice), projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice)])
      assert.ok(concurrent.some(result => result.status === 'fulfilled'))
      const applied = await projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice)
      assert.equal(applied.status, 'completed')
      assert.equal(FileStoreService.resolvePath(owner, folder.id, '검수.json')?.name, '검수.json', 'the saved document is a normal file-box file')
      const saved = (await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: '검수.json' }] }, alice)).files[0]
      assert.equal(saved.text, proposal.text)
      const stale = await projectHost.proposePluginWorkspaceWrite(connected.id, { target: saved.target, revision: saved.revision, text: '{"note":"stale"}' }, alice)
      seed('agent-concurrent-edit', saved.target, '{"note":"agent edit"}', saved.revision)
      await assert.rejects(projectHost.approvePluginWorkspaceWrite(stale.id, alice), /변경/)
      const ref = seed('create-media-ref', 'media.json', JSON.stringify({ source: 'files', fileId: file.id }))
      seed('invalid-media-ref', 'invalid.json', '{')
      await assert.rejects(projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'invalid.json' }, alice), error => error instanceof Error && 'status' in error && error.status === 400)
      const grant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'media.json' }, alice)
      assert.equal((await projectHost.resolvePluginWorkspaceMedia(grant.token)).entry.id, file.id)
      seed('replace-media-ref', 'media.json', JSON.stringify({ source: 'files', fileId: foreign.id }), ref.results[0].revision!)
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(grant.token), /변경/)
      const freshGrant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'media.json' }, alice)
      const libraryFile = path.join(root, 'uploads', 'review.png')
      fs.mkdirSync(path.dirname(libraryFile), { recursive: true })
      await (await import('sharp')).default({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toFile(libraryFile)
      const libraryHash = 'cd'.repeat(24)
      main.db.prepare('INSERT OR IGNORE INTO watched_folders(folder_path,folder_name) VALUES(?,?)').run(path.dirname(libraryFile), 'review-library')
      const folderId = (main.db.prepare('SELECT id FROM watched_folders WHERE folder_path=?').get(path.dirname(libraryFile)) as { id: number }).id
      const groupId = Number(main.db.prepare('INSERT INTO groups(name) VALUES(?)').run('review-library').lastInsertRowid)
      main.db.prepare("INSERT INTO media_metadata(composite_hash,postprocess_status,rating_score) VALUES(?,'ready',1)").run(libraryHash)
      main.db.prepare("INSERT INTO image_files(composite_hash,original_file_path,folder_id,file_size,mime_type,file_status) VALUES(?,?,?,?,'image/png','active')").run(libraryHash, libraryFile, folderId, fs.statSync(libraryFile).size)
      main.db.prepare('INSERT INTO image_groups(group_id,composite_hash) VALUES(?,?)').run(groupId, libraryHash)
      seed('library-media-ref', 'library.json', JSON.stringify({ source: 'library', groupId, compositeHash: libraryHash }))
      const libraryGrant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'library.json' }, alice)
      seed('stable-library-ref', 'stable-library.json', JSON.stringify({ source: 'library', compositeHash: libraryHash }))
      const stableGrant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'stable-library.json' }, alice)
      assert.equal((await projectHost.resolvePluginWorkspaceMedia(libraryGrant.token)).filePath, libraryFile)
      const { McpArtifactService } = await import('../src/services/mcpArtifactService')
      const artifactMedia = await import('../src/services/plugins/pluginArtifactMedia')
      const artifact = await McpArtifactService.createMediaDescriptor(libraryHash, 'http://localhost:1666', alice.requester)
      assert.ok(artifact)
      const preview = artifactMedia.issuePluginArtifactMedia(connected.id, { artifactId: artifact.artifact_id }, alice)
      assert.equal(artifactMedia.resolvePluginArtifactMedia(preview.token).absolutePath, libraryFile)
      assert.throws(() => artifactMedia.issuePluginArtifactMedia(connected.id, { artifactId: artifact.artifact_id }, bob))
      main.db.prepare("UPDATE media_metadata SET postprocess_status='pending' WHERE composite_hash=?").run(libraryHash)
      assert.throws(() => artifactMedia.resolvePluginArtifactMedia(preview.token), /없거나/)
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(libraryGrant.token), /사용할 수 없는/)
      main.db.prepare("UPDATE media_metadata SET postprocess_status='ready' WHERE composite_hash=?").run(libraryHash)
      const { RatingScoreModel } = await import('../src/models/RatingScore')
      const tier = RatingScoreModel.getAllTiers().find(item => item.min_score <= 1 && (item.max_score === null || item.max_score > 1))!
      try {
        RatingScoreModel.updateTier(tier.id, { feed_visibility: 'hide' })
        await assert.rejects(projectHost.resolvePluginWorkspaceMedia(libraryGrant.token), /숨긴 미디어/)
      } finally { RatingScoreModel.updateTier(tier.id, { feed_visibility: tier.feed_visibility }) }
      main.db.prepare('DELETE FROM image_groups WHERE group_id=? AND composite_hash=?').run(groupId, libraryHash)
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(libraryGrant.token), /그룹/)
      assert.equal((await projectHost.resolvePluginWorkspaceMedia(stableGrant.token)).filePath, libraryFile, 'ID-only references survive group organization')
      AuthPermissionGroup.removeAccountMembership(group.id, aliceId)
      assert.throws(() => artifactMedia.resolvePluginArtifactMedia(preview.token))
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(freshGrant.token))
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(stableGrant.token), 'ID-only references still recheck account permissions')
      AuthPermissionGroup.addAccountMembership(group.id, aliceId)
      await registry.setPluginEnabled('workspace-test', false)
      await assert.rejects(projectHost.resolvePluginWorkspaceMedia(freshGrant.token))
    } finally {
      AuthPermissionGroup.addAccountMembership(group.id, aliceId)
      for (const id of sessions) host.closePluginInstance(id, alice)
      await registry.removePlugin('workspace-test')
    }
  })
  await t.test('generic job routes hide plugin replies and orphaned reply files are removed', async () => {
    const express = (await import('express')).default
    const { runtimeJobRoutes: jobs } = await import('../src/routes/runtime-jobs.routes')
    const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
    const { runtimePaths } = await import('../src/config/runtimePaths')
    const large = { text: 'PRIVATE_LLM_REPLY'.repeat(10000) }
    const created = [large, { text: 'PRIVATE_INLINE_REPLY' }].map(result => {
      const job = RuntimeJobStore.create({ kind: 'plugin-llm', requestedByAccountId: aliceId })
      RuntimeJobStore.markRunning(job.jobId, 'all'); RuntimeJobStore.markCompleted(job.jobId, result)
      return job
    })
    fs.unlinkSync(path.join(runtimePaths.artifactsDir, 'runtime-job-results', `${created[0].jobId}.json`))
    const app = express()
    app.use((req, _res, next) => { Object.assign(req, { session: { authenticated: true, accountId: aliceId, accountType: 'guest' } }); next() })
    app.use('/api/jobs', jobs)
    const server = http.createServer(app)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      for (const job of created) {
        const response = await fetch(`${origin}/api/jobs/${job.jobId}`)
        assert.equal(response.status, 200, 'generic route must not open the missing private result file')
        const value = await response.json() as { data: { result: unknown } }
        assert.equal(value.data.result, null)
        const cancelled = await fetch(`${origin}/api/jobs/${job.jobId}/cancel`, { method: 'POST' })
        assert.equal(cancelled.status, 409)
        assert.equal(((await cancelled.json()) as { data: { result: unknown } }).data.result, null)
      }
      const list = await (await fetch(`${origin}/api/jobs?kind=plugin-llm`)).text()
      assert.doesNotMatch(list, /PRIVATE_LLM_REPLY|PRIVATE_INLINE_REPLY|runtime_job_result_file/)
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }

    const cancelled = RuntimeJobStore.create({ kind: 'plugin-llm', requestedByAccountId: aliceId })
    RuntimeJobStore.markRunning(cancelled.jobId, 'all')
    RuntimeJobStore.markCompleted(cancelled.jobId, { toJSON() {
      RuntimeJobStore.markCancelled(cancelled.jobId, 'cancelled during serialization')
      return large
    } })
    assert.equal(RuntimeJobStore.get(cancelled.jobId)!.status, 'cancelled')
    assert.equal(fs.existsSync(path.join(runtimePaths.artifactsDir, 'runtime-job-results', `${cancelled.jobId}.json`)), false)
    const failed = RuntimeJobStore.create({ kind: 'plugin-llm', requestedByAccountId: aliceId })
    const db = user.getUserSettingsDb()
    db.exec(`CREATE TEMP TRIGGER fail_llm_completion BEFORE UPDATE ON runtime_jobs WHEN NEW.job_id='${failed.jobId}' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'completion blocked'); END`)
    try {
      assert.throws(() => RuntimeJobStore.markCompleted(failed.jobId, large), /completion blocked/)
      assert.equal(fs.existsSync(path.join(runtimePaths.artifactsDir, 'runtime-job-results', `${failed.jobId}.json`)), false)
    } finally { db.exec('DROP TRIGGER fail_llm_completion') }
  })
  await t.test('native app actions share permissions, immutable approvals and headless MCP execution', async sub => {
    const app = await import('../src/services/plugins/pluginAppActions')
    const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
    const adminId = (auth.prepare("SELECT id FROM auth_accounts WHERE username='plugin-admin'").get() as { id: number }).id
    const admin = { requester: { accountId: adminId, accountType: 'admin' as const }, sessionId: 'app-host-session' }
    const appPermissions = AuthPermissionGroup.createCustomGroup({ name: 'plugin-native-tools', permissionKeys: ['files.view', 'images.view', 'images.edit', 'posts.view', 'posts.write', 'workflows.view', 'audio.view'] })
    AuthPermissionGroup.addAccountMembership(appPermissions.id, adminId)
    const context = app.pluginBrowserContext(admin, 'http://localhost:1666', true)
    const largeJob = RuntimeJobStore.create({ kind: 'plugin-action', params: {}, singletonKey: null, requestedByAccountId: adminId })
    const largeResult = { content: [{ type: 'text', text: 'large plugin result '.repeat(6000) }] }
    RuntimeJobStore.markRunning(largeJob.jobId, 'all'); RuntimeJobStore.markCompleted(largeJob.jobId, largeResult)
    assert.equal((RuntimeJobStore.get(largeJob.jobId)!.result as { runtime_job_result_file: number }).runtime_job_result_file, 1)
    assert.deepEqual(RuntimeJobStore.get(largeJob.jobId, { includeResultFile: true })!.result, largeResult)
    const packageZip = new AdmZip()
    packageZip.addLocalFolder(path.resolve(__dirname, '../../plugins/app-workbench'), '', entry => !/\.md$/i.test(entry))
    packageZip.addLocalFile(path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js'))
    const parsed = (await registry.installPlugin(packageZip.toBuffer())).plugin; await registry.setPluginEnabled('app-workbench', true)
    sub.after(async () => { if (registry.listPlugins(true).some(plugin => plugin.manifest.id === 'app-workbench')) await registry.removePlugin('app-workbench') })
    assert.equal(parsed.manifest.pages[0].actions.length, 5,'server actions supply browser schemas automatically')
    assert.equal(parsed.manifest.pages[0].actions.find(action => action.id === 'app-workbench.create_group')?.tier, 'commit')
    const directActions = registry.parsePluginManifest({ ...parsed.manifest, serverActions: parsed.manifest.serverActions!.map(action => ({ ...action, tier: undefined })) })
    assert.equal(directActions.pages[0].actions.find(action => action.id === 'app-workbench.create_group')?.tier, 'direct')
    assert.doesNotThrow(() => registry.parsePluginManifest({ ...parsed.manifest, appTools: undefined, capabilities: undefined }), 'native actions need no duplicate permission declarations')
    assert.doesNotThrow(() => registry.parsePluginManifest({ ...parsed.manifest, appTools: ['read_file_text'] }))
    // A retired native handler drops its action, while legacy declaration metadata stays readable.
    const { pluginDb } = await import('../src/services/plugins/pluginStore')
    const stored = pluginDb().prepare("SELECT manifest,digest FROM plugins WHERE id='app-workbench'").get() as { manifest: string; digest: string }
    const retired = JSON.parse(stored.manifest) as typeof parsed.manifest
    retired.appTools = [...retired.appTools!, 'retired_native_tool']
    retired.serverActions = [...retired.serverActions!, { id: 'app-workbench.retired', label: 'retired', description: '', schema: { type: 'object', properties: {} }, tool: 'retired_native_tool' }]
    pluginDb().prepare("UPDATE plugins SET manifest=?, digest='retired-tool-test' WHERE id='app-workbench'").run(JSON.stringify(retired))
    assert.equal(registry.getPlugin('app-workbench').definition.appTools!.includes('retired_native_tool'), true)
    assert.equal(registry.getPlugin('app-workbench').definition.serverActions!.some(action => action.id === 'app-workbench.retired'), false)
    assert.ok(registry.listPlugins(false).some(plugin => plugin.manifest.id === 'app-workbench'))
    pluginDb().prepare("UPDATE plugins SET manifest=?, digest=? WHERE id='app-workbench'").run(stored.manifest, stored.digest)
    const tools = await app.listPluginAppTools('app-workbench', context, { tool: 'create_image_group' })
    assert.equal(tools.tools[0].requiresApproval, true)
    const read = await app.runPluginServerAction({ pluginId: 'app-workbench', action: 'app-workbench.groups', arguments: {} }, context)
    assert.equal(read.status, 'completed')
    await assert.rejects(app.runPluginAppTool('app-workbench', { tool: 'delete_files', arguments: {}, requestId: 'account-write-denied' }, app.pluginBrowserContext(alice)), /권한|permission|Permission/)
    assert.deepEqual((await app.listPluginAppTools('app-workbench', context, { tool: 'propose_profile_update' })).tools, [], 'chat-only handlers must not be advertised as usable app APIs')
    const directContext = app.pluginBrowserContext(admin, 'http://localhost:1666')
    assert.equal((await app.listPluginAppTools('app-workbench', directContext, { tool: 'create_image_group' })).tools[0].requiresApproval, false)
    const direct = await app.runPluginAppTool('app-workbench', { tool: 'create_image_group', arguments: { name: 'direct-plugin-group' }, requestId: 'direct-app-request' }, directContext)
    assert.ok('id' in direct && direct.jobId && direct.status !== 'pending', 'browser actions start without a server module or an extra approval')
    for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(RuntimeJobStore.get(direct.jobId!)!.status); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.getPluginAppRequest(direct.id, directContext).status, 'completed')
    await assert.rejects(app.runPluginServerAction({ pluginId: 'app-workbench', action: 'app-workbench.create_group', arguments: { name: 'denied' }, requestId: 'guest-write-denied' }, app.pluginBrowserContext(alice)), /권한|permission|Permission/)
    const input = { pluginId: 'app-workbench', action: 'app-workbench.create_group', arguments: { name: 'plugin-app-test-group' }, requestId: 'stable-app-request' }
    const pending = await app.runPluginServerAction(input, context)
    assert.ok('id' in pending)
    assert.equal(pending.status, 'pending')
    assert.deepEqual(await app.runPluginServerAction(input, context), pending)
    await assert.rejects(app.runPluginServerAction({ ...input, arguments: { name: 'different' } }, context), /같은 요청 ID/)
    assert.throws(() => app.getPluginAppRequest(pending.id, app.pluginBrowserContext(bob)), /찾을 수 없어/)
    const started = app.applyPluginAppRequest(pending.id, admin)
    assert.ok(started.jobId)
    assert.equal(app.applyPluginAppRequest(pending.id, admin).jobId, started.jobId)
    for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(RuntimeJobStore.get(started.jobId!)!.status); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.getPluginAppRequest(pending.id, context).status, 'completed')
    const { mcpHttpSettingsService } = await import('../src/services/mcpHttpSettingsService')
    const wasEnabled = mcpHttpSettingsService.loadSettings().enabled
    const key = mcpHttpSettingsService.createApiKey('plugin-approval-boundary', appPermissions.group_key).keys.at(-1)!
    mcpHttpSettingsService.updateEnabled(true)
    try {
      const keyContext = mcpHttpSettingsService.authenticate(key.apiKey)!
      const keyed = await app.runPluginServerAction({ ...input, requestId: 'key-group-revocation' }, keyContext)
      assert.ok('id' in keyed)
      const restricted = AuthPermissionGroup.createCustomGroup({ name: 'plugin-read-only-key', permissionKeys: ['files.view', 'images.view'] })
      mcpHttpSettingsService.updateApiKey(key.id, key.name, restricted.group_key)
      assert.throws(() => app.applyPluginAppRequest(keyed.id, admin), /권한|permission|Permission/, 'admin approval must not replace the original key permission group')
      mcpHttpSettingsService.updateApiKey(key.id, key.name, appPermissions.group_key)
      mcpHttpSettingsService.revokeApiKey(key.id)
      assert.throws(() => app.applyPluginAppRequest(keyed.id, admin), /회수/)
    } finally {
      if (mcpHttpSettingsService.loadSettings().keys.some(item => item.id === key.id)) mcpHttpSettingsService.revokeApiKey(key.id)
      mcpHttpSettingsService.updateEnabled(wasEnabled)
    }
    const { McpServer } = await import('@modelcontextprotocol/server')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const { registerPluginTools } = await import('../src/mcp/tools/pluginTools')
    const server = new McpServer({ name: 'plugin-headless-test', version: '1' }), client = new Client({ name: 'plugin-headless-test', version: '1' })
    registerPluginTools(server, context)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({ name: 'run_plugin_action', arguments: { pluginId: 'app-workbench', action: 'app-workbench.groups', arguments: { query: 'plugin-app-test-group' } } })
      assert.notEqual(result.isError, true)
      assert.match(JSON.stringify(result), /plugin-app-test-group/)
      assert.ok(!(await client.listTools()).tools.some(tool => /apply|approve/.test(tool.name)), 'MCP cannot approve its own mutation')
    } finally { await client.close(); await server.close() }
    const draft = await app.runPluginServerAction({ pluginId: 'app-workbench', action: 'app-workbench.write_note', arguments: { title: 'title', body: 'body' }, requestId: 'immutable-draft-post' }, context)
    assert.ok('id' in draft)
    assert.equal(draft.arguments.status, 'draft')
    await registry.setPluginEnabled('app-workbench', false)
    assert.throws(() => app.applyPluginAppRequest(draft.id, admin), /비활성화/)
    assert.equal(app.cancelPluginAppRequest(draft.id, context).status, 'cancelled')
    await registry.removePlugin('app-workbench')
  })
  await t.test('plugin actions run in a chat whose profile delegates files.view, without its delegated project', async sub => {
    const packageZip = new AdmZip()
    packageZip.addLocalFolder(path.resolve(__dirname, '../../plugins/app-workbench'), '', entry => !/\.md$/i.test(entry))
    packageZip.addLocalFile(path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js'))
    await registry.installPlugin(packageZip.toBuffer()); await registry.setPluginEnabled('app-workbench', true)
    sub.after(async () => { if (registry.listPlugins(true).some(plugin => plugin.manifest.id === 'app-workbench')) await registry.removePlugin('app-workbench') })
    const { loadChatSettings, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const chatWasEnabled = loadChatSettings().enabled
    updateChatSettings({ enabled: true })
    sub.after(() => { updateChatSettings({ enabled: chatWasEnabled }) })
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { chatProfileRequester } = await import('../src/services/codex-chat/chatProfilePermissions')
    const { chatWorkspaces } = await import('../src/services/codex-chat/chatWorkspace')
    const { WorkspaceService } = await import('../src/services/workspaceService')
    const { fileOwnerKey } = await import('../src/services/fileStoreService')
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const adminId = (auth.prepare("SELECT id FROM auth_accounts WHERE username='plugin-admin'").get() as { id: number }).id
    const guestId = addAccount('plugin-delegated-chat')
    AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: 'plugin-delegated-chat', permissionKeys: ['chat.use', 'images.view', 'images.edit'] }).id, guestId)
    const requester = { accountId: guestId, accountType: 'guest' as const }
    const project = await WorkspaceService.create(fileOwnerKey(adminId), 'Delegated plugin project')
    ExternalApiProvider.create({ provider_name: 'plugin-delegated-chat', display_name: 'Delegated chat test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: {} })
    const profile = ChatProfileStore.create({ name: 'Delegated plugin chat', engine: 'llm', modelSlotId: ModelSlotStore.ensure('plugin-delegated-chat', 'test-model')!, mcpEnabled: true, mcpScopes: ['read', 'organize'],
      toolAllowlist: ['run_plugin_action', 'get_plugin_action', 'cancel_plugin_action'], delegatedPermissions: ['files.view'], workspaces: [{ id: project.id, write: false }] })
    const chat = { threadId: CodexChatStore.createThread(guestId, 'delegated plugin chat', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: randomUUID() }
    assert.equal(chatWorkspaces(chatProfileRequester(requester, chat), chat.threadId, profile.id).length, 1, 'the chat itself reaches the project through the delegation')
    const stop = registerChatReply(chat, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const server = createMcpServer({ scopes: ['read', 'organize'], source: 'llm-chat', requester, chatContext: chat, toolCatalog: false })
    const client = new Client({ name: 'plugin-delegated-chat', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`)
      return JSON.parse((result.content as Array<{ text: string }>)[0].text)
    }
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      assert.equal((await call('run_plugin_action', { pluginId: 'app-workbench', action: 'app-workbench.groups', arguments: {} })).status, 'completed')
      const pending = await call('run_plugin_action', { pluginId: 'app-workbench', action: 'app-workbench.create_group', arguments: { name: 'delegated-chat-group' }, requestId: 'delegated-chat-request' })
      assert.equal(pending.status, 'pending')
      assert.equal(pending.project, undefined, 'the plugin acts as the account, which cannot open the delegated project')
      assert.equal((await call('get_plugin_action', { requestId: pending.id })).status, 'pending')
      assert.equal((await call('cancel_plugin_action', { requestId: pending.id })).status, 'cancelled')
    } finally { stop(); await client.close(); await server.close() }
  })
  await t.test('live permission revocation invalidates approved writes and media grants', () => {
    const { pluginDb } = require('../src/services/plugins/pluginStore') as typeof import('../src/services/plugins/pluginStore')
    const manifest = registry.getPlugin('text-editor').definition
    manifest.capabilities.push('files.media')
    pluginDb().prepare('UPDATE plugins SET manifest = ? WHERE id = ?').run(JSON.stringify(manifest), manifest.id)
    const media = host.issuePluginMedia(instance.id, file.id, alice)
    assert.ok(media.expiresAt <= Date.now() + 60_000)
    assert.equal(host.resolvePluginMedia(media.token).entry.id, file.id)
    const original = host.readPluginFile(instance.id, file.id, alice)
    const proposal = host.proposePluginWrite(instance.id, { fileId: file.id, revision: original.revision, text: 'denied' }, alice)
    const approval = host.approvePluginWrite(proposal.id, alice)
    if (approval.applied) throw new Error('Expected approval')
    AuthPermissionGroup.removeAccountMembership(group.id, aliceId)
    assert.throws(() => host.applyPluginWrite(proposal.id, approval.approval, alice))
    assert.throws(() => host.resolvePluginMedia(media.token))
    AuthPermissionGroup.addAccountMembership(group.id, aliceId)
    host.closePluginInstance(instance.id, alice)
    assert.throws(() => host.resolvePluginMedia(media.token))
    instance = host.openPluginInstance('text-editor', 'editor', [file.id], alice)
    assert.equal(host.readPluginFile(instance.id, file.id, alice).text, 'newer')
  })
  await t.test('installed assets are trusted documents while external origins cannot call the host', async () => {
    const express = (await import('express')).default
    const { configureAppMiddleware } = await import('../src/startup/configureAppMiddleware')
    const pluginRoutes = (await import('../src/routes/plugins.routes')).default
    const app = express()
    configureAppMiddleware(app)
    app.use((req, _res, next) => { Object.assign(req, { sessionID: alice.sessionId, session: { authenticated: true, accountId: aliceId, accountType: 'guest' } }); next() })
    app.use('/api/plugins', pluginRoutes)
    app.use((error: Error, _req: unknown, res: import('express').Response, _next: unknown) => res.status(400).json({ error: error.message }))
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      for (const metadata of [{}, { 'Sec-Fetch-Site': 'cross-site' }] as Array<Record<string, string>>) {
        const asset = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/main.js`, { headers: { Origin: 'null', ...metadata } })
        assert.equal(asset.status, 200)
        assert.equal(asset.headers.get('access-control-allow-origin'), '*')
        assert.equal(asset.headers.get('access-control-allow-credentials'), null)
        assert.equal(asset.headers.get('cross-origin-resource-policy'), 'cross-origin')
        const hostResponse = await fetch(`${origin}/api/plugins/instances/${instance.id}`, { headers: { Origin: 'null', 'X-CoNAI-Plugin-Host': '1', ...metadata } })
        assert.ok(hostResponse.status >= 400)
      }
      const document = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/index.html`)
      assert.match(document.headers.get('content-security-policy')!, /frame-ancestors 'self'/)
      assert.equal((await fetch(`${origin}/api/plugins/instances/${instance.id}`)).status, 403)
      assert.equal((await fetch(`${origin}/api/plugins/instances/${instance.id}`, { headers: { 'X-CoNAI-Plugin-Host': '1' } })).status, 200)
      assert.equal((await fetch(`${origin}/api/plugins/instances/${instance.id}/renew`, { method: 'POST', headers: { 'X-CoNAI-Plugin-Host': '1', Origin: 'null' } })).status, 403)
      assert.equal((await fetch(`${origin}/api/plugins/instances/${instance.id}/renew`, { method: 'POST', headers: { 'X-CoNAI-Plugin-Host': '1' } })).status, 200)
      const missing = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/missing.js`)
      assert.equal(missing.status, 404)
      assert.equal(missing.headers.get('access-control-allow-origin'), '*')
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
  await t.test('a page preview serves its document and mapped files sandboxed, under the caller live permissions', async () => {
    const express = (await import('express')).default
    const { configureAppMiddleware } = await import('../src/startup/configureAppMiddleware')
    const pluginRoutes = (await import('../src/routes/plugins.routes')).default
    const previews = await import('../src/services/plugins/pluginPreview')
    const app = express()
    configureAppMiddleware(app)
    app.use((req, _res, next) => { Object.assign(req, { sessionID: alice.sessionId, session: { authenticated: true, accountId: aliceId, accountType: 'guest' } }); next() })
    app.use('/api/plugins', pluginRoutes)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const staged = path.join(root, 'preview-upload.png'), png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
    fs.writeFileSync(staged, png)
    const [picture] = FileStoreService.upload(`account:${aliceId}`, null, [{ originalname: 'pic.png', mimetype: 'image/png', size: png.length, path: staged } as Express.Multer.File])
    const page = host.openPluginInstance('text-editor', 'editor', [], alice)
    const call = (method: string, suffix: string, body: unknown) => fetch(`${origin}/api/plugins/instances/${page.id}/previews${suffix}`, { method, headers: { 'X-CoNAI-Plugin-Host': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    try {
      const files = { 'pic.png': { source: 'files', fileId: picture.id }, 'lib/main.js': { source: 'package', path: 'main.js' } }
      const created = await call('POST', '', { html: '<img src="pic.png"><script src="lib/main.js"></script>', files })
      assert.equal(created.status, 200)
      const { token } = (await created.json() as { data: { token: string } }).data
      const base = `${origin}/api/plugin-media/preview/${token}/`
      const document = await fetch(base)
      const policy = document.headers.get('content-security-policy')!
      assert.equal(document.status, 200)
      assert.match(document.headers.get('content-type')!, /^text\/html/)
      assert.equal(await document.text(), '<img src="pic.png"><script src="lib/main.js"></script>')
      assert.match(policy, /^sandbox allow-scripts;/)
      assert.ok(!policy.includes('allow-same-origin') && !policy.includes('frame-ancestors'))
      assert.ok(policy.includes(`script-src ${base} 'unsafe-inline';`) && policy.includes(`connect-src ${base};`))
      assert.equal(document.headers.get('x-frame-options'), null)
      assert.equal(document.headers.get('cache-control'), 'private, no-store')
      const image = await fetch(`${base}pic.png`, { headers: { Origin: 'null' } })
      assert.equal(image.status, 200)
      assert.equal(image.headers.get('content-type'), 'image/png')
      assert.equal(image.headers.get('access-control-allow-origin'), '*')
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)
      assert.equal((await fetch(`${base}pic.png`, { headers: { Range: 'bytes=0-3' } })).status, 206)
      const script = await fetch(`${base}lib/main.js`)
      assert.equal(script.status, 200)
      assert.match(script.headers.get('cache-control')!, /immutable/)
      for (const name of ['main.js', 'missing.png', '..%2fplugin.json', 'index.html%2f..%2f..']) assert.ok((await fetch(`${base}${name}`)).status >= 400, name)
      // Only image/video/audio media, only this package's files, only the window's own caller.
      assert.equal((await call('POST', '', { html: 'x', files: { 'a.json': { source: 'files', fileId: file.id } } })).status, 415)
      assert.ok((await call('POST', '', { html: 'x', files: { 'a.js': { source: 'package', path: '../plugin.json' } } })).status >= 400)
      assert.ok((await call('POST', '', { html: 'x', files: { '../a.js': { source: 'package', path: 'main.js' } } })).status >= 400)
      await assert.rejects(previews.issuePluginPreview(page.id, { html: 'x' }, bob))
      await assert.rejects(previews.issuePluginPreview(page.id, { html: 'x' }, alice, token.replace(/^./, token[0] === 'a' ? 'b' : 'a')), /만료/)
      // Redrawing keeps the address.
      const updated = await call('PUT', `/${token}`, { html: '<p>v2</p>', files })
      assert.equal((await updated.json() as { data: { token: string } }).data.token, token)
      assert.equal(await (await fetch(base)).text(), '<p>v2</p>')
      // Losing image access or closing the window ends the media and the document.
      AuthPermissionGroup.removeAccountMembership(group.id, aliceId)
      invalidateConfiguredAuthCache()
      assert.equal((await fetch(`${base}pic.png`)).status, 403)
      AuthPermissionGroup.addAccountMembership(group.id, aliceId)
      invalidateConfiguredAuthCache()
      assert.equal((await fetch(`${base}pic.png`)).status, 200)
      host.closePluginInstance(page.id, alice)
      assert.equal((await fetch(base)).status, 410)
    } finally { host.closePluginInstance(page.id, alice); await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
  await t.test('removing a package revokes its instances but preserves user files', async () => {
    await registry.removePlugin('text-editor')
    assert.throws(() => host.readPluginFile(instance.id, file.id, alice))
    assert.equal(FileStoreService.readEditableText(`account:${aliceId}`, file.id).text, 'newer')
  })
  await t.test('damaged packages can be removed and reinstalled without following junctions', async () => {
    await registry.installPlugin(bytes)
    const directory = path.join(registry.pluginPackagesRoot, 'text-editor', '1.0.0')
    fs.unlinkSync(path.join(directory, 'plugin.json'))
    await registry.removePlugin('text-editor')
    assert.equal(fs.existsSync(directory), false)
    await registry.installPlugin(bytes)
    assert.ok(directory.startsWith(path.resolve(root) + path.sep))
    fs.rmSync(directory, { recursive: true })
    await registry.removePlugin('text-editor')
    await registry.installPlugin(bytes)
    fs.rmSync(directory, { recursive: true })
    const outside = path.join(root, 'outside-package')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    fs.symlinkSync(outside, directory, 'junction')
    await assert.rejects(registry.removePlugin('text-editor'), /설치 경로/)
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep')
    fs.unlinkSync(directory)
    await registry.removePlugin('text-editor')
    assert.equal(registry.listPlugins(true).length, 0)
  })
  await t.test('official packages install off, update in place keeping their state, and cannot be removed or replaced', async () => {
    const { syncBundledPlugins } = await import('../src/services/plugins/pluginBundled')
    const folder = path.join(root, 'bundled')
    fs.mkdirSync(folder)
    const official = (version: string) => {
      const pack = new AdmZip()
      pack.addFile('plugin.json', Buffer.from(JSON.stringify({ apiVersion: 1, id: 'official-demo', name: 'Official demo', version, description: '', pages: [{ id: 'main', title: 'Main', entry: 'index.html', accepts: [], actions: [] }] })))
      pack.addFile('index.html', Buffer.from('<!doctype html><title>demo</title>'))
      fs.writeFileSync(path.join(folder, 'official-demo.zip'), pack.toBuffer())
    }
    const find = () => registry.listPlugins(true).find(item => item.manifest.id === 'official-demo')
    official('1.0.0')
    await syncBundledPlugins(folder)
    assert.deepEqual([find()?.enabled, find()?.bundled], [false, true], 'a first install is off and marked official')
    await registry.setPluginEnabled('official-demo', true)
    await syncBundledPlugins(folder)
    assert.equal(find()?.manifest.version, '1.0.0')
    official('1.1.0')
    await syncBundledPlugins(folder)
    assert.deepEqual([find()?.manifest.version, find()?.enabled], ['1.1.0', true], 'a new build replaces it and keeps it on')
    await assert.rejects(registry.removePlugin('official-demo'), /제거할 수 없어/)
    const user = new AdmZip(path.join(folder, 'official-demo.zip'))
    const edited = JSON.parse(user.readAsText('plugin.json')); edited.version = '9.0.0'
    user.updateFile('plugin.json', Buffer.from(JSON.stringify(edited)))
    await assert.rejects(registry.installPlugin(user.toBuffer()), /공식 플러그인/)
    assert.equal(find()?.manifest.version, '1.1.0')
    const { bundledPluginFailures, bundledUpdatedThisStart } = await import('../src/services/plugins/pluginBundled')
    assert.deepEqual([find()?.previousVersion, Boolean(find()?.updatedAt), bundledUpdatedThisStart('official-demo')], ['1.0.0', true, true], 'an applied update records when it happened and what it replaced')
    fs.writeFileSync(path.join(folder, 'official-demo.zip'), Buffer.from('not a package'))
    await syncBundledPlugins(folder)
    assert.deepEqual([bundledPluginFailures().map(failure => failure.file), find()?.manifest.version], [['official-demo.zip'], '1.1.0'], 'a build that does not apply is reported and the installed one stays')
    official('1.2.0')
    await syncBundledPlugins(folder)
    assert.deepEqual([bundledPluginFailures().length, find()?.manifest.version, find()?.previousVersion], [0, '1.2.0', '1.1.0'], 'a retry applies the fixed build and clears the failure')
  })
  await t.test('a package\'s skills follow it: out of use while it is off, read-only, gone with it', async () => {
    await import('../src/services/codex-chat/chatPluginSkills')
    const { ChatSkillStore } = await import('../src/services/codex-chat/chatSkills')
    const skilled = new AdmZip(bytes)
    skilled.updateFile('plugin.json', Buffer.from(JSON.stringify({ ...JSON.parse(skilled.readAsText('plugin.json')), version: '1.0.1', skills: ['skills/drawing'] })))
    skilled.addFile('skills/drawing/SKILL.md', Buffer.from('---\nname: drawing\ndescription: Use when drawing.\n---\nPick the section of the model.\n'))
    skilled.addFile('skills/drawing/references/nai.md', Buffer.from('---\ntitle: NAI\nsummary: NAI rules\n---\nTAGS'))
    const missing = new AdmZip(skilled.toBuffer())
    missing.deleteFile('skills/drawing/SKILL.md')
    assert.throws(() => registry.unpackPlugin(missing.toBuffer()), /SKILL\.md/)
    await registry.installPlugin(skilled.toBuffer())
    const [skill] = ChatSkillStore.list().filter((item) => item.pluginId === 'text-editor')
    assert.ok(skill && !skill.enabled && skill.sections[0]?.path === 'nai', 'an installed (off) plugin brings its skill, out of use')
    assert.deepEqual(ChatSkillStore.linked([skill.id]), [])
    await registry.setPluginEnabled('text-editor', true)
    assert.equal(ChatSkillStore.linked([skill.id]).length, 1)
    assert.throws(() => ChatSkillStore.update(skill.id, { description: 'x' }), /플러그인/)
    assert.throws(() => ChatSkillStore.delete(skill.id), /플러그인/)
    // An update whose skill folder no longer reads keeps the skill (its id, so profiles' links and presets' guides), off.
    const version = (zip: AdmZip, value: string) => zip.updateFile('plugin.json', Buffer.from(JSON.stringify({ ...JSON.parse(zip.readAsText('plugin.json')), version: value })))
    const broken = new AdmZip(skilled.toBuffer())
    version(broken, '1.0.2')
    broken.updateFile('skills/drawing/references/nai.md', Buffer.from(`---\ntitle: ${'T'.repeat(130)}\nsummary: NAI rules\n---\nTAGS`))
    await registry.installPlugin(broken.toBuffer())
    assert.equal(ChatSkillStore.find(skill.id)?.enabled, false, 'an unreadable skill folder turns its skill off instead of deleting it')
    const fixed = new AdmZip(skilled.toBuffer())
    version(fixed, '1.0.3')
    await registry.installPlugin(fixed.toBuffer())
    assert.equal(ChatSkillStore.find(skill.id)?.sections[0]?.title, 'NAI', 'the fixed package brings the same skill back')
    await registry.removePlugin('text-editor')
    assert.equal(ChatSkillStore.find(skill.id), null, 'removing the plugin removes its skills')
  })
})
