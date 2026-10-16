import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Web research for every chat profile: the tools exist only while an engine is set and only for the app's own chats,
 * the research runs keep no tool but the engine's web search, and pages are read as text from public addresses only.
 */
test('chat web research: settings gate, isolated runs, page text', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-web-research-'))
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
  t.after(async () => {
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    ;(await import('../src/database/audioDb')).closeAudioDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-web-research-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { catalogToolNames } = await import('../src/mcp/toolCatalog')
  const { CHAT_SCOPES, loadChatSettings, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const research = await import('../src/services/codex-chat/chatWebResearch')
  const { claudeChatArgs, claudeChatInput, verifyClaudeTools } = await import('../src/services/codex-chat/claudeChatCompletion')
  updateChatSettings({ enabled: true })

  await t.test('the web tools appear only while an engine is set, and only in chats', () => {
    const chatTools = () => catalogToolNames(createMcpServer({ scopes: [...CHAT_SCOPES] as never, source: 'llm-chat' }))
    assert.deepEqual(loadChatSettings().webResearch, { engine: 'off', model: null, dailyLimit: null })
    assert.ok(!chatTools().includes('web_search'))
    updateChatSettings({ webResearch: { engine: 'claude', model: 'sonnet' } })
    assert.ok(chatTools().includes('web_search') && chatTools().includes('web_read'))
    // An outside MCP client would spend the app's Codex or Claude login.
    const http = createMcpServer({ scopes: [...CHAT_SCOPES] as never, source: 'http' }) as unknown as { _registeredTools: Record<string, unknown> }
    assert.ok(!('web_search' in http._registeredTools))
    // A model name that is not a plain id is dropped; the engine stays.
    assert.deepEqual(updateChatSettings({ webResearch: { model: 'x"; rm -rf' } }).webResearch, { engine: 'claude', model: null, dailyLimit: null })
    assert.equal(updateChatSettings({ webResearch: { dailyLimit: 0 } }).webResearch.dailyLimit, null)
    assert.equal(updateChatSettings({ webResearch: { dailyLimit: 30 } }).webResearch.dailyLimit, 30)
    assert.equal(updateChatSettings({ webResearch: { model: 'opus' } }).webResearch.dailyLimit, 30, 'kept when not given')
  })

  await t.test('answers repeat from the cache; past the daily limit an account gets no new search (administrators do)', async () => {
    updateChatSettings({ webResearch: { engine: 'claude', model: null, dailyLimit: 2 } })
    let runs = 0
    const runner = t.mock.method(research.researchRunners, 'claude', async () => { runs += 1; return { text: `answer ${runs}`, tokens: null } })
    const someone = { accountId: 42, accountType: 'guest' as const }
    const first = await research.researchWeb(someone, { query: 'Kai  lighthouse' })
    assert.equal(await research.researchWeb(someone, { query: ' kai lighthouse' }), first, 'the same question, spacing and case aside')
    assert.equal(runs, 1)
    assert.notEqual(await research.researchWeb(someone, { query: 'Kai lighthouse', focus: 'history' }), first, 'another focus asks anew')
    await assert.rejects(research.researchWeb(someone, { query: 'third' }), /하루에 2번/)
    assert.equal(await research.researchWeb(someone, { query: 'KAI lighthouse' }), first, 'a cached answer is not a new search')
    assert.equal(runs, 2)
    await research.researchWeb({ accountId: 43, accountType: 'guest' }, { query: 'Kai lighthouse' })
    assert.equal(runs, 3, 'each account has its own cache and count')
    for (const query of ['a', 'b', 'c']) await research.researchWeb({ accountId: null, accountType: 'admin' }, { query })
    assert.equal(runs, 6, 'no limit for the administrator')
    // A failure is neither kept nor counted.
    runner.mock.mockImplementation(async () => { throw new Error('engine down') })
    await assert.rejects(research.researchWeb({ accountId: 44, accountType: 'guest' }, { query: 'q' }), /engine down/)
    runner.mock.mockImplementation(async () => ({ text: 'recovered', tokens: null }))
    assert.equal(await research.researchWeb({ accountId: 44, accountType: 'guest' }, { query: 'q' }), 'recovered')
    runner.mock.restore()
    updateChatSettings({ webResearch: { dailyLimit: null } })
  })

  await t.test('queued searches reserve the daily allowance and cancellation releases it', async () => {
    updateChatSettings({ webResearch: { engine: 'claude', model: null, dailyLimit: 1 } })
    let releaseBlockers!: () => void
    let started!: () => void
    const blocked = new Promise<void>((resolve) => { releaseBlockers = resolve })
    const bothStarted = new Promise<void>((resolve) => { started = resolve })
    let calls = 0
    const runner = t.mock.method(research.researchRunners, 'claude', async () => {
      calls += 1
      if (calls <= 2) { if (calls === 2) started(); await blocked }
      return { text: 'answer', tokens: null }
    })
    const admin = { accountId: null, accountType: 'admin' as const }
    const blockers = ['reserve-a', 'reserve-b'].map((query) => research.researchWeb(admin, { query }))
    try {
      await bothStarted
      const requester = { accountId: 45, accountType: 'guest' as const }
      const controller = new AbortController()
      const queued = research.researchWeb(requester, { query: 'queued' }, { signal: controller.signal })
      await assert.rejects(research.researchWeb(requester, { query: 'over limit' }), /하루에 1번/)
      const stopped = assert.rejects(queued, { name: 'AbortError' })
      controller.abort()
      await stopped
      const replacement = research.researchWeb(requester, { query: 'replacement' })
      releaseBlockers()
      assert.equal(await replacement, 'answer')
      await assert.rejects(research.researchWeb(requester, { query: 'after success' }), /하루에 1번/)
      assert.equal(calls, 3)
    } finally {
      releaseBlockers()
      await Promise.allSettled(blockers)
      runner.mock.restore()
      updateChatSettings({ webResearch: { dailyLimit: null } })
    }
  })

  await t.test('web_search can file its answer in a writable linked folder, and needs chat.web.use', async () => {
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const { LinkedFileStore } = await import('../src/services/codex-chat/chatLinkedFiles')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { TOOL_FEATURE_PERMISSIONS } = await import('../src/mcp/toolAccess')
    assert.equal(TOOL_FEATURE_PERMISSIONS.web_search, 'chat.web.use')
    assert.equal(TOOL_FEATURE_PERMISSIONS.web_read, 'chat.web.use')

    updateChatSettings({ webResearch: { engine: 'claude', model: null } })
    const runner = t.mock.method(research.researchRunners, 'claude', async () => ({ text: 'Kai keeps the lighthouse. Source: https://example.com', tokens: null }))
    ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'] })
    const threadId = CodexChatStore.createThread(null, '자료', 'llm', profile.id)
    const me = fileOwnerKey(null)
    const notes = FileStoreService.createFolder(me, null, '자료')
    const shelf = FileStoreService.createFolder(me, null, '책장')
    LinkedFileStore.setThreadLinks(threadId, [{ id: notes.id, write: true }, { id: shelf.id, write: false }])
    const chatContext = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'w1' }
    const close = registerChatReply(chatContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [...CHAT_SCOPES] as never, null, { chatContext })
    try {
      const saved = JSON.stringify(await bridge.call('web_search', { query: 'Who keeps the lighthouse?', save_as: '[자료]/등대.md' }))
      assert.match(saved, /Kai keeps the lighthouse/)
      assert.match(saved, /\[자료\]\/등대\.md에 썼어/)
      const file = FileStoreService.findChild(me, notes.id, '등대.md')!
      assert.equal((await FileStoreService.readText(me, file.id)).text, '# Who keeps the lighthouse?\n\nKai keeps the lighthouse. Source: https://example.com\n')
      const taken = JSON.stringify(await bridge.call('web_search', { query: 'Who keeps the lighthouse?', save_as: '[자료]/등대.md' }))
      assert.match(taken, /저장 못 함: .*already exists/, 'the answer still comes back')
      assert.match(JSON.stringify(await bridge.call('web_search', { query: 'q2', save_as: '[책장]/x.md' })), /저장 못 함/)
    } finally {
      close()
      await bridge.close()
      runner.mock.restore()
    }
  })

  await t.test('a Codex research run keeps only the code-mode host (web search runs through it): no shell, no MCP server', () => {
    const args = research.codexResearchArgs(new Set(['shell_tool', 'unified_exec', 'code_mode_host', 'browser_use']), 'C:\\work', 'answer.txt', 'gpt-x')
    assert.equal(args[0], 'exec')
    assert.ok(args.includes('mcp_servers={}'))
    assert.ok(args.includes('features={"shell_tool"=false,"unified_exec"=false,"code_mode_host"=true,"browser_use"=false}'))
    assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only'])
    assert.equal(args.at(-1), '-', 'the prompt goes in on stdin')
  })

  await t.test('a Claude research run gets WebSearch alone; chats get no host tool', () => {
    const chat = claudeChatArgs('sonnet', 's.txt', 'm.json', 4)
    assert.equal(chat[chat.indexOf('--tools') + 1], '')
    assert.equal(chat[chat.indexOf('--allowedTools') + 1], 'mcp__conai__*')
    const run = claudeChatArgs('sonnet', 's.txt', 'm.json', 4, null, undefined, ['WebSearch', 'Bash' as never])
    assert.equal(run[run.indexOf('--tools') + 1], 'WebSearch')
    assert.equal(run[run.indexOf('--allowedTools') + 1], 'mcp__conai__*,WebSearch')
    assert.doesNotThrow(() => verifyClaudeTools(['WebSearch'], [], ['WebSearch']))
    assert.throws(() => verifyClaudeTools(['WebSearch'], []), /격리/)
    assert.throws(() => verifyClaudeTools(['WebSearch', 'WebFetch'], [], ['WebSearch']), /격리/)
    assert.match(claudeChatInput([{ role: 'user', content: 'q' }], 'the available tools (WebSearch)'), /only the available tools \(WebSearch\)/)
    assert.match(claudeChatInput([{ role: 'user', content: 'q' }]), /only the available CoNAI tools/)
  })

  await t.test('pages become readable text: no scripts or navigation, headings and lists kept, entities decoded', () => {
    const page = research.htmlToText('<html><head><title>Kai &amp; Luna</title><script>alert(1)</script></head><body><nav>Home | About</nav><h2>Story</h2><p>First&nbsp;line<br>second &#x2014; third</p><ul><li>one</li><li>two</li></ul><style>p{}</style><footer>© site</footer></body></html>')
    assert.equal(page.title, 'Kai & Luna')
    assert.equal(page.text, '## Story\n\nFirst line\nsecond — third\n\n- one\n- two')
  })

  await t.test('web_read refuses internal addresses and other schemes before connecting', async () => {
    await assert.rejects(research.readWebPage('http://127.0.0.1:2999/api'), /내부 주소/)
    await assert.rejects(research.readWebPage('http://[::1]/'), /내부 주소/)
    await assert.rejects(research.readWebPage('file:///etc/passwd'), /http\(s\)/)
    await assert.rejects(research.readWebPage('https://user:pw@example.com/'), /http\(s\)/)
    updateChatSettings({ webResearch: { engine: 'off' } })
    await assert.rejects(research.readWebPage('https://example.com/'), /꺼져/)
    await assert.rejects(research.researchWeb({ accountId: null, accountType: 'admin' }, { query: 'q' }), /꺼져/)
  })
})
