import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import AdmZip from 'adm-zip'

test('extensions enforce package, caller, approval and opaque-origin boundaries', { timeout: 60000 }, async (t) => {
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
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const host = await import('../src/services/plugins/pluginHost')
  const { pluginDb } = await import('../src/services/plugins/pluginStore')
  const shared = await import('@conai/shared')
  await t.test('native API paths cannot leave feature routes or reach credentials', () => {
    const origins = ['http://localhost:1677', 'http://localhost:1666']
    assert.equal(shared.pluginNativeApiPath('http://localhost:1666/api/files?limit=20', origins), '/api/files?limit=20')
    assert.equal(shared.pluginNativeApiPath('/api/codex-chat/admin/profiles/1', origins), '/api/codex-chat/admin/profiles/1')
    for (const value of ['https://outside.invalid/api/files', '//outside.invalid/api/files', '/api/auth/status', '/api/settings/llm', '/api/codex-chat/admin/external-mcp', '/api/plugins/x/enabled', '/api/files/../auth', '/api/files/%2e%2e/auth', '/api/files/%252e%252e/auth', '/api/files/..%2fauth']) {
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
  const group = AuthPermissionGroup.createCustomGroup({ name: 'plugin-file-editors', permissionKeys: ['files.view', 'files.edit', 'images.view'] })
  AuthPermissionGroup.addAccountMembership(group.id, aliceId)
  AuthPermissionGroup.addAccountMembership(group.id, bobId)
  invalidateConfiguredAuthCache()
  const alice = { requester: { accountId: aliceId, accountType: 'guest' }, sessionId: 'alice-session' }
  const bob = { requester: { accountId: bobId, accountType: 'guest' }, sessionId: 'bob-session' }
  const file = FileStoreService.writeText(`account:${aliceId}`, null, 'resource.json', '{"frame":1}', { create: true })
  const foreign = FileStoreService.writeText(`account:${bobId}`, null, 'private.json', '{"private":true}', { create: true })
  const zip = new AdmZip()
  zip.addLocalFolder(path.resolve(__dirname, '../../plugins/text-editor'))
  zip.addLocalFile(path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js'))
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
    assert.throws(() => shared.chatPageActionTier('unknown.write'), /등록된/)
    await registry.setPluginEnabled('text-editor', true)
  })
  let instance = host.openPluginInstance('text-editor', 'editor', [file.id], alice)
  await t.test('reload closes do not exhaust slots and expired leases cannot be revived', () => {
    const caller = { ...alice, sessionId: 'lease-test' }
    for (let index = 0; index < 16; index++) {
      const opened = host.openPluginInstance('text-editor', 'editor', [file.id], caller)
      host.closePluginInstance(opened.id, caller)
    }
    const slots = Array.from({ length: 12 }, () => host.openPluginInstance('text-editor', 'editor', [file.id], caller))
    assert.throws(() => host.openPluginInstance('text-editor', 'editor', [file.id], caller), /너무 많아/)
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
    const empty = host.openPluginInstance('text-editor', 'editor', [], pageOnly)
    assert.equal(host.requirePluginInstance(empty.id, pageOnly).page.id, 'editor', 'opening a plugin needs no unrelated file permission')
    assert.throws(() => host.readPluginFile(empty.id, file.id, pageOnly), /권한/)
    assert.throws(() => host.openPluginInstance('text-editor', 'editor', [file.id], pageOnly), /권한/)
    host.closePluginInstance(empty.id, pageOnly)
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
    const pageGroup = AuthPermissionGroup.createCustomGroup({ name: 'plugin-page-assistant', permissionKeys: ['files.view', 'files.edit'] })
    AuthPermissionGroup.addAccountMembership(pageGroup.id, adminId)
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const page = shared.normalizeChatPageSnapshot({ instanceId: randomUUID(), connectionId: randomUUID(), path: '/ext/text-editor/editor', title: 'Text', kind: 'extension', resourceId: '1.0.0', fields: [], actions: instance.page.actions, revision: randomUUID(), dirty: true, data: {} })
    const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
    const { isDirectChatTool } = await import('../src/mcp/toolCatalog')
    const discoveryContext = { source: 'llm-chat' as const, scopes: [], requester, chatContext: { threadId: 1, profileId: 1, kind: 'direct' as const, page } }
    assert.equal(isContextToolAllowed(discoveryContext, 'list_plugin_pages', false), true, 'explicit extension connection supplies discovery even without general read scopes')
    assert.equal(isDirectChatTool(discoveryContext, 'list_plugin_pages'), true)
    const server = new McpServer({ name: 'plugin-page-test', version: '1' })
    registerChatPageActionTools(server, { source: 'llm-chat', scopes: ['read'], requester, chatContext: { threadId: 1, profileId: 1, kind: 'direct', replyId: randomUUID(), page } })
    const client = new Client({ name: 'plugin-page-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    let dispatched = 0
    const unsubscribe = subscribeToRuntimeEvents(event => {
      if (event.name !== 'chat.page.command') return
      const payload = event.payload as { commandId: string; actionId: string; tier: string }
      assert.equal(payload.actionId, 'text-editor.replace')
      assert.equal(payload.tier, 'draft')
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
    } finally { unsubscribe(); await client.close(); await server.close() }
  })
  await t.test('extension result deltas preserve changed, removed and newly opened document state', async () => {
    const { pageOperationView } = await import('../src/mcp/tools/chatPageView')
    const adminId = (auth.prepare("SELECT id FROM auth_accounts WHERE username='plugin-admin'").get() as { id: number }).id
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const before = shared.normalizeChatPageSnapshot({ instanceId: randomUUID(), connectionId: randomUUID(), path: '/ext/text-editor/editor', title: 'Text', kind: 'extension', resourceId: '1.0.0', fields: [], actions: instance.page.actions, revision: randomUUID(), dirty: true, data: { selected: { excerpt: 'x'.repeat(8000) }, note: 'keep' } })
    const next = { ...before, revision: randomUUID() }
    const unchanged = pageOperationView(requester, before, next) as { data: unknown; unchangedData: string[]; removedData?: string[] }
    assert.deepEqual(unchanged.data, {})
    assert.deepEqual(unchanged.unchangedData, ['selected', 'note'])
    const oldShape = { ...unchanged, data: before.data, unchangedData: undefined }
    t.diagnostic(`Unchanged 8000-character extension excerpt: result before=${Buffer.byteLength(JSON.stringify(oldShape))} bytes; delta=${Buffer.byteLength(JSON.stringify(unchanged))} bytes.`)
    const changed = pageOperationView(requester, before, { ...next, data: { selected: { excerpt: 'new' } } }) as { data: unknown; removedData: string[] }
    assert.deepEqual(changed.data, { selected: { excerpt: 'new' } })
    assert.deepEqual(changed.removedData, ['note'])
    const reopened = pageOperationView(requester, before, { ...next, instanceId: randomUUID() }) as { data: unknown }
    assert.deepEqual(reopened.data, before.data, 'a different screen must send its document even when the excerpt matches')
  })
  await t.test('project extensions share CAS, retry and media-reference boundaries with agents', async () => {
    const { WorkspaceService } = await import('../src/services/workspaceService')
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
    const project = await WorkspaceService.create(owner, 'Review project')
    const sessions: string[] = []
    try {
      const legacy = host.openPluginInstance('text-editor', 'editor', [], alice, { id: project.id, write: true }); sessions.push(legacy.id)
      assert.equal(legacy.workspace?.id, project.id, 'project access does not require manifest grants')
      const unbound = host.openPluginInstance('workspace-test', 'review', [], alice); sessions.push(unbound.id)
      assert.throws(() => projectHost.listPluginWorkspace(unbound.id, {}, alice), /프로젝트를 연결/)
      const readonly = host.openPluginInstance('workspace-test', 'review', [], alice, { id: project.id }); sessions.push(readonly.id)
      await assert.rejects(projectHost.proposePluginWorkspaceWrite(readonly.id, { target: '검수.json', revision: null, text: '{}' }, alice), /읽기 전용/)
      const connected = host.openPluginInstance('workspace-test', 'review', [], alice, { id: project.id, write: true }); sessions.push(connected.id)
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
      const docInfo = (await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: 'batch/note.json' }] }, alice)).files[0]
      const moving = await projectHost.proposePluginWorkspaceChanges(connected.id, { operations: [{ kind: 'move', target: 'batch', destination: 'moved', expectedRevision: folderInfo.revision }, { kind: 'write', target: 'moved/note.json', text: '{"moved":true}', expectedRevision: docInfo.revision }] }, alice)
      const movingApproval = await projectHost.approvePluginWorkspaceWrite(moving.id, alice)
      assert.equal((await projectHost.applyPluginWorkspaceWrite(moving.id, movingApproval.approval!, alice)).status, 'completed')
      assert.equal((await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: 'moved/note.json' }] }, alice)).files[0].text, '{"moved":true}')
      assert.throws(() => projectHost.listPluginWorkspace(connected.id, {}, bob))
      await assert.rejects(projectHost.readPluginWorkspace(connected.id, { targets: [{ target: '../secret.json' }] }, alice), /경로/)
      const proposal = await projectHost.proposePluginWorkspaceWrite(connected.id, { target: '검수.json', revision: null, text: '{"note":"accepted","takes":{}}' }, alice)
      assert.equal((await WorkspaceService.entries(owner, project.id)).entries.some(entry => entry.target === '검수.json'), false)
      await assert.rejects(projectHost.applyPluginWorkspaceWrite(proposal.id, '0'.repeat(48), alice), /승인/)
      const approved = await projectHost.approvePluginWorkspaceWrite(proposal.id, alice)
      assert.equal(approved.applied, false)
      assert.throws(() => host.applyPluginWrite(proposal.id, approved.approval!, alice))
      const concurrent = await Promise.allSettled([projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice), projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice)])
      assert.ok(concurrent.some(result => result.status === 'fulfilled'))
      const applied = await projectHost.applyPluginWorkspaceWrite(proposal.id, approved.approval!, alice)
      assert.equal(applied.status, 'completed')
      assert.equal((user.getUserSettingsDb().prepare('SELECT COUNT(*) AS n FROM workspace_operations WHERE request_id=?').get(`plugin-${proposal.id}`) as { n: number }).n, 1)
      const saved = (await projectHost.readPluginWorkspace(connected.id, { targets: [{ target: '검수.json' }] }, alice)).files[0]
      assert.equal(saved.text, proposal.text)
      const stale = await projectHost.proposePluginWorkspaceWrite(connected.id, { target: saved.target, revision: saved.revision, text: '{"note":"stale"}' }, alice)
      await WorkspaceService.apply(owner, project.id, 'agent-concurrent-edit', [{ kind: 'write', target: saved.target, expectedRevision: saved.revision, text: '{"note":"agent edit"}' }])
      await assert.rejects(projectHost.approvePluginWorkspaceWrite(stale.id, alice), /변경/)
      const ref = await WorkspaceService.apply(owner, project.id, 'create-media-ref', [{ kind: 'write', target: 'media.json', expectedRevision: null, text: JSON.stringify({ source: 'files', fileId: file.id }) }])
      await WorkspaceService.apply(owner, project.id, 'invalid-media-ref', [{ kind: 'write', target: 'invalid.json', expectedRevision: null, text: '{' }])
      await assert.rejects(projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'invalid.json' }, alice), error => error instanceof Error && 'status' in error && error.status === 400)
      const grant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'media.json' }, alice)
      assert.equal((await projectHost.resolvePluginWorkspaceMedia(grant.token)).entry.id, file.id)
      await WorkspaceService.apply(owner, project.id, 'replace-media-ref', [{ kind: 'write', target: 'media.json', expectedRevision: ref.results[0].revision!, text: JSON.stringify({ source: 'files', fileId: foreign.id }) }])
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
      await WorkspaceService.apply(owner, project.id, 'library-media-ref', [{ kind: 'write', target: 'library.json', expectedRevision: null, text: JSON.stringify({ source: 'library', groupId, compositeHash: libraryHash }) }])
      const libraryGrant = await projectHost.issuePluginWorkspaceMedia(connected.id, { target: 'library.json' }, alice)
      await WorkspaceService.apply(owner, project.id, 'stable-library-ref', [{ kind: 'write', target: 'stable-library.json', expectedRevision: null, text: JSON.stringify({ source: 'library', compositeHash: libraryHash }) }])
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
    assert.equal(parsed.manifest.pages[0].actions.length, 7, 'server actions supply browser schemas automatically')
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
    const { WorkspaceService } = await import('../src/services/workspaceService')
    const project = await WorkspaceService.create(`account:${adminId}`, 'app bridge project')
    const reader = host.openPluginInstance('app-workbench', 'tools', [], admin, { id: project.id, write: false })
    const readContext = app.pluginInstanceAppContext(reader.id, admin, 'http://localhost:1666').context
    const projectInput = { pluginId: 'app-workbench', action: 'app-workbench.project_note', arguments: { target: 'report.md', text: 'shared native workspace' }, requestId: 'native-project-write' }
    await assert.rejects(app.runPluginServerAction(projectInput, readContext))
    const writer = host.openPluginInstance('app-workbench', 'tools', [], admin, { id: project.id, write: true })
    const writeContext = app.pluginInstanceAppContext(writer.id, admin, 'http://localhost:1666', true).context
    const projectRequest = await app.runPluginServerAction(projectInput, writeContext)
    assert.ok('id' in projectRequest)
    assert.equal(projectRequest.project?.id, project.id)
    assert.ok(!JSON.parse((pluginDb().prepare('SELECT context FROM plugin_app_requests WHERE id=?').get(projectRequest.id) as { context: string }).context).workspace, 'do not persist guideline/page snapshots')
    const projectJob = app.applyPluginAppRequest(projectRequest.id, admin)
    for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(RuntimeJobStore.get(projectJob.jobId!)!.status); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.getPluginAppRequest(projectRequest.id, context).status, 'completed')
    assert.equal((await WorkspaceService.read(`account:${adminId}`, project.id, [{ target: 'report.md' }])).files[0].text, 'shared native workspace')
    host.closePluginInstance(reader.id, admin); host.closePluginInstance(writer.id, admin)
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
  await t.test('opaque-origin assets bypass only credentialed CORS, never host approvals', async () => {
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
      for (const metadata of [{}, { 'Sec-Fetch-Site': 'cross-site' }]) {
        const asset = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/main.js`, { headers: { Origin: 'null', ...metadata } })
        assert.equal(asset.status, 200)
        assert.equal(asset.headers.get('access-control-allow-origin'), '*')
        assert.equal(asset.headers.get('access-control-allow-credentials'), null)
        assert.equal(asset.headers.get('cross-origin-resource-policy'), 'cross-origin')
        const hostResponse = await fetch(`${origin}/api/plugins/instances/${instance.id}`, { headers: { Origin: 'null', 'X-CoNAI-Plugin-Host': '1', ...metadata } })
        assert.ok(hostResponse.status >= 400)
      }
      const document = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/index.html`)
      assert.match(document.headers.get('content-security-policy')!, /sandbox allow-scripts/)
      // A page may fetch its own package files (data, wasm) and nothing else.
      assert.match(document.headers.get('content-security-policy')!, /connect-src http:\/\/[^ ;]+\/api\/plugin-assets\/text-editor\/1\.0\.0\/;/)
      assert.ok(!document.headers.get('content-security-policy')!.includes('allow-same-origin'))
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
      const pageDocument = await fetch(`${origin}/api/plugin-assets/text-editor/1.0.0/index.html`)
      assert.ok(pageDocument.headers.get('content-security-policy')!.includes(`frame-src ${origin}/api/plugin-media/preview/;`))
      const files = { 'pic.png': { source: 'files', fileId: picture.id }, 'lib/main.js': { source: 'package', path: 'main.js' } }
      const created = await call('POST', '', { html: '<img src="pic.png"><script src="lib/main.js"></script>', files })
      assert.equal(created.status, 200)
      const { token } = (await created.json()).data as { token: string }
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
      assert.equal((await updated.json()).data.token, token)
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
})
