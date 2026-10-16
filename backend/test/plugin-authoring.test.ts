import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { test } from 'node:test'
import type { ChatExecutionContext, PluginDraft, PluginDraftFile, PluginPackageReview } from '@conai/shared'

test('plugin authoring keeps executable installation behind administrator review', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-plugin-authoring-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const key of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${key}_DIR`] = path.join(root, key.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  t.after(async () => {
    settings.closeUserSettingsDb(); auth.close(); main.closeDatabase()
    await new Promise<void>(resolve => { void import('../src/utils/logger').then(({ logger }) => logger.close(resolve)) })
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-plugin-authoring-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const accountId = Number(auth.prepare("INSERT INTO auth_accounts(username,password_hash,account_type) VALUES('author','unused','admin')").run().lastInsertRowid)
  const guestId = Number(auth.prepare("INSERT INTO auth_accounts(username,password_hash,account_type) VALUES('reader','unused','guest')").run().lastInsertRowid)
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const group = AuthPermissionGroup.createCustomGroup({ name: 'plugin-authors', permissionKeys: ['chat.use'] })
  AuthPermissionGroup.addAccountMembership(group.id, accountId)
  ;(await import('../src/services/auth/sessionAccess')).invalidateConfiguredAuthCache()
  const admin = { accountId, accountType: 'admin' as const }
  const guest = { accountId: guestId, accountType: 'guest' as const }
  const author = await import('../src/services/plugins/pluginAuthoring')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const { pluginDataDir } = await import('../src/services/plugins/pluginData')
  const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
  const { pluginAppToolScope } = await import('../src/services/plugins/pluginAppPolicy')
  const shared = await import('@conai/shared')
  const install = (review: PluginPackageReview) => author.installPluginDraft(admin, { draftId: review.draftId, revision: review.revision, digest: review.digest, enabled: review.enabled })
  let draft: PluginDraft
  const read = (target: string) => author.readPluginDraft(admin, { draftId: draft.id, target }) as PluginDraftFile

  await t.test('draft creation, edits and deterministic package builds do not install code', () => {
    const input = { requestId: 'new-plugin-001', pluginId: 'author-test', name: 'Author test' }
    draft = author.createPluginDraft(admin, input)
    assert.equal(author.createPluginDraft(admin, input).id, draft.id)
    assert.throws(() => author.createPluginDraft(admin, { ...input, name: 'Different' }), /요청 ID/)
    assert.ok(draft.files.some(file => file.name === 'conai-plugin.js'))
    assert.ok(draft.files.some(file => file.name === 'conai-plugin.css'))
    assert.throws(() => registry.getPlugin('author-test', false), /플러그인/)
    const before = read('app.js').text
    const change = { draftId: draft.id, revision: draft.revision, requestId: 'edit-source-001', operations: [{ kind: 'edit' as const, target: 'app.js', edits: [{ old_text: 'ready: true', new_text: 'ready: false' }] }] }
    draft = author.changePluginDraft(admin, change)
    assert.equal(author.changePluginDraft(admin, change).revision, draft.revision)
    assert.equal(read('app.js').text, before.replace('ready: true', 'ready: false'))
    assert.throws(() => author.changePluginDraft(admin, { ...change, requestId: 'stale-source-001' }), /초안이 변경/)
    const first = author.buildPluginDraft(admin, draft.id, draft.revision)
    assert.equal(author.buildPluginDraft(admin, draft.id, draft.revision).digest, first.digest)
    assert.equal(registry.unpackPlugin(first.bytes).manifest.id, 'author-test')
    assert.throws(() => author.changePluginDraft(admin, { draftId: draft.id, revision: draft.revision, requestId: 'escape-source-01', operations: [{ kind: 'write', target: '../server.mjs', text: 'bad' }] }), /경로/)
    assert.throws(() => author.changePluginDraft(admin, { draftId: draft.id, revision: draft.revision, requestId: 'atomic-source-01', operations: [{ kind: 'write', target: 'safe.js', text: 'ok' }, { kind: 'write', target: 'blocked.exe', text: 'bad' }] }), /텍스트/)
    assert.ok(!author.getPluginDraft(admin, draft.id).files.some(file => file.name === 'safe.js'))
  })

  await t.test('installation binds the reviewed revision and digest, and retries are safe', async () => {
    const review = author.reviewPluginDraft(admin, draft.id, draft.revision)
    await assert.rejects(author.installPluginDraft(admin, { draftId: draft.id, revision: draft.revision, digest: '0'.repeat(64), enabled: false }), /패키지/)
    const installed = await install(review)
    assert.equal(installed.enabled, false)
    assert.deepEqual(await install(review), installed)
    await registry.setPluginEnabled(draft.pluginId, true, accountId)
    const privateFile = path.join(pluginDataDir(draft.pluginId), 'private.txt')
    fs.writeFileSync(privateFile, 'DO NOT EXPORT')
    const copy = author.createPluginDraft(admin, { requestId: 'copy-source-001', pluginId: draft.pluginId, fromInstalled: true })
    assert.ok(!copy.files.some(file => file.name === 'private.txt'))
    const changed = author.changePluginDraft(admin, { draftId: copy.id, revision: copy.revision, requestId: 'update-source-01', operations: [{ kind: 'write', target: 'style.css', text: 'main { padding: 24px; }' }] })
    const nextReview = author.reviewPluginDraft(admin, changed.id, changed.revision)
    assert.equal(nextReview.updated, true)
    assert.equal(nextReview.files.find(file => file.name === 'style.css')?.change, 'changed')
    await registry.setPluginEnabled(draft.pluginId, false, accountId)
    await assert.rejects(install(nextReview), /활성 상태/)
    await registry.setPluginEnabled(draft.pluginId, true, accountId)
    assert.equal((await install(nextReview)).enabled, true)
    assert.equal(fs.readFileSync(privateFile, 'utf8'), 'DO NOT EXPORT')
    await assert.rejects(install(review), /플러그인이 바뀌/)
    const exported = author.exportInstalledPlugin(admin, draft.pluginId)
    assert.ok(!registry.unpackPlugin(exported.bytes).assets.has('private.txt'))
    const fork = author.createPluginDraft(admin, { requestId: 'copy-source-002', pluginId: draft.pluginId, fromInstalled: true })
    const oldReview = author.reviewPluginDraft(admin, fork.id, fork.revision)
    author.changePluginDraft(admin, { draftId: fork.id, revision: fork.revision, requestId: 'edit-source-002', operations: [{ kind: 'write', target: 'style.css', text: 'main {}' }] })
    await assert.rejects(install(oldReview), /초안이 변경/)
  })

  await t.test('export round-trips binary assets and refuses filesystem links', async () => {
    let binary = author.createPluginDraft(admin, { requestId: 'binary-draft-001', pluginId: 'binary-test' })
    const bytes = Buffer.from([0, 255, 128, 0, 5])
    binary = author.uploadPluginDraftAsset(admin, { draftId: binary.id, revision: binary.revision, requestId: 'binary-file-001', target: 'assets/sample.png' }, bytes)
    await install(author.reviewPluginDraft(admin, binary.id, binary.revision))
    const exported = author.exportInstalledPlugin(admin, binary.pluginId)
    assert.deepEqual(registry.unpackPlugin(exported.bytes).assets.get('assets/sample.png'), bytes)
    const outside = path.join(root, 'outside.txt')
    fs.writeFileSync(outside, 'private outside')
    const linked = path.join(registry.pluginPackagesRoot, binary.pluginId, '1.0.0', 'linked.txt')
    fs.linkSync(outside, linked)
    assert.throws(() => author.exportInstalledPlugin(admin, binary.pluginId), /파일/)
    fs.unlinkSync(linked)
    await registry.removePlugin(binary.pluginId)
    assert.equal((await registry.installPlugin(exported.bytes)).plugin.manifest.id, binary.pluginId)
    assert.deepEqual(fs.readFileSync(registry.packageFile(binary.pluginId, '1.0.0', 'assets/sample.png')), bytes)
  })

  await t.test('HTTP routes require the administrator host and export only package assets', async () => {
    const express = (await import('express')).default
    const { default: routes, pluginRouteError } = await import('../src/routes/plugins.routes')
    const app = express()
    let caller = admin as { accountId: number; accountType: string }
    app.use(express.json())
    app.use((req, _res, next) => { Object.assign(req, { sessionID: 'test-session', session: { authenticated: true, ...caller } }); next() })
    app.use('/api/plugins', routes, pluginRouteError)
    const server = http.createServer(app)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/plugins/authoring`
    const headers = { 'X-CoNAI-Plugin-Host': '1' }
    try {
      assert.equal((await fetch(`${url}/drafts`)).status, 403)
      assert.equal((await fetch(`${url}/drafts`, { headers: { ...headers, Origin: 'null' } })).status, 403)
      caller = guest
      assert.equal((await fetch(`${url}/drafts`, { headers })).status, 403)
      assert.equal((await fetch(`${url}/installed/author-test/export`, { headers })).status, 403)
      caller = admin
      const response = await fetch(`${url}/installed/author-test/export`, { headers })
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-disposition')!, /author-test-1.0.0.zip/)
      assert.equal(registry.unpackPlugin(Buffer.from(await response.arrayBuffer())).manifest.id, 'author-test')
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  await t.test('chat can author and prepare a package but cannot install, bypass scopes or keep revoked rights', async () => {
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    updateChatSettings({ enabled: true })
    ExternalApiProvider.create({ provider_name: 'author-test', display_name: 'Author test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: 'Author', engine: 'llm', providerName: 'author-test', mcpEnabled: true, mcpScopes: ['configure'] })
    const threadId = CodexChatStore.createThread(accountId, 'Author', 'llm', profile.id)
    const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'author-reply' }
    const release = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const names = ['list_plugin_drafts', 'create_plugin_draft', 'read_plugin_draft', 'edit_plugin_draft', 'prepare_plugin_install']
    const bridge = await openChatMcpBridge(admin, ['configure'], names, { chatContext: context })
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await bridge.call(name, args)
      assert.ok(!result.isError, JSON.stringify(result))
      return JSON.parse((result.content![0] as { text: string }).text)
    }
    try {
      assert.ok(names.every(name => bridge.tools.some(tool => tool.function.name === name)))
      assert.ok(!bridge.tools.some(tool => /^(install_plugin|apply_plugin|enable_plugin)/.test(tool.function.name)))
      const created = await call('create_plugin_draft', { requestId: 'mcp-author-001', pluginId: 'mcp-author' }) as PluginDraft
      const edited = await call('edit_plugin_draft', { draftId: created.id, revision: created.revision, requestId: 'mcp-edit-001', operations: [{ kind: 'write', target: 'style.css', text: 'main {}' }] }) as PluginDraft
      const review = await call('prepare_plugin_install', { draftId: edited.id, revision: edited.revision }) as { review: PluginPackageReview; status: string }
      assert.equal(review.status, 'needs_human_review')
      assert.throws(() => registry.getPlugin('mcp-author', false))
      assert.equal(shared.chatPageActionTier('plugin_author.install'), 'commit')
      assert.equal(shared.chatPageActionTier('plugin_author.edit'), 'draft')
      assert.equal(shared.chatPageActionAllowed('/ext/author-test/main', 'plugin_author.install'), false)
      for (const name of names) {
        assert.equal(pluginAppToolScope(name), null)
        assert.equal(isContextToolAllowed({ scopes: ['configure'], source: 'plugin', requester: admin }, name), false)
        assert.equal(isContextToolAllowed({ scopes: ['configure'], source: 'http' }, name), false)
        assert.equal(isContextToolAllowed({ scopes: ['read'], source: 'llm-chat', requester: admin, chatContext: context }, name), false)
      }
      auth.prepare("UPDATE auth_accounts SET account_type='guest' WHERE id=?").run(accountId)
      assert.throws(() => author.listPluginDrafts(admin), /관리자/)
      assert.throws(() => author.exportInstalledPlugin(admin, 'author-test'), /관리자/)
      assert.equal((await bridge.call('list_plugin_drafts', {})).isError, true)
    } finally { await bridge.close(); release() }
  })
})
