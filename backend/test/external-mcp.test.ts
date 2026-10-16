import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * External MCP servers: stored with their secrets kept back, connected once, their tools offered to the app's chats as
 * `x_<server>_<tool>` under the scope the administrator gave the server, and called through the usual checks.
 */
test('external mcp: settings, connection, tools in chats, calls', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-external-mcp-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const external = await import('../src/services/externalMcp/externalMcpServers')
  t.after(async () => {
    await external.closeExternalMcpServers()
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    ;(await import('../src/database/audioDb')).closeAudioDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-external-mcp-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { getMcpToolScope } = await import('../src/mcp/context')
  const { validateMcpToolArguments, validateMcpRequestBody } = await import('../src/mcp/requestSecurity')
  const { CHAT_SCOPES, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  updateChatSettings({ enabled: true })

  const fixture = path.join(__dirname, 'fixtures', 'external-mcp-echo-server.mjs')
  const echo = (patch: Record<string, unknown> = {}) => ({
    id: 'echo', name: 'Echo', enabled: true, transport: 'stdio' as const, url: null, headers: [], command: process.execPath, args: [fixture],
    env: [{ name: 'ECHO_TOKEN', value: 'secret-1' }], scope: 'read' as const, timeoutSeconds: 30, disabledTools: [], ...patch,
  })

  await t.test('servers are checked when saved; secrets stay on the server and an edit without a value keeps one', () => {
    assert.throws(() => external.saveExternalMcpServer({ ...echo(), id: 'Bad-Id' }), /ID는/)
    assert.throws(() => external.saveExternalMcpServer({ ...echo(), id: 'web', transport: 'http', url: 'ftp://x' }), /http\(s\)/)
    assert.throws(() => external.saveExternalMcpServer({ ...echo(), command: '' }), /명령/)
    assert.throws(() => external.saveExternalMcpServer({ ...echo(), env: [{ name: 'NEW_KEY' }] }), /값을 적어줘/, 'a new secret needs a value')
    external.saveExternalMcpServer({ ...echo(), enabled: false })
    assert.throws(() => external.saveExternalMcpServer({ ...echo(), enabled: false }), /이미 있어/)
    external.saveExternalMcpServer({ ...echo(), enabled: false, env: [{ name: 'ECHO_TOKEN' }] }, 'echo')
    assert.equal(external.loadExternalMcpServers()[0].env.ECHO_TOKEN, 'secret-1', 'kept')
    const [view] = external.externalMcpServerViews()
    assert.deepEqual(view.envNames, ['ECHO_TOKEN'])
    assert.ok(!JSON.stringify(view).includes('secret-1'))
    assert.equal(view.status.state, 'off')
  })

  await t.test('names fit profile tool lists and Claude Code: lowercase, underscores, at most 52 characters', () => {
    assert.equal(external.externalToolName('echo', 'Read-File'), 'x_echo_read_file')
    const long = external.externalToolName('echo', 'a'.repeat(80))
    assert.ok(long.length <= 52 && /^[a-z0-9_]+$/.test(long))
    assert.notEqual(long, external.externalToolName('echo', `${'a'.repeat(79)}b`))
  })

  await t.test('a connected server offers its tools to chats under its scope, never to outside clients', async () => {
    external.setExternalMcpEnabled('echo', { enabled: true })
    await external.refreshExternalMcpServer('echo')
    const [view] = external.externalMcpServerViews()
    assert.equal(view.status.state, 'ready', view.status.error ?? '')
    assert.deepEqual(view.status.tools.map((tool) => tool.name).sort(), ['x_echo_pixel', 'x_echo_read_file', 'x_echo_say'])
    assert.equal(getMcpToolScope('x_echo_say'), 'read')
    const registered = (source: 'llm-chat' | 'http') => Object.keys((createMcpServer({ scopes: [...CHAT_SCOPES] as never, source, toolCatalog: false }) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools)
    assert.ok(registered('llm-chat').includes('x_echo_say'))
    assert.ok(!registered('http').some((name) => name.startsWith('x_')))
    const before = external.externalMcpToolsSignature()
    external.setExternalMcpEnabled('echo', { tool: { remoteName: 'pixel', enabled: false } })
    assert.ok(!registered('llm-chat').includes('x_echo_pixel'), 'a tool switched off is gone')
    assert.notEqual(external.externalMcpToolsSignature(), before, 'Codex sessions see the change')
    external.setExternalMcpEnabled('echo', { tool: { remoteName: 'pixel', enabled: true } })
  })

  await t.test('chats call them through the usual checks; a path argument is the remote server\'s business', async () => {
    ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const reader = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'] })
    const plain = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['organize'] })
    const open = async (profileId: number, replyId: string, scopes: string[] = [...CHAT_SCOPES]) => {
      const threadId = CodexChatStore.createThread(null, replyId, 'llm', profileId)
      const chatContext = { threadId, profileId, kind: 'direct' as const, replyId }
      const close = registerChatReply(chatContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
      const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, scopes as never, null, { chatContext })
      const names = [...bridge.tools.map((tool) => tool.function.name), ...bridge.catalogTools]
      return { bridge, names, close: async () => { close(); await bridge.close() } }
    }
    const chat = await open(reader.id, 'e1')
    try {
      assert.ok(chat.names.includes('x_echo_say'))
      const said = JSON.stringify(await chat.bridge.call('x_echo_say', { text: 'hi' }))
      assert.match(said, /echo: hi \(secret-1\)/, 'the server got its environment')
      assert.match(JSON.stringify(await chat.bridge.call('x_echo_read_file', { path: '/notes/a.md' })), /read \/notes\/a\.md/)
      const pixel = await chat.bridge.call('x_echo_pixel', {}) as { content: Array<{ type: string; text?: string }> }
      assert.deepEqual(pixel.content.map((part) => part.type), ['image', 'text'])
      assert.match(pixel.content[1].text!, /https:\/\/example\.com\/a/)
    } finally { await chat.close() }
    const listed = await open(plain.id, 'e2', ['organize'])
    try { assert.ok(!listed.names.some((name) => name.startsWith('x_')), 'not offered without the read scope') } finally { await listed.close() }
    // Each call checks the profile again: one without the read scope is refused.
    const other = await open(plain.id, 'e2b')
    try { assert.equal((await other.bridge.call('x_echo_say', { text: 'hi' })).isError, true) } finally { await other.close() }
    // A configure-scoped server is for administrators' profiles only.
    external.saveExternalMcpServer({ ...echo(), env: [{ name: 'ECHO_TOKEN' }], scope: 'configure' }, 'echo')
    await external.refreshExternalMcpServer('echo')
    assert.equal(getMcpToolScope('x_echo_say'), 'configure')
    const again = await open(reader.id, 'e3', ['read', 'organize'])
    try { assert.ok(!again.names.includes('x_echo_say')) } finally { await again.close() }
  })

  await t.test('the path rule still holds for app tools, in chats and over HTTP', () => {
    assert.doesNotThrow(() => validateMcpToolArguments({ path: '/x' }, undefined, true))
    assert.throws(() => validateMcpToolArguments({ path: '/x' }), /not allowed/)
    const run = (name: string) => {
      let status = 200
      let passed = false
      validateMcpRequestBody({ method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { path: '/x' } } } } as never,
        { status(code: number) { status = code; return this }, json() { return this } } as never, () => { passed = true })
      return passed ? 200 : status
    }
    assert.equal(run('x_echo_read_file'), 200)
    assert.equal(run('x_unknown_tool'), 400)
    assert.equal(run('read_file_text'), 400)
  })

  await t.test('an HTTP server gets its headers on every request', async () => {
    const http = await import('node:http')
    const { createMcpHandler, McpServer } = await import('@modelcontextprotocol/server')
    const { toNodeHandler } = await import('@modelcontextprotocol/node')
    const { z } = await import('zod')
    const seen: string[] = []
    const site = http.createServer((req, res) => {
      seen.push(String(req.headers.authorization))
      if (req.headers.authorization !== 'Bearer t0k') { res.writeHead(401).end(); return }
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const handler = createMcpHandler(() => {
          const server = new McpServer({ name: 'site', version: '1.0.0' })
          server.registerTool('ping', { description: 'Pong.', inputSchema: z.object({ n: z.number() }) }, async ({ n }) => ({ content: [{ type: 'text' as const, text: `pong ${n}` }] }))
          return server
        })
        res.on('close', () => { void handler.close() })
        void toNodeHandler(handler)(req, res, body ? JSON.parse(body) : undefined)
      })
    })
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => site.close(() => resolve())))
    const url = `http://127.0.0.1:${(site.address() as { port: number }).port}/mcp`
    external.saveExternalMcpServer({ ...echo(), id: 'site', name: 'Site', transport: 'http', url, command: null, args: [], env: [], headers: [{ name: 'Authorization', value: 'Bearer t0k' }] })
    await external.refreshExternalMcpServer('site')
    const view = external.externalMcpServerViews().find((server) => server.id === 'site')!
    assert.equal(view.status.state, 'ready', view.status.error ?? '')
    assert.deepEqual(view.headerNames, ['Authorization'])
    const result = await external.callExternalMcpTool('x_site_ping', { n: 3 })
    assert.deepEqual(result.content, [{ type: 'text', text: 'pong 3' }])
    assert.ok(seen.length > 0 && seen.every((value) => value === 'Bearer t0k'))
    external.deleteExternalMcpServer('site')
  })

  await t.test('a server that cannot start reports why, and its tools are gone', async () => {
    external.saveExternalMcpServer({ ...echo(), env: [{ name: 'ECHO_TOKEN' }], args: [path.join(root, 'missing.mjs')] }, 'echo')
    await external.refreshExternalMcpServer('echo')
    const [view] = external.externalMcpServerViews()
    assert.equal(view.status.state, 'error')
    assert.ok(view.status.error)
    assert.deepEqual(external.externalMcpTools(), [])
    external.deleteExternalMcpServer('echo')
    assert.deepEqual(external.externalMcpServerViews(), [])
  })
})
