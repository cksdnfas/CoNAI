import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('judge presets: no-judge parity, original text, tool steering, fallback, logs and follow-ups', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-judge-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatJudgePresetStore, normalizeJudgeItems } = await import('../src/services/codex-chat/chatJudgePresets')
  const { ChatJudgeLogStore } = await import('../src/services/codex-chat/chatJudgeLogs')
  const { endJudgedTurn, judgeBeforeReply, judgeGrantsLore, judgeSetupOf, judgeStateOf, testJudgePreset } = await import('../src/services/codex-chat/chatJudge')
  const { parseJudgeJson } = await import('../src/services/codex-chat/chatJudgeEngine')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { typesafeApiBase } = await import('../src/services/typesafeClient')
  updateChatSettings({ enabled: true, diagnostics: { enabled: true, captureRaw: false } })
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, account_type: 'admin', status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use'] }))
  const providers: Record<string, unknown> = {
    chat: { provider_name: 'chat', display_name: 'Chat', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://chat.invalid/v1', additional_config: '{}' },
    jev: { provider_name: 'jev', display_name: 'Jev', is_enabled: true, provider_type: 'decision_typesafe', base_url: 'https://judge.invalid/v1', additional_config: '{}' },
  }
  t.mock.method(ExternalApiProvider, 'findByName', (name: string) => providers[name] ?? null)
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => 'key')
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })

  const requester = { accountId: 1, accountType: 'admin' as const }
  const db = () => dbModule.getUserSettingsDb()
  const reply = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50 } })
  type Captured = { url: string; body: any }
  /** Routes the judge (`/v1/systemone`) and the chat model (`/chat/completions`) to their own answers. */
  const route = (s: { mock: typeof t.mock }, answers: (body: any) => unknown, chat: (body: any) => Response = () => reply('응, 알았어.')) => {
    const calls: Captured[] = []
    s.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url: String(url), body })
      if (String(url).endsWith('/v1/systemone')) {
        const result = answers(body)
        return result instanceof Response ? result : Response.json({ model: 'jev-1.13.0', answers: result })
      }
      return chat(body)
    })
    return calls
  }
  const toolNames = (body: any) => (body?.tools ?? []).map((tool: any) => tool.function.name) as string[]
  const lastUserText = (body: any) => {
    const users = (body.messages as any[]).filter((message) => message.role === 'user')
    const last = users[users.length - 1]
    return typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
  }
  const preset = ChatJudgePresetStore.create({
    name: '테스트',
    providerName: 'jev',
    items: [
      { id: 'lore', name: '로어', stage: 'before', instructions: 'Lasting fact?', tools: ['save_lore'], directive: '[판단] 로어를 제안해.', yesThreshold: 0.7, noThreshold: 0.3 },
      { id: 'follow-up', name: '후속', stage: 'after', instructions: 'Follow up?', yesThreshold: 0.8, noThreshold: 0.4 },
    ],
    followUp: { maxConsecutive: 1, delaySeconds: 0 },
  })
  const plain = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false })
  const judged = ChatProfileStore.create({ name: '솔', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, judgePresetId: preset.id })
  const threadOf = (profileId: number) => CodexChatStore.findThreadById(CodexChatStore.createThread(1, '판단', 'llm', profileId))!
  const waitFor = async (check: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail(`timed out: ${label}`)
  }

  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-judge-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('the built-in presets are seeded once and items are normalized', () => {
    const names = ChatJudgePresetStore.list().map((entry) => entry.name)
    assert.ok(names.includes('캐릭터 롤플레이') && names.includes('어시스턴트'))
    const [item] = normalizeJudgeItems([{ name: 'x', instructions: 'q', stage: 'after', tools: ['save_lore', 'bad tool'], directive: 'd', yesThreshold: 0.2, noThreshold: 0.9, window: 99 }])
    assert.deepEqual(item.tools, [], 'after-reply items steer no tools')
    assert.equal(item.directive, '')
    assert.equal(item.noThreshold, 0.2, 'the no threshold never passes the yes threshold')
    assert.equal(item.window, 30)
    assert.deepEqual(normalizeJudgeItems([{ instructions: 'a' }, { instructions: 'b' }]).map((entry) => entry.id), ['item-1', 'item-2'])
    assert.equal(typesafeApiBase('https://openrouter.ai/api/v1/systemone'), 'https://openrouter.ai/api')
    assert.deepEqual(parseJudgeJson('```json\n{"a": {"yes": 0.9}}\n```'), { a: { yes: 0.9 } })
  })

  await t.test('only API LLM profiles keep judge settings; a deleted preset leaves profiles unjudged', () => {
    const claude = ChatProfileStore.create({ name: 'Claude', engine: 'claude', model: 'sonnet', judgePresetId: preset.id, judgeProviderName: 'jev' })
    assert.equal(claude.judgePresetId, null)
    assert.equal(claude.judgeProviderName, null)
    assert.equal(judgeSetupOf(claude), null)
    ChatProfileStore.delete(claude.id)
    assert.equal(judgeSetupOf(plain), null)
    assert.equal(judgeSetupOf(judged)?.providerName, 'jev')
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'chat', judgePresetId: 99999 }), /판단 프리셋/)
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'chat', judgeProviderName: 'nope' }), /판단 연결/)
    const spare = ChatJudgePresetStore.create({ name: '임시', items: [] })
    const user = ChatProfileStore.create({ name: '임시 프로필', engine: 'llm', providerName: 'chat', judgePresetId: spare.id })
    assert.deepEqual(ChatJudgePresetStore.find(spare.id)?.profiles.map((entry) => entry.id), [user.id])
    assert.equal(ChatJudgePresetStore.delete(spare.id), true)
    assert.equal(ChatProfileStore.find(user.id)?.judgePresetId, null)
    ChatProfileStore.delete(user.id)
  })

  await t.test('without a judge preset a turn sends exactly the one chat request it always did', async (s) => {
    const calls = route(s, () => assert.fail('judge must not be called'))
    const thread = threadOf(plain.id)
    const message = await LlmChatService.sendMessage(requester, thread, '안녕', () => {})
    assert.equal(message.status, 'completed')
    assert.equal(calls.length, 1)
    assert.ok(toolNames(calls[0].body).includes('save_lore'), 'the chat context offers save_lore as before')
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM chat_judge_runs').get() as { n: number }).n, 0)
  })

  await t.test('the judge reads the original words, never the translation', () => {
    const thread = threadOf(judged.id)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: 'I will visit on Sunday.', display_content: '일요일에 갈게.', tool_calls: [], status: 'completed', error: null })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: 'Great, see you then!', display_content: '좋아, 그때 봐!', tool_calls: [], status: 'completed', error: null })
    const state = judgeStateOf(judged, thread, CodexChatStore.listMessages(thread.id), 6) as { conversation: Array<{ from: string; text: string }> }
    assert.deepEqual(state.conversation.map((entry) => [entry.from, entry.text]), [['user', '일요일에 갈게.'], ['character', 'Great, see you then!']])
  })

  await t.test('a no withholds the steered tool; a yes keeps it, adds the directive and is logged with its outcome', async (s) => {
    let probability = 0.1
    const calls = route(s, (body) => {
      if (body.questions.lore) return { lore: { type: 'noul', noul: probability } }
      return { 'follow-up': { type: 'noul', noul: 0.1 } }
    })
    const thread = threadOf(judged.id)
    await LlmChatService.sendMessage(requester, thread, '오늘 날씨 좋다', () => {})
    const firstChat = calls.find((call) => call.url.endsWith('/chat/completions'))!
    assert.equal(toolNames(firstChat.body).includes('save_lore'), false, 'a confident no withholds save_lore')
    assert.ok(!lastUserText(firstChat.body).includes('[판단]'))
    const judgeCall = calls.find((call) => call.url.endsWith('/v1/systemone'))!
    assert.equal(judgeCall.url, 'https://judge.invalid/v1/systemone')
    assert.deepEqual(judgeCall.body.questions.lore, { type: 'noul', instructions: 'Lasting fact?' })
    assert.equal(judgeCall.body.state.conversation.at(-1).text, '오늘 날씨 좋다')

    probability = 0.92
    calls.length = 0
    const message = await LlmChatService.sendMessage(requester, thread, '나 고양이 알레르기 있어', () => {})
    const chat = calls.find((call) => call.url.endsWith('/chat/completions'))!
    assert.ok(toolNames(chat.body).includes('save_lore'))
    assert.ok(lastUserText(chat.body).endsWith('[판단] 로어를 제안해.'))
    const meta = JSON.parse(CodexChatStore.listMessages(thread.id).find((entry) => entry.id === message.id)!.context_meta!)
    assert.equal(meta.judge.items[0].verdict, 'yes')
    assert.equal(meta.judge.items[0].action, 'offered')
    // The first reply's after-reply judge may have been dropped by the second message (the user wrote first).
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' }).some((run) => run.items.length > 0), 'after-reply run')
    const [run] = ChatJudgeLogStore.list({ threadId: thread.id, stage: 'before' })
    assert.equal(run.items[0].verdict, 'yes')
    assert.deepEqual(run.items[0].outcome, { toolUsed: false, lore: 'none', followUp: null })
    const stats = ChatJudgeLogStore.stats({ presetId: preset.id }).find((entry) => entry.itemId === 'lore')!
    assert.equal(stats.yes, 1)
    assert.equal(stats.no, 1)
    assert.equal(stats.toolUseRate, 0)
  })

  await t.test('a yes on a save_lore item lifts the lore spacing for its reply only', async (s) => {
    route(s, () => ({ lore: { type: 'noul', noul: 0.95 } }))
    const thread = threadOf(judged.id)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '나 다음 주에 이사해', tool_calls: [], status: 'completed', error: null })
    const turn = await judgeBeforeReply({ profile: judged, threadId: thread.id, replyId: 'reply-lore' })
    assert.equal(judgeGrantsLore('reply-lore'), true)
    assert.equal(judgeGrantsLore('another-reply'), false)
    endJudgedTurn(turn, ['save_lore'])
    assert.equal(judgeGrantsLore('reply-lore'), false)
    const [run] = ChatJudgeLogStore.list({ threadId: thread.id })
    assert.equal(run.items[0].outcome.toolUsed, true)
  })

  await t.test('a failed judge leaves the turn exactly as without one and logs the error', async (s) => {
    const calls = route(s, () => new Response('down', { status: 503 }))
    const thread = threadOf(judged.id)
    const message = await LlmChatService.sendMessage(requester, thread, '안녕', () => {})
    assert.equal(message.status, 'completed')
    const chat = calls.find((call) => call.url.endsWith('/chat/completions'))!
    assert.ok(toolNames(chat.body).includes('save_lore'))
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id }).length === 2, 'both runs')
    const [before] = ChatJudgeLogStore.list({ threadId: thread.id, stage: 'before' })
    assert.match(before.error ?? '', /503/)
    assert.equal(before.items[0].decidedBy, 'fallback')
  })

  await t.test('uncertain answers follow the item setting, including asking an LLM again', async (s) => {
    const uncertain = ChatJudgePresetStore.create({ name: '애매', providerName: 'jev', items: [
      { id: 'a', name: 'A', instructions: 'A?', tools: ['save_lore'], uncertain: 'yes' },
      { id: 'b', name: 'B', instructions: 'B?', tools: ['chat_reply_to'], uncertain: 'llm' },
    ] })
    const profile = ChatProfileStore.create({ name: '별', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, judgePresetId: uncertain.id })
    let escalated = 0
    route(s, () => ({ a: { type: 'noul', noul: 0.5 }, b: { type: 'noul', noul: 0.5 } }), (body) => {
      if (body.messages[0].content.startsWith('You are a careful classifier')) {
        escalated += 1
        return reply('{"b": {"yes": 0.1, "no": 0.9}}')
      }
      return reply('응.')
    })
    const thread = threadOf(profile.id)
    await LlmChatService.sendMessage(requester, thread, '음', () => {})
    assert.equal(escalated, 1)
    const [run] = ChatJudgeLogStore.list({ threadId: thread.id })
    assert.deepEqual(run.items.map((item) => [item.itemId, item.verdict, item.decidedBy]), [['a', 'yes', 'setting'], ['b', 'no', 'llm']])
  })

  await t.test('a yes after the reply sends one follow-up; the limit stops a second', async (s) => {
    let chats = 0
    route(s, (body) => (body.questions.lore ? { lore: { type: 'noul', noul: 0.5 } } : { 'follow-up': { type: 'noul', noul: 0.95 } }), (body) => {
      chats += 1
      return reply(lastUserText(body).startsWith('[후속]') ? '아 그리고 하나 더!' : '좋아.')
    })
    const thread = threadOf(judged.id)
    await LlmChatService.sendMessage(requester, thread, '뭐해?', () => {})
    await waitFor(() => CodexChatStore.listMessages(thread.id).filter((entry) => entry.role === 'assistant').length === 2, 'follow-up message')
    await waitFor(() => !LlmChatService.isRunning(thread.id), 'follow-up finished')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const assistants = CodexChatStore.listMessages(thread.id).filter((entry) => entry.role === 'assistant')
    assert.deepEqual(assistants.map((entry) => entry.content), ['좋아.', '아 그리고 하나 더!'])
    assert.equal(chats, 2)
    const [after] = ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' })
    assert.equal(after.items[0].outcome.followUp, 'sent')
  })

  await t.test('the user writing first cancels a follow-up that waits', async (s) => {
    const waiting = ChatJudgePresetStore.update(preset.id, { followUp: { maxConsecutive: 1, delaySeconds: 30, directive: '' } })!
    assert.equal(waiting.followUp.delaySeconds, 30)
    route(s, (body) => (body.questions.lore ? { lore: { type: 'noul', noul: 0.5 } } : { 'follow-up': { type: 'noul', noul: 0.95 } }))
    const thread = threadOf(judged.id)
    await LlmChatService.sendMessage(requester, thread, '첫 번째', () => {})
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' }).length === 1, 'after-reply judged')
    await LlmChatService.sendMessage(requester, thread, '두 번째', () => {})
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' }).length === 2, 'second after-reply judged')
    const roles = CodexChatStore.listMessages(thread.id).map((entry) => entry.role)
    assert.deepEqual(roles, ['user', 'assistant', 'user', 'assistant'])
    ChatJudgePresetStore.update(preset.id, { followUp: { maxConsecutive: 1, delaySeconds: 0, directive: '' } })
    // Leave nothing waiting behind this subtest.
    LlmChatService.stop(thread.id)
  })

  await t.test('testing a draft preset on a chat changes nothing and logs nothing', async (s) => {
    route(s, (body) => Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: 'noul', noul: 0.8 }])))
    const thread = threadOf(plain.id)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '내 생일은 5월이야', tool_calls: [], status: 'completed', error: null })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '기억할게!', tool_calls: [], status: 'completed', error: null })
    const before = (db().prepare('SELECT COUNT(*) AS n FROM chat_judge_runs').get() as { n: number }).n
    const draft = ChatJudgePresetStore.draft({ items: preset.items })
    const turns = await testJudgePreset({ preset: draft, providerName: 'jev', model: '', profile: plain, thread, turns: 2 })
    assert.deepEqual(turns.map((turn) => [turn.role, turn.items[0]?.verdict]), [['user', 'yes'], ['assistant', 'yes']])
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM chat_judge_runs').get() as { n: number }).n, before)
  })
})
