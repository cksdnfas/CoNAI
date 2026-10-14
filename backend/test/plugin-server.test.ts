import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { test } from 'node:test'
import AdmZip from 'adm-zip'

const SDK = path.resolve(__dirname, '../../plugins/sdk/conai-plugin.js')

function packageOf(folder: string, edit: (manifest: Record<string, unknown>) => void = () => {}, extra: Record<string, string> = {}) {
  const zip = new AdmZip()
  zip.addLocalFolder(folder, '', entry => !/\.md$/i.test(entry))
  zip.addLocalFile(SDK)
  const manifest = JSON.parse(zip.readAsText('plugin.json'))
  edit(manifest)
  zip.updateFile('plugin.json', Buffer.from(JSON.stringify(manifest)))
  for (const [name, text] of Object.entries(extra)) zip.addFile(name, Buffer.from(text))
  return zip.toBuffer()
}

async function until(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000) {
  const started = Date.now()
  while (!await check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

test('trusted plugins run a server module with their own data, hooks and tools', { timeout: 120_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-plugin-server-test-'))
  process.env.RUNTIME_BASE_PATH = path.join(root, '.private')
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const registry = await import('../src/services/plugins/pluginRegistry')
  const runtime = await import('../src/services/plugins/pluginServerRuntime')
  const serverTools = await import('../src/services/plugins/pluginServerTools')
  const app = await import('../src/services/plugins/pluginAppActions')
  const { getMcpToolScope } = await import('../src/mcp/context')
  t.after(async () => {
    await runtime.closePluginServers()
    auth.close(); user.closeUserSettingsDb(); main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-plugin-server-test-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts(username, password_hash, account_type) VALUES ('server-admin', 'unused', 'admin')").run().lastInsertRowid)
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const adminGroup = AuthPermissionGroup.createCustomGroup({ name: 'plugin-server-admins', permissionKeys: ['files.view', 'files.edit', 'images.view', 'images.edit', 'chat.use'] })
  AuthPermissionGroup.addAccountMembership(adminGroup.id, adminId)
  invalidateConfiguredAuthCache()
  const admin = { accountId: adminId, accountType: 'admin' as const }
  const folder = path.resolve(__dirname, '../../plugins/chat-instructions')
  const status = () => runtime.pluginServerStatus('chat-instructions')
  runtime.startPluginServers()

  await t.test('server entry validation does not require duplicate capability declarations', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'))
    assert.ok(registry.parsePluginManifest({ ...manifest, capabilities: undefined }).server)
    assert.equal(registry.parsePluginManifest({ ...manifest, server: undefined }).server, undefined)
    assert.throws(() => registry.parsePluginManifest({ ...manifest, server: { entry: 'server.py' } }), /mjs/)
    assert.throws(() => registry.unpackPlugin(packageOf(folder, m => { m.server = { entry: 'missing.mjs' } })), /서버 모듈 파일/)
  })

  await t.test('enabling starts the module: hook, tool and page requests work against its own database', async () => {
    const installed = await registry.installPlugin(packageOf(folder))
    assert.equal(installed.updated, false)
    assert.equal(installed.plugin.enabled, false)
    assert.equal(status().state, 'off')
    await registry.setPluginEnabled('chat-instructions', true, adminId)
    await until(() => status().state === 'ready', 'module ready')
    assert.deepEqual(status().hooks, ['chat.instructions'])
    assert.deepEqual(status().tools.map(tool => tool.name), ['p_chat_instructions_list_rules'])
    assert.equal(getMcpToolScope('p_chat_instructions_list_rules'), 'read')

    const saved = await runtime.requestPluginServer('chat-instructions', { op: 'save', text: '대답은 세 문장 이하로.', profileId: null }, admin, {}) as { rules: unknown[] }
    assert.equal(saved.rules.length, 1)
    await runtime.requestPluginServer('chat-instructions', { op: 'save', text: '다른 캐릭터 전용', profileId: 99 }, admin, {})
    const instructions = await runtime.applyChatInstructionHooks('BASE', { engine: 'llm', threadId: 1, group: false, profile: { id: 5, name: '루나' } }, admin)
    assert.match(instructions, /^BASE\n\n## 추가 규칙\n- 대답은 세 문장 이하로\.$/)
    assert.ok(fs.existsSync(path.join(process.env.RUNTIME_BASE_PATH!, 'plugins', 'data', 'chat-instructions', 'data.db')))

    const listed = await serverTools.callPluginServerTool('p_chat_instructions_list_rules', { profile_id: 5 }, admin)
    assert.notEqual(listed.isError, true)
    assert.match(JSON.stringify(listed.content), /세 문장/)
    assert.doesNotMatch(JSON.stringify(listed.content), /다른 캐릭터/)

    // conai.tools.call runs an app tool as the person behind the request.
    const profiles = await runtime.requestPluginServer('chat-instructions', { op: 'profiles' }, admin, {}) as { profiles: unknown[] }
    assert.ok(Array.isArray(profiles.profiles))
    await assert.rejects(runtime.requestPluginServer('chat-instructions', { op: 'nope' }, admin, {}), /알 수 없는 요청/)
  })

  await t.test('the MCP layer lists and runs registered tools', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const server = createMcpServer({ requester: admin, scopes: [...ALL_MCP_HTTP_SCOPES], source: 'plugin', toolCatalog: false })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'p_chat_instructions_list_rules'))
      const result = await client.callTool({ name: 'p_chat_instructions_list_rules', arguments: {} })
      assert.notEqual(result.isError, true)
      assert.match(JSON.stringify(result.content), /세 문장/)
    } finally { await client.close(); await server.close() }
  })

  await t.test('trusted pages call any app tool without declaring it or waiting for approval', async () => {
    const context = app.pluginBrowserContext({ requester: admin, sessionId: 'server-admin-session' }, 'http://localhost:1666')
    const read = await app.runPluginAppTool('chat-instructions', { tool: 'list_image_groups', arguments: {} }, context)
    assert.equal(read.status, 'completed')
    // An administrator tool from a trusted page starts at once too.
    const configure = await app.runPluginAppTool('chat-instructions', { tool: 'list_chat_profiles', arguments: {}, requestId: 'trusted-profiles' }, context)
    assert.ok('id' in configure && configure.status !== 'pending')
    const tools = await app.listPluginAppTools('chat-instructions', context, { query: 'list_chat_profiles' })
    assert.equal(tools.tools[0]?.requiresApproval, false)
    const started = await app.runPluginAppTool('chat-instructions', { tool: 'create_image_group', arguments: { name: 'plugin-server-group' }, requestId: 'trusted-create-group' }, context)
    assert.ok('id' in started && started.status !== 'pending', 'a trusted change starts at once')
  })

  await t.test('profile replies preserve identity, bound work, return text and cancel native requests', async (st) => {
    const llm = await import('../src/services/plugins/pluginLlm')
    const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
    const { RuntimeJobRunner } = await import('../src/services/runtimeJobs/runtimeJobRunner')
    st.after(async () => {
      for (const job of RuntimeJobStore.list({ kind: 'plugin-llm', status: ['queued', 'running'] })) RuntimeJobRunner.cancel(job.jobId)
      await until(() => RuntimeJobStore.list({ kind: 'plugin-llm', status: ['queued', 'running'] }).length === 0, 'LLM test cleanup')
    })
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    updateChatSettings({ enabled: true })
    ExternalApiProvider.create({ provider_name: 'plugin-test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: {} })
    const model = ModelSlotStore.ensure('plugin-test', 'test-model')!
    const profile = ChatProfileStore.create({ name: '주민', engine: 'llm', modelSlotId: model, systemPrompt: 'You are a village resident.', maxTokens: 100 })
    const off = ChatProfileStore.create({ name: '비활성', engine: 'llm', modelSlotId: model, isEnabled: false })
    const guestId = Number(auth.prepare("INSERT INTO auth_accounts(username,password_hash,account_type) VALUES ('llm-guest','unused','guest')").run().lastInsertRowid)
    const guestGroup = AuthPermissionGroup.createCustomGroup({ name: 'llm-users', permissionKeys: ['chat.use'] })
    AuthPermissionGroup.addAccountMembership(guestGroup.id, guestId)
    const guest = { accountId: guestId, accountType: 'guest' as const }
    const nobody = { accountId: 999999, accountType: 'admin' as const }
    let calls = 0, aborted = 0, hold = false
    let replyText = '안녕, 이웃!'
    let lastBody = ''
    st.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      calls++; lastBody = String(init?.body)
      if (hold) await new Promise<void>((_resolve, reject) => {
        const cancel = () => { aborted++; reject(init?.signal?.reason) }
        if (init?.signal?.aborted) cancel()
        else init?.signal?.addEventListener('abort', cancel, { once: true })
      })
      return Response.json({ choices: [{ message: { content: replyText }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } })
    })
    await registry.installPlugin(packageOf(folder, m => { m.id = 'llm-bridge' }, { 'server.mjs': `export function activate(conai) {
      let late = null;
      conai.onRequest(({ body }) => {
        if (body.op === 'project') return conai.tools.call(body.tool || 'workspace_list', body.args || {});
        if (body.op === 'late') return late;
        if (body.op === 'background') return conai.background.account();
        if (body.op === 'delay') {
          setTimeout(() => conai.llm.profiles().then(() => { late = 'unexpected success' }, e => { late = e.message }), 50);
          return true;
        }
        return conai.llm[body.op](body.input);
      });
    }` }))
    await registry.setPluginEnabled('llm-bridge', true, adminId)
    await until(() => runtime.pluginServerStatus('llm-bridge').state === 'ready', 'LLM bridge ready')
    const { WorkspaceService } = await import('../src/services/workspaceService')
    const project = await WorkspaceService.create(`account:${adminId}`, 'Server bridge project')
    const host = await import('../src/services/plugins/pluginHost')
    const adminCaller = { requester: admin, sessionId: 'server-project-session' }
    const projectPage = host.openPluginInstance('llm-bridge', 'rules', [], adminCaller, { id: project.id, write: false })
    const app = await import('../src/services/plugins/pluginAppActions')
    const binding = app.pluginInstanceAppContext(projectPage.id, adminCaller, 'http://localhost:1666').context.workspace
    const projectResult = await runtime.requestPluginServer('llm-bridge', { op: 'project' }, admin, {}, 'http://localhost:1666', binding) as { isError?: boolean }
    assert.notEqual(projectResult.isError, true, 'server calls inherit the page project')
    await assert.rejects(runtime.requestPluginServer('llm-bridge', { op: 'project', tool: 'workspace_apply', args: {} }, admin, {}, 'http://localhost:1666', binding), /not permitted/, 'read-only connections remain read-only')
    host.closePluginInstance(projectPage.id, adminCaller)
    const bridge = (op: string, input?: unknown) => runtime.requestPluginServer('llm-bridge', { op, input }, guest, {})
    const listed = await bridge('profiles') as Array<{ id: number }>
    assert.ok(listed.some(item => item.id === profile.id), 'ordinary chat users can select their profiles')
    assert.ok(!listed.some(item => item.id === off.id))
    assert.doesNotMatch(JSON.stringify(listed), /systemPrompt|village resident|apiKey/)
    assert.deepEqual(await bridge('background'), { id: adminId, type: 'admin' }, 'modules learn which account their own timer calls run as')
    await registry.installPlugin(packageOf(folder, m => { m.id = 'web-llm'; delete m.server; delete m.capabilities }))
    await registry.setPluginEnabled('web-llm', true, adminId)
    const { openPluginInstance, closePluginInstance } = await import('../src/services/plugins/pluginHost')
    const webCaller = { requester: guest, sessionId: 'web-llm-user' }
    const webPage = openPluginInstance('web-llm', 'rules', [], webCaller)
    assert.ok(llm.listPluginLlmProfiles('web-llm', guest).some(item => item.id === profile.id), 'LLM use needs chat permission, not server code or file permission')
    closePluginInstance(webPage.id, webCaller)
    await registry.removePlugin('web-llm')
    assert.throws(() => llm.listPluginLlmProfiles('llm-bridge', nobody), /권한/)
    assert.throws(() => llm.startPluginLlmJob('llm-bridge', guest, { requestId: 'off', profileId: off.id, message: 'hi' }), /프로필/)
    // Images use native profile storage/crops and never bypass image or profile permissions.
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 320, height: 160, channels: 3, background: '#c85784' } }).png().toBuffer()
    const crop = { x: 30, y: 45, scale: 1.5 }
    ChatProfileStore.update(profile.id, { avatar: `data:image/png;base64,${png.toString('base64')}`, avatarCrop: crop })
    const publicProfile = llm.listPluginLlmProfiles('llm-bridge', admin).find(p => p.id === profile.id)!
    assert.equal(publicProfile.assets.avatar, true)
    assert.deepEqual(publicProfile.avatarCrop, crop)
    assert.doesNotMatch(JSON.stringify(publicProfile), /base64|uploads|systemPrompt/)
    assert.equal(llm.listPluginLlmProfiles('llm-bridge', guest).find(p => p.id === profile.id)!.assets.avatar, false)
    await assert.rejects(bridge('asset', { profileId: profile.id }), /images.view/)
    const portrait = await runtime.requestPluginServer('llm-bridge', { op: 'asset', input: { profileId: profile.id, maxSize: 128 } }, admin, {}) as import('@conai/shared').PluginProfileAsset
    assert.equal(portrait.state, 'ready')
    assert.deepEqual(portrait.crop, crop)
    assert.equal(portrait.mimeType, 'image/webp')
    const decoded = await sharp(Buffer.from(portrait.data!, 'base64')).metadata()
    assert.equal(decoded.width, 128); assert.equal(decoded.height, 64)
    assert.equal((await llm.readPluginProfileAsset('llm-bridge', admin, { profileId: profile.id, kind: 'reference' })).state, 'missing')
    await assert.rejects(llm.readPluginProfileAsset('llm-bridge', admin, { profileId: off.id }), /프로필/)
    await assert.rejects(llm.readPluginProfileAsset('llm-bridge', admin, { profileId: profile.id, maxSize: 4096 }))
    const input = { requestId: 'turn-1', profileId: profile.id, message: 'PRIVATE_INPUT', history: '사용자: 반가워', maxTokens: 512 }
    const first = await bridge('start', input) as { jobId: string }
    const again = await bridge('start', input) as { jobId: string }
    assert.equal(first.jobId, again.jobId)
    await until(() => llm.getPluginLlmJob('llm-bridge', guest, first.jobId).status === 'completed', 'reply completed')
    const completed = await bridge('get', first.jobId) as { result: { text: string } }
    assert.equal(completed.result.text, '안녕, 이웃!')
    assert.equal(calls, 1)
    assert.match(lastBody, /village resident/)
    assert.match(lastBody, /PRIVATE_INPUT/)
    assert.match(lastBody, /"max_tokens":100/)
    assert.doesNotMatch(RuntimeJobStore.getParamsJson(first.jobId)!, /PRIVATE_INPUT|반가워/)
    const usage = user.getUserSettingsDb().prepare('SELECT purpose, profile_id, reply_id FROM llm_usage_events ORDER BY id DESC LIMIT 1').get() as { purpose: string; profile_id: number; reply_id: string }
    assert.equal(usage.purpose, 'plugin'); assert.equal(usage.profile_id, profile.id); assert.ok(usage.reply_id.includes(first.jobId))
    assert.throws(() => llm.startPluginLlmJob('llm-bridge', guest, { ...input, message: 'changed' }), /같은 요청 ID/)
    assert.throws(() => llm.getPluginLlmJob('llm-bridge', admin, first.jobId), /찾을 수 없어/)
    assert.throws(() => llm.getPluginLlmJob('chat-instructions', guest, first.jobId), /찾을 수 없어/)
    replyText = '{"action":"wave"}'
    const structured = llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: 'structured-turn', structuredOutput: { action: 'string' } })
    await until(() => llm.getPluginLlmJob('llm-bridge', guest, structured.jobId).status === 'completed', 'structured reply')
    assert.deepEqual(llm.getPluginLlmJob('llm-bridge', guest, structured.jobId).result?.json, { action: 'wave' })
    assert.match(lastBody, /JSON/)
    replyText = '안녕, 이웃!'

    // The same token means another account's independent turn, never its private result.
    const other = llm.startPluginLlmJob('llm-bridge', admin, input)
    assert.notEqual(other.jobId, first.jobId)
    await until(() => llm.getPluginLlmJob('llm-bridge', admin, other.jobId).status === 'completed', 'admin reply')
    hold = true
    const active = [0, 1, 2, 3].map(i => llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: `active-${i}` }))
    await until(() => calls === 4, 'first call starts while the others wait for the shared connection slot')
    assert.throws(() => llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: 'overflow' }), /4개/)
    await bridge('cancel', active[0].jobId)
    await until(() => RuntimeJobStore.get(active[0].jobId)?.status === 'cancelled', 'cancel reaches provider')
    assert.equal(aborted, 1)
    assert.equal(llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: 'active-0' }).status, 'cancelled', 'cancelled turns are not replayed')
    await until(() => calls === 5, 'next call acquires the released connection slot')
    await registry.setPluginEnabled('llm-bridge', false, adminId)
    await until(() => active.every(job => RuntimeJobStore.get(job.jobId)?.status === 'cancelled'), 'disable cancels all outstanding replies')
    assert.equal(aborted, 2, 'queued requests were cancelled without reaching the provider')
    await registry.setPluginEnabled('llm-bridge', true, adminId)
    await until(() => runtime.pluginServerStatus('llm-bridge').state === 'ready', 're-enabled bridge')
    const revoked = llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: 'revoked' })
    await until(() => calls === 6, 'revoked call started')
    ChatProfileStore.update(profile.id, { isEnabled: false })
    await until(() => RuntimeJobStore.get(revoked.jobId)?.status === 'failed', 'profile revocation aborts provider')
    assert.equal(aborted, 3)
    ChatProfileStore.update(profile.id, { isEnabled: true })

    const timed = llm.startPluginLlmJob('llm-bridge', guest, { ...input, requestId: 'timeout', timeoutMs: 1000 })
    await until(() => RuntimeJobStore.get(timed.jobId)?.status === 'failed', 'timeout releases the provider slot')
    assert.match(llm.getPluginLlmJob('llm-bridge', guest, timed.jobId).error!, /제한 시간/)
    assert.equal(aborted, 4)

    await bridge('delay')
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.match(String(await bridge('late')), /문맥이 만료/, 'late work cannot silently become administrator work')
    await registry.removePlugin('llm-bridge')
  })

  await t.test('profile runs execute native tools, return their results, recheck grants and cancel without replay', async st => {
    const llm = await import('../src/services/plugins/pluginLlm')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const { FileStoreService } = await import('../src/services/fileStoreService')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { automationRoomKinds } = await import('../src/services/codex-chat/chatRoomWake')
    const profile = ChatProfileStore.create({ name: 'Plugin worker', engine: 'llm', modelSlotId: ModelSlotStore.ensure('plugin-test', 'test-model')!,
      mcpEnabled: true, mcpScopes: ['organize'], toolAllowlist: ['create_file_folder'], maxTokens: 1024, summaryEnabled: false, maxToolRounds: 3 })
    let folderName = 'native-plugin-result', revoke = false, hold = false, aborted = false, calls = 0
    const results: string[] = []
    st.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      calls++
      if (hold) await new Promise<void>((_resolve, reject) => {
        const cancel = () => { aborted = true; reject(init?.signal?.reason) }
        if (init?.signal?.aborted) cancel(); else init?.signal?.addEventListener('abort', cancel, { once: true })
      })
      const body = JSON.parse(String(init?.body ?? '{}'))
      const messages = body.messages as Array<{ role: string; content: string }>
      // Only inspect the current turn; a dedicated profile room retains its earlier tool history.
      const current = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
      const result = current.find(message => message.role === 'tool')
      if (result) results.push(result.content)
      if (!result && body.tools?.length) {
        if (revoke) ChatProfileStore.update(profile.id, { toolAllowlist: ['list_files'] })
        const catalog = body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'run_tool')
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: `folder-${calls}`, type: 'function', function: {
          name: catalog ? 'run_tool' : 'create_file_folder', arguments: JSON.stringify(catalog ? { tool: 'create_file_folder', arguments: { name: folderName } } : { name: folderName }) } }] }, finish_reason: 'tool_calls' }] })
      }
      return Response.json({ choices: [{ message: { content: '실행 결과를 확인했어.' }, finish_reason: 'stop' }] })
    })
    const input = { requestId: 'profile-run', profileId: profile.id, mode: 'profile', message: 'Create the requested folder and report the real result.', maxTokens: 1024 }
    const job = llm.startPluginLlmJob('chat-instructions', admin, input)
    const done = async (id: string) => { await until(() => !['queued','running'].includes(llm.getPluginLlmJob('chat-instructions', admin, id).status), 'native profile execution'); return llm.getPluginLlmJob('chat-instructions', admin, id) }
    const result = await done(job.jobId)
    assert.equal(result.status, 'completed', result.error ?? '')
    assert.equal(result.result?.text, '실행 결과를 확인했어.')
    assert.ok(results.some(output => output.includes(folderName)), 'the native tool result returns to the model')
    assert.equal(FileStoreService.list(`account:${adminId}`, null).entries.filter(entry => entry.name === folderName).length, 1)
    const run = result.result!.profileRun!
    assert.equal(run.tools[0].name, 'create_file_folder')
    assert.equal(run.tools[0].status, 'completed')
    assert.ok(run.tools[0].output.includes(folderName))
    assert.equal(automationRoomKinds(adminId).get(run.threadId), 'plugin')
    assert.ok(CodexChatStore.findThread(run.threadId, adminId))
    const callCount = calls
    assert.equal(llm.startPluginLlmJob('chat-instructions', admin, input).jobId, job.jobId)
    assert.equal(calls, callCount, 'a repeated request never repeats a tool mutation')
    const guestId = Number((auth.prepare("SELECT id FROM auth_accounts WHERE username='llm-guest'").get() as { id: number }).id)
    assert.throws(() => llm.getPluginLlmJob('chat-instructions', { accountId: guestId, accountType: 'guest' }, job.jobId), /찾을 수 없어/)
    assert.ok(!CodexChatStore.findThread(run.threadId, guestId))

    revoke = true; folderName = 'must-not-create-revoked'
    const denied = await done(llm.startPluginLlmJob('chat-instructions', admin, { ...input, requestId: 'profile-revoked' }).jobId)
    assert.equal(denied.status, 'completed', denied.error ?? '')
    assert.equal(denied.result?.profileRun?.threadId, run.threadId, 'the plugin retains its own profile conversation')
    assert.ok(denied.result?.profileRun?.tools.some(tool => tool.status === 'failed'), 'revocation is checked at tool dispatch')
    assert.ok(!FileStoreService.list(`account:${adminId}`, null).entries.some(entry => entry.name === folderName))
    revoke = false; hold = true
    const before = calls
    const active = llm.startPluginLlmJob('chat-instructions', admin, { ...input, requestId: 'profile-cancel' })
    await until(() => calls > before, 'native model starts')
    llm.cancelPluginLlmJob('chat-instructions', admin, active.jobId)
    await until(() => aborted, 'native cancellation reaches provider')
    await until(() => llm.getPluginLlmJob('chat-instructions', admin, active.jobId).status === 'cancelled', 'native job cancelled')
    assert.equal(llm.startPluginLlmJob('chat-instructions', admin, { ...input, requestId: 'profile-cancel' }).status, 'cancelled')
  })

  await t.test('an update keeps data and activation regardless of legacy permission declarations', async () => {
    const same = await registry.installPlugin(packageOf(folder, m => { m.version = '1.0.1' }))
    assert.equal(same.updated, true)
    assert.equal(same.reenable, false)
    assert.equal(same.plugin.enabled, true)
    assert.ok(!fs.existsSync(path.join(registry.pluginPackagesRoot, 'chat-instructions', '1.0.0')), 'the old version folder goes')
    await until(() => status().state === 'ready', 'restarted module')
    const kept = await runtime.requestPluginServer('chat-instructions', { op: 'list' }, admin, {}) as { rules: unknown[] }
    assert.equal(kept.rules.length, 2)
    await assert.rejects(registry.installPlugin(packageOf(folder, m => { m.version = '1.0.1' })), /같은 패키지/)

    const wider = await registry.installPlugin(packageOf(folder, m => { m.version = '1.0.2'; m.capabilities = ['server', 'files.read'] }))
    assert.equal(wider.reenable, false)
    assert.equal(wider.plugin.enabled, true)
    await until(() => status().state === 'ready', 'updated module ready')
    await registry.setPluginEnabled('chat-instructions', false)
    await until(() => status().state === 'off', 'module stopped')
    assert.equal(serverTools.findPluginServerTool('p_chat_instructions_list_rules'), null)
    assert.equal(await runtime.applyChatInstructionHooks('BASE', { engine: 'llm', threadId: 1, group: false, profile: { id: 5, name: '루나' } }, admin), 'BASE')
  })

  await t.test('slow hooks are skipped, failures stay inside the call and a crashed module comes back', async () => {
    const lab = path.join(root, 'lab-plugin')
    fs.mkdirSync(lab)
    fs.writeFileSync(path.join(lab, 'plugin.json'), JSON.stringify({ apiVersion: 1, id: 'lab', name: 'lab', version: '1.0.0', description: '', capabilities: ['server'], server: { entry: 'server.mjs' }, pages: [{ id: 'main', title: 'lab', entry: 'index.html', accepts: [], actions: [] }] }))
    fs.writeFileSync(path.join(lab, 'index.html'), '<!doctype html><title>lab</title>')
    fs.writeFileSync(path.join(lab, 'server.mjs'), `export function activate(conai) {
      let cancelled = false;
      conai.onRequest(({ body }, { signal }) => {
        if (body.op === 'cancelled') return cancelled;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true }));
      });
      conai.hooks.on('chat.instructions', () => new Promise(resolve => setTimeout(() => resolve('SLOW'), 5000)))
      conai.tools.register({ name: 'fail', scope: 'read', inputSchema: { type: 'object' }, handler: () => { throw new Error('boom') } })
      conai.tools.register({ name: 'crash', scope: 'read', inputSchema: { type: 'object' }, handler: () => process.exit(3) })
      conai.tools.register({ name: 'bad name!', scope: 'read', handler: () => 1 })
    }`)
    await registry.installPlugin(packageOf(lab))
    await registry.setPluginEnabled('lab', true, adminId)
    const lab_ = () => runtime.pluginServerStatus('lab')
    await until(() => lab_().state === 'ready' && lab_().tools.length === 2, 'lab ready')
    const cancellation = new AbortController()
    const waiting = runtime.requestPluginServer('lab', {}, admin, {}, undefined, undefined, cancellation.signal)
    const rejected = assert.rejects(waiting, /취소/)
    cancellation.abort()
    await rejected
    await until(async () => Boolean(await runtime.requestPluginServer('lab', { op: 'cancelled' }, admin, {})), 'cancellation reached the module')
    const started = Date.now()
    assert.equal(await runtime.applyChatInstructionHooks('BASE', { engine: 'codex', threadId: null, group: false, profile: { id: 1, name: 'x' } }, admin), 'BASE')
    assert.ok(Date.now() - started < 4_500, 'the hook gives up after three seconds')
    const failed = await serverTools.callPluginServerTool('p_lab_fail', {}, admin)
    assert.equal(failed.isError, true)
    assert.match(JSON.stringify(failed.content), /boom/)
    const crashed = await serverTools.callPluginServerTool('p_lab_crash', {}, admin)
    assert.equal(crashed.isError, true)
    await until(() => lab_().state === 'ready' && lab_().tools.length === 2, 'lab restarted after a crash')
    await registry.removePlugin('lab')
  })

  await t.test('removing the plugin stops it and deletes its data', async () => {
    await registry.setPluginEnabled('chat-instructions', true, adminId)
    await until(() => status().state === 'ready', 'module ready again')
    await registry.removePlugin('chat-instructions')
    assert.equal(status().state, 'off')
    assert.equal(serverTools.pluginServerTools().length, 0)
    assert.ok(!fs.existsSync(path.join(process.env.RUNTIME_BASE_PATH!, 'plugins', 'data', 'chat-instructions')))
  })
})
