import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('composer selections stay inside the chat grant and apply only to their user turn', { timeout: 60000 }, async t => {
  const previousEnv = { ...process.env }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-directives-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true })
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username,password_hash,account_type) VALUES ('directive-admin','unused','admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships(account_id,group_id) SELECT ?,id FROM auth_permission_groups WHERE group_key='admin'").run(adminId)
  const owner = Number(auth.prepare("INSERT INTO auth_accounts (username,password_hash,account_type) VALUES ('directive-owner','unused','guest')").run().lastInsertRowid)
  const stranger = Number(auth.prepare("INSERT INTO auth_accounts (username,password_hash,account_type) VALUES ('directive-other','unused','guest')").run().lastInsertRowid)
  for (const account of [owner, stranger]) auth.prepare("INSERT INTO auth_account_group_memberships(account_id,group_id) SELECT ?,id FROM auth_permission_groups WHERE group_key='guest'").run(account)
  auth.prepare("DELETE FROM auth_group_permissions WHERE group_id=(SELECT id FROM auth_permission_groups WHERE group_key='guest')").run()
  auth.prepare("INSERT INTO auth_group_permissions(group_id,permission_id,allowed) SELECT g.id,p.id,1 FROM auth_permission_groups g,auth_permissions p WHERE g.group_key='guest' AND p.permission_key IN ('chat.use','files.view')").run()
  invalidateConfiguredAuthCache()
  invalidateResolvedAuthAccessCache()
  const requester = { accountId: owner, accountType: 'guest' as const }
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  type RequestBody = { messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }>; tool_choice?: unknown }
  const requests: RequestBody[] = []
  let invokeFiles = false
  let finishReason = 'stop'
  app.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'm', context_window: 8192 }] }))
  app.post('/v1/chat/completions', (req, res) => {
    requests.push(req.body)
    const call = invokeFiles && !req.body.messages.some((message: { role: string }) => message.role === 'tool')
    res.setHeader('Content-Type', 'text/event-stream')
    const delta = call ? { tool_calls: [{ index: 0, id: 'selected-files', type: 'function', function: { name: 'list_files', arguments: '{}' } }] } : { content: 'Completed.' }
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: call ? 'tool_calls' : finishReason }] })}\n\ndata: [DONE]\n\n`)
  })
  app.use((req, _res, next) => {
    const accountId = Number(req.header('x-test-account')) || undefined
    Object.assign(req, { sessionID: `directives-${accountId}`, session: { authenticated: Boolean(accountId), accountId, accountType: accountId ? 'guest' : undefined } })
    next()
  })
  app.use('/api/codex-chat', (await import('../src/routes/codex-chat.routes')).default)
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => {
    await CodexChatService.stopAllSessions('directive tests complete')
    await new Promise<void>(resolve => server.close(() => resolve()))
    ;(await import('../src/services/runtime-events/runtimeEventBroadcaster')).RuntimeEventBroadcaster.shutdown()
    ;(await import('../src/database/audioDb')).closeAudioDb()
    user.closeUserSettingsDb()
    main.closeDatabase()
    auth.close()
    await new Promise<void>(async resolve => (await import('../src/utils/logger')).logger.close(resolve))
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'directives', display_name: 'Directives', provider_type: 'llm_openai_compatible', base_url: `${origin}/v1`, is_enabled: true, additional_config: { default_model: 'm' } })
  const first = ChatGenerationPresetStore.create({ name: 'First preset', kind: 'nai', instruction: 'First guide' })
  const second = ChatGenerationPresetStore.create({ name: 'Second preset', kind: 'nai', instruction: 'Second guide' })
  const unlinked = ChatGenerationPresetStore.create({ name: 'Unlinked', kind: 'nai' })
  const delegatedPermissions = ['generation.execute', 'images.view', 'files.view'] as const
  const profile = ChatProfileStore.create({ name: 'Selections', engine: 'llm', providerName: 'directives', model: 'm', mcpEnabled: true, mcpScopes: ['read'], generationPresetIds: [second.id, first.id], delegatedPermissions: [...delegatedPermissions], contextTokens: 8192, summaryEnabled: false })
  const threadId = CodexChatStore.createThread(owner, 'Selections', 'llm', profile.id)
  const sendPath = `/api/codex-chat/threads/${threadId}/messages`
  const get = (query: string, account = owner) => fetch(`${origin}/api/codex-chat/${query}`, { headers: account ? { 'x-test-account': String(account) } : {} })
  const send = (toolDirective?: unknown, url = sendPath, extra: Record<string, unknown> = {}) => fetch(origin + url, { method: 'POST', headers: { 'x-test-account': String(owner), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Please do the requested work.', ...extra, ...(toolDirective === undefined ? {} : { toolDirective }) }) })
  const events = async (response: Response) => {
    assert.equal(response.status, 200)
    return (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  }
  const modelText = (request: RequestBody) => request.messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')

  await t.test('lists exactly owned/profile grants, including delegated permissions, with strict query and group boundaries', async () => {
    const byProfile = await get(`composer-tools?profileId=${profile.id}`)
    assert.equal(byProfile.status, 200)
    const expectedPresets = [
      { id: second.id, name: 'Second preset', instruction: 'Second guide', kind: 'nai' },
      { id: first.id, name: 'First preset', instruction: 'First guide', kind: 'nai' },
    ]
    const profileData = (await byProfile.json()).data
    const byThread = (await (await get(`composer-tools?threadId=${threadId}`)).json()).data
    assert.deepEqual(profileData.presets, expectedPresets)
    assert.deepEqual(byThread, profileData)
    assert.ok(byThread.tools.some((tool: { name: string }) => tool.name === 'list_files'))
    assert.ok(byThread.tools.every((tool: { name: string; description: string; scope: unknown }) => !tool.name.startsWith('generate_image') && !['delete_files', 'generate_nai', 'open_tools', 'run_tool'].includes(tool.name) && typeof tool.description === 'string' && 'scope' in tool))
    for (const query of ['composer-tools', `composer-tools?threadId=${threadId}&profileId=${profile.id}`, 'composer-tools?profileId=abc', `composer-tools?profileId=${profile.id}&profileId=${profile.id}`]) {
      const response = await get(query)
      assert.equal(response.status, 400)
      await response.arrayBuffer()
    }
    for (const [query, account, status] of [[`composer-tools?threadId=${threadId}`, stranger, 404], [`composer-tools?profileId=${profile.id}`, 0, 403], ['admin/tools', owner, 403]] as const) {
      const response = await get(query, account)
      assert.equal(response.status, status)
      assert.equal((await response.json()).code, undefined)
    }
    ChatProfileStore.update(profile.id, { delegatedPermissions: ['files.view'] })
    assert.deepEqual((await (await get(`composer-tools?profileId=${profile.id}`)).json()).data.presets, [])
    ChatProfileStore.update(profile.id, { delegatedPermissions: [...delegatedPermissions] })
    const groupId = ChatGroupStore.create(owner, 'Group', [profile.id], profile.id)
    assert.deepEqual((await (await get(`composer-tools?threadId=${groupId}`)).json()).data, { presets: [], tools: [] })
    const groupSend = await send({ presetId: first.id }, `/api/codex-chat/threads/${groupId}/messages`)
    assert.equal(groupSend.status, 400)
    assert.deepEqual(await groupSend.json(), { success: false, error: '도구 지시는 1:1 채팅에서만 사용할 수 있어.', code: 'tool_directive_unavailable' })
    assert.deepEqual(CodexChatStore.listMessages(groupId), [])
    const codex = ChatProfileStore.create({ name: 'Codex restricted', engine: 'codex' })
    const forbidden = await get(`composer-tools?profileId=${codex.id}`)
    assert.equal(forbidden.status, 403)
    await forbidden.arrayBuffer()
  })

  await t.test('invalid and unavailable directives reject before user storage or any model request', async () => {
    const count = requests.length
    for (const directive of [null, {}, { presetId: '1' }, { presetId: first.id, tool: 'list_files' }, { presetId: unlinked.id }, { tool: 'generate_image' }, { tool: 'delete_files' }, { tool: 'generate_nai' }, { tool: 'missing' }]) {
      const response = await send(directive)
      assert.equal(response.status, 400)
      const body = await response.json()
      assert.equal(body.success, false)
      assert.ok(body.error)
      assert.equal(body.code, 'tool_directive_unavailable')
      assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'success'])
    }
    for (const { url, extra, status, error } of [
      { url: sendPath, extra: { text: 'x'.repeat(20001) }, status: 400, error: 'Message is longer than 20000 characters' },
      { url: sendPath, extra: { mediaHashes: ['a'.repeat(48)] }, status: 403, error: '앱 미디어 접근 권한이 없어.' },
      { url: '/api/codex-chat/threads/99999999/messages', extra: {}, status: 404, error: '채팅을 찾을 수 없어.' },
    ]) {
      const response = await send({ presetId: first.id }, url, extra)
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { success: false, error })
    }
    assert.equal(requests.length, count)
    assert.deepEqual(CodexChatStore.listMessages(threadId), [])
  })

  await t.test('a selected preset is instructed by current id mapping and keeps its original name snapshot on reads and retries', async () => {
    const sent = await events(await send({ presetId: first.id }))
    const userMessage = sent.find(event => event.type === 'user').message
    assert.deepEqual(userMessage.toolDirective, { presetId: first.id, name: 'First preset' })
    assert.ok(requests[0].tools?.some(tool => tool.function.name === 'generate_image_2'))
    assert.match(modelText(requests[0]), /this turn only.*First preset.*generate_image_2/s)
    assert.equal(requests[0].tool_choice, undefined)
    ChatGenerationPresetStore.update(first.id, { name: 'Renamed preset' })
    ChatProfileStore.update(profile.id, { generationPresetIds: [first.id, second.id] })
    const assistant = sent.find(event => event.type === 'done').message
    await CodexChatService.rewriteMessage(requester, threadId, assistant.id, undefined, () => {})
    assert.match(modelText(requests.at(-1)!), /this turn only.*Renamed preset.*"generate_image"/s)
    const detail = await (await get(`threads/${threadId}`)).json()
    assert.deepEqual(detail.data.messages.find((message: { id: number }) => message.id === userMessage.id).toolDirective, { presetId: first.id, name: 'First preset' })
    const copy = CodexChatService.branchThread(requester, threadId, userMessage.id)
    assert.deepEqual(CodexChatStore.listMessages(copy.id)[0].toolDirective, { presetId: first.id, name: 'First preset' })
    ChatProfileStore.update(profile.id, { generationPresetIds: [second.id] })
    await CodexChatService.rewriteMessage(requester, threadId, assistant.id, undefined, () => {})
    assert.doesNotMatch(modelText(requests.at(-1)!), /User's tool selection/)
    assert.deepEqual(CodexChatStore.findMessage(threadId, userMessage.id)?.toolDirective, { presetId: first.id, name: 'First preset' })
    ChatProfileStore.update(profile.id, { generationPresetIds: [first.id, second.id] })
    await CodexChatService.rewriteMessage(requester, threadId, userMessage.id, 'Please revise the requested work.', () => {})
    assert.match(modelText(requests.at(-1)!), /this turn only.*Renamed preset.*"generate_image"/s)
    ChatProfileStore.update(profile.id, { generationPresetIds: [second.id] })
  })

  await t.test('a catalogued tool becomes directly callable for the selected turn, never subsequent sends', async () => {
    const before = requests.length
    invokeFiles = true
    const sent = await events(await send({ tool: 'list_files' }))
    invokeFiles = false
    assert.ok(requests[before].tools?.some(tool => tool.function.name === 'list_files'))
    assert.match(modelText(requests[before]), /this turn only.*list_files/s)
    const userMessage = sent.find(event => event.type === 'user').message
    assert.deepEqual(userMessage.toolDirective, { tool: 'list_files' })
    const reply = sent.find(event => event.type === 'done').message
    const call = reply.tool_calls.find((call: { tool: string }) => call.tool === 'list_files')
    assert.equal(call.status, 'completed', call.summary)
    await events(await send())
    const plain = requests.at(-1)!
    assert.ok(!plain.tools?.some(tool => tool.function.name === 'list_files'), 'ordinary tools return to the lazy catalog')
    assert.doesNotMatch(modelText(plain), /User's tool selection/)
    assert.equal(CodexChatStore.findMessage(threadId, CodexChatStore.latestUserMessageId(threadId)!)?.toolDirective, undefined)
  })

  await t.test('rewrite holds the thread while a directive is revalidated so a later send cannot overtake it', async st => {
    const sent = await events(await send({ tool: 'list_files' }))
    const replyId = sent.find(event => event.type === 'done').message.id
    const { Client } = require('@modelcontextprotocol/client') as typeof import('@modelcontextprotocol/client')
    const originalList = Client.prototype.listTools
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let hold = true
    st.mock.method(Client.prototype, 'listTools', async function(this: InstanceType<typeof Client>, ...args: Parameters<typeof originalList>) {
      if (hold) { hold = false; entered(); await gate }
      return originalList.apply(this, args)
    })
    const rewriting = CodexChatService.rewriteMessage(requester, threadId, replyId, undefined, () => {})
    try {
      await Promise.race([waiting, rewriting.then(() => { throw new Error('Retry finished without reaching tool discovery') })])
      await assert.rejects(CodexChatService.sendMessage(requester, threadId, 'Must not overtake retry', () => {}), (error: unknown) => (error as { status?: number }).status === 409)
      assert.equal(CodexChatStore.latestMessageId(threadId), replyId)
    } finally {
      release()
      await rewriting
    }
  })

  await t.test('continuing a cut reply retains its user selection and drops it only after revocation', async st => {
    const original = ChatProfileStore.find(profile.id)!
    st.after(() => ChatProfileStore.update(profile.id, { toolAllowlist: original.toolAllowlist, generationPresetIds: original.generationPresetIds }))
    st.after(() => { finishReason = 'stop' })
    for (const selection of [{ tool: 'list_files' }, { presetId: second.id }]) {
      finishReason = 'length'
      const sent = await events(await send(selection))
      finishReason = 'stop'
      const reply = sent.find(event => event.type === 'done').message
      const continued = await CodexChatService.continueReply(requester, threadId, reply.id, () => {})
      const expectedTool = 'tool' in selection ? selection.tool : 'generate_image'
      assert.ok(requests.at(-1)!.tools?.some(tool => tool.function.name === expectedTool))
      assert.match(modelText(requests.at(-1)!), /User's tool selection for this turn only/)
      assert.equal(continued.id, reply.id)
      ChatProfileStore.update(profile.id, 'tool' in selection ? { toolAllowlist: ['get_app_guide'] } : { generationPresetIds: [] })
      await CodexChatService.continueReply(requester, threadId, reply.id, () => {})
      assert.doesNotMatch(modelText(requests.at(-1)!), /User's tool selection/)
      assert.deepEqual(CodexChatStore.findMessage(threadId, sent.find(event => event.type === 'user').message.id)?.toolDirective, 'tool' in selection ? selection : { presetId: second.id, name: 'Second preset' })
      ChatProfileStore.update(profile.id, { toolAllowlist: original.toolAllowlist, generationPresetIds: original.generationPresetIds })
    }
  })

  await t.test('Codex keeps one process and continuous thread memory across ordinary, preset and catalog-tool selections', async st => {
    const childProcess = (await import('node:child_process')).default
    const { EventEmitter } = await import('node:events')
    const { PassThrough } = await import('node:stream')
    const { CodexAppServerClient } = await import('../src/services/codex-chat/codexAppServerClient')
    const { chatFeatureOverrides } = await import('../src/services/codex-chat/codexChatRuntime')
    const { authenticateCodexChatMcpRequest } = await import('../src/services/codex-chat/codexChatAccess')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const authHome = fs.mkdtempSync(path.join(root, 'codex-auth-'))
    fs.writeFileSync(path.join(authHome, 'auth.json'), '{}')
    const previousHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = authHome
    st.after(async () => {
      await CodexChatService.stopAllSessions('Codex directive continuity complete')
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
    })
    const features = new Set(['shell_tool', 'unified_exec', 'hooks', 'plugins', 'apps', 'code_mode_host', 'code_mode', 'browser_use', 'computer_use', 'multi_agent', 'image_generation', 'view_image', 'skill_mcp_dependency_install', 'skill_search', 'skip_host_skill_discovery'])
    st.mock.method(childProcess, 'spawn', (_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })
      setImmediate(() => {
        child.stdout.end(args.includes('features') ? [...features].map(name => `${name} stable false`).join('\n') : '[]')
        child.emit('close', 0)
      })
      return child
    })
    const saved: string[] = []
    const seen: Array<{ previous: number; tools: string[]; input: string }> = []
    let processes = 0
    st.mock.method(CodexAppServerClient, 'start', async (options: Parameters<typeof CodexAppServerClient.start>[0]) => {
      processes += 1
      let memory: string[] = []
      let refresh = true
      let names: string[] = []
      const listTools = async () => {
        const binding = authenticateCodexChatMcpRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: {} } as never, options.env.CONAI_CHAT_MCP_TOKEN!)
        assert.ok(binding)
        const bridge = await openChatMcpBridge(binding.requester!, binding.scopes, binding.toolAllowlist, { generationPresetIds: binding.generationPresetIds, chatContext: binding.chatContext, source: 'codex-chat' })
        try { names = bridge.tools.map(tool => tool.function.name) } finally { await bridge.close() }
      }
      const client = Object.assign(new EventEmitter(), { whenExited: Promise.resolve(), close: () => {}, isAlive: true,
        request: async (method: string, params: Record<string, unknown>) => {
          if (method === 'config/read') return { config: { approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', project_doc_max_bytes: 0,
            features: chatFeatureOverrides(features), mcp_servers: { conai: { url: `http://127.0.0.1:${process.env.PORT || 1666}/mcp` } }, projects: { [options.cwd]: { trust_level: 'untrusted' } } } }
          if (method === 'mcpServerStatus/list') return { data: [{ name: 'conai' }] }
          if (method === 'model/list') return { data: [{ id: 'm', isDefault: true }] }
          if (method === 'thread/start') return { thread: { id: 'directive-memory' } }
          if (method === 'thread/resume') { memory = [...saved]; return {} }
          if (method === 'config/mcpServer/reload') { refresh = true; return {} }
          assert.equal(method, 'turn/start')
          if (refresh) { await listTools(); refresh = false }
          const input = JSON.stringify(params.input)
          seen.push({ previous: memory.length, tools: [...names], input })
          memory.push(input)
          saved.push(input)
          const id = `codex-directive-${seen.length}`
          setImmediate(() => {
            client.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'directive-memory', turnId: id, itemId: id, delta: `Reply ${seen.length}.` } })
            client.emit('notification', { method: 'turn/completed', params: { threadId: 'directive-memory', turn: { id, status: 'completed' } } })
          })
          return { turn: { id } }
        },
      })
      return client as unknown as InstanceType<typeof CodexAppServerClient>
    })
    const codex = ChatProfileStore.create({ name: 'Codex selections', engine: 'codex', mcpEnabled: true, mcpScopes: ['read'], generationPresetIds: [first.id, second.id] })
    const chatId = CodexChatStore.createThread(adminId, 'Codex continuity', 'codex', codex.id)
    const admin = { accountId: adminId, accountType: 'admin' as const }
    for (const selection of [undefined, { presetId: first.id }, undefined, { tool: 'list_files' }, undefined]) {
      await CodexChatService.sendMessage(admin, chatId, `Turn ${seen.length + 1}`, () => {}, undefined, undefined, undefined, undefined, undefined, undefined, { toolDirective: selection })
    }
    assert.equal(processes, 1)
    assert.deepEqual(seen.map(turn => turn.previous), [0, 1, 2, 3, 4])
    assert.ok(seen[1].tools.includes('generate_image'))
    assert.match(seen[1].input, /User's tool selection/)
    assert.ok(seen[3].tools.includes('list_files'))
    assert.match(seen[3].input, /User's tool selection/)
    for (const index of [0, 2, 4]) {
      assert.ok(!seen[index].tools.includes('list_files'))
      assert.doesNotMatch(seen[index].input, /User's tool selection/)
    }
  })
})
