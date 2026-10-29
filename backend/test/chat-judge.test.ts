import './support/testTemp'
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
  const { parseJudgeJson } = await import('../src/services/judge/judgeEngine')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { typesafeApiBase } = await import('../src/services/judge/typesafeClient')
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
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
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

  await t.test('Codex finalization is shared, settles storage failure and holds deletion until persistence ends', async s => {
    const { CodexChatService, finishTurn } = await import('../src/services/codex-chat/codexChatService')
    const threadId = CodexChatStore.createThread(1, 'Finalization', 'codex', null)
    let resolve!: (message: any) => void
    let reject!: (error: unknown) => void
    const finished = new Promise<any>((yes, no) => { resolve = yes; reject = no })
    let release!: () => void
    const held = new Promise<void>(done => { release = done })
    let writes = 0
    let closed = 0
    const turn: any = {
      chatThreadId: threadId, codexThreadId: 'test-finalization', turnId: null, controller: new AbortController(),
      agentMessages: new Map([['answer', 'kept reply']]), commentaryItems: new Set(), toolCalls: new Map(), listeners: new Set(),
      finished, resolveFinished: resolve, rejectFinished: reject, delivery: { close: () => { closed++ } },
      persist: async (reply: any) => {
        await held
        assert.ok(CodexChatStore.findThreadById(threadId), 'the thread survives until its writer is done')
        writes++
        const id = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', ...reply })
        return CodexChatStore.findMessage(threadId, id)
      },
    }
    const session: any = { activeTurns: new Map([[turn.codexThreadId, turn]]), idleTimer: null }
    const finalization = finishTurn(session, turn, 'completed', null)
    assert.equal(finishTurn(session, turn, 'interrupted', null), finalization)
    let deleted = false
    const deletion = CodexChatService.deleteThread(requester, threadId).then(() => { deleted = true })
    await Promise.resolve()
    assert.equal(deleted, false)
    assert.ok(CodexChatService.isRunning(threadId))
    release()
    assert.equal((await finished).content, 'kept reply')
    await deletion
    assert.equal(writes, 1)
    assert.equal(closed, 1)
    assert.equal(CodexChatStore.findThreadById(threadId), undefined)
    assert.equal(CodexChatService.isRunning(threadId), false)
    clearTimeout(session.idleTimer)

    const failedThread = CodexChatStore.createThread(1, 'Failed finalization', 'codex', null)
    const failure = new Error('storage unavailable')
    const failed = new Promise<any>((yes, no) => { resolve = yes; reject = no })
    const rejected = assert.rejects(failed, failure)
    const failedEvents: string[] = []
    const broken: any = { ...turn, chatThreadId: failedThread, finalization: undefined, finished: failed,
      controller: new AbortController(), resolveFinished: resolve, rejectFinished: reject,
      listeners: new Set([(event: any) => failedEvents.push(event.type)]),
      delivery: { close: () => { closed++; throw new Error('cleanup also failed') } },
      persist: async () => { throw failure } }
    session.activeTurns.set(broken.codexThreadId, broken)
    await finishTurn(session, broken, 'completed', null)
    await rejected
    assert.deepEqual(failedEvents, [], 'only the caller reports the rejected completion')
    assert.equal(closed, 2)
    assert.ok(broken.controller.signal.aborted)
    assert.equal(session.activeTurns.size, 0)
    assert.equal(CodexChatService.isRunning(failedThread), false)
    clearTimeout(session.idleTimer)

    let translating!: () => void
    const translatingStarted = new Promise<void>(done => { translating = done })
    const interrupted = new Promise<any>((yes, no) => { resolve = yes; reject = no })
    const translated: any = { ...turn, chatThreadId: failedThread, finalization: undefined, finished: interrupted,
      controller: new AbortController(), resolveFinished: resolve, rejectFinished: reject, persist: undefined,
      translate: () => new Promise((_resolve, rejectTranslation) => {
        translating()
        translated.controller.signal.addEventListener('abort', () => rejectTranslation(new Error('cancelled')), { once: true })
      }) }
    session.activeTurns.set(translated.codexThreadId, translated)
    const interruptedFinalization = finishTurn(session, translated, 'completed', null)
    await translatingStarted
    await CodexChatService.interrupt(requester, failedThread)
    assert.equal((await interrupted).status, 'interrupted')
    assert.equal(CodexChatStore.latestMessage(failedThread)?.content, 'kept reply')
    await interruptedFinalization
    clearTimeout(session.idleTimer)

    const stored = CodexChatStore.latestMessage(failedThread)!
    const completed = new Promise<any>((yes, no) => { resolve = yes; reject = no })
    const completedEvents: string[] = []
    const cleanupFailure: any = { ...turn, chatThreadId: failedThread, finalization: undefined, finished: completed,
      controller: new AbortController(), resolveFinished: resolve, rejectFinished: reject,
      listeners: new Set([(event: any) => completedEvents.push(event.type)]),
      persist: async () => stored, delivery: { close: () => { throw new Error('cleanup failed after storing') } } }
    session.activeTurns.set(cleanupFailure.codexThreadId, cleanupFailure)
    await finishTurn(session, cleanupFailure, 'completed', null)
    assert.equal(await completed, stored, 'a stored reply stays successful even if cleanup fails')
    assert.deepEqual(completedEvents, ['done'])
    assert.equal(CodexChatService.isRunning(failedThread), false)
  })

  await t.test('rejected sends never resume waiting tasks; successful delivery notifies after the row exists', async s => {
    const { ChatTaskRunner, ChatTaskStore } = await import('../src/services/codex-chat/chatTasks')
    const { onChatUserSend } = await import('../src/services/codex-chat/chatSendEvents')
    ChatTaskRunner.start()
    const thread = threadOf(plain.id)
    const task = ChatTaskStore.create(thread.id, 'Wait for input', [{ title: 'Continue' }])
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'user' })
    let notifications = 0
    const unsubscribe = onChatUserSend(id => {
      if (id !== thread.id) return
      notifications++
      assert.ok(CodexChatStore.latestMessage(id), 'delivery is already persisted')
      assert.equal(ChatTaskStore.find(task.id)?.status, 'running')
      ChatTaskStore.update(task.id, { status: 'paused' })
    })
    s.after(unsubscribe)
    for (const send of [
      () => LlmChatService.sendMessage(requester, thread, ' ', () => {}),
      () => LlmChatService.sendMessage(requester, thread, 'invalid attachment', () => {}, [-1]),
      () => LlmChatService.sendMessage(requester, thread, 'invalid quote', () => {}, undefined, undefined, undefined, undefined, -1),
    ]) {
      await assert.rejects(send())
      assert.equal(ChatTaskStore.find(task.id)?.status, 'waiting')
      assert.equal(notifications, 0)
    }
    const failedSave = s.mock.method(CodexChatStore, 'addMessage', () => { throw new Error('save failed') })
    await assert.rejects(LlmChatService.sendMessage(requester, thread, 'not saved', () => {}), /save failed/)
    failedSave.mock.restore()
    assert.equal(ChatTaskStore.find(task.id)?.status, 'waiting')
    assert.equal(notifications, 0)
    route(s, () => ({}), () => reply('done'))
    const first = LlmChatService.sendMessage(requester, thread, 'accepted', () => {})
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'user' })
    await assert.rejects(LlmChatService.sendMessage(requester, thread, 'busy', () => {}), /진행 중/)
    assert.equal(ChatTaskStore.find(task.id)?.status, 'waiting')
    assert.equal(notifications, 1)
    // Do not let this test's task runner schedule a continuation when the accepted reply finishes.
    ChatTaskStore.update(task.id, { status: 'paused' })
    await first
  })

  await t.test('plugin judge calls follow caller deadlines and do not cap multi-option distributions', async s => {
    const { askJudge, choiceQuestion, resolveJudgeConnection, withJudgeCallerSettings } = await import('../src/services/judge/judgeEngine')
    const durations: number[] = []
    const originalTimeout = AbortSignal.timeout
    s.mock.method(AbortSignal, 'timeout', (ms: number) => { durations.push(ms); return originalTimeout(ms) })
    const originalTimer = globalThis.setTimeout
    s.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => { durations.push(Number(args[1])); return originalTimer(...args) })
    const options = Array.from({ length: 16 }, (_, i): [string, string, boolean] => [`option_${i}_${'x'.repeat(25)}`, 'description', true])
    const question = choiceQuestion('choice', 'Choose', options)
    const distribution = Object.fromEntries(options.map(([label]) => [label, 1 / 16]))
    const calls = route(s, () => ({ choice: { type: 'choice', choice: options[0][0], probabilities: distribution, confidence: 1 } }),
      () => reply(JSON.stringify({ choice: distribution })))
    for (const provider of ['chat', 'jev']) {
      durations.length = 0
      const result = await withJudgeCallerSettings({ timeoutMs: 180000 }, () => askJudge(resolveJudgeConnection(provider, 'model'), {}, [question]))
      assert.equal(result.answers.get('choice')?.distribution && Object.keys(result.answers.get('choice')!.distribution!).length, 16)
      assert.ok(durations.includes(180000))
      assert.ok(!durations.includes(20000) && !durations.includes(60000), 'no shorter native fallback overrides the caller')
    }
    assert.equal(calls.find(call => call.url.endsWith('/chat/completions'))!.body.max_tokens, undefined)
    durations.length = 0
    await askJudge(resolveJudgeConnection('chat', 'model'), {}, [question])
    assert.equal(calls.at(-1)!.body.max_tokens, undefined, 'native judging also keeps the connection allowance')
    assert.ok(!durations.includes(60000), 'native judging has no feature-specific timeout')
    durations.length = 0
    await withJudgeCallerSettings({}, () => askJudge(resolveJudgeConnection('jev', 'model'), {}, [question]))
    assert.deepEqual(durations, [20000], 'omitted TypeSafe timeout retains its native engine default')
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

  await t.test('native judging accepts repetitive JSON structure but stops looping output', async s => {
    const { askJudge, resolveJudgeConnection, yesNoQuestion } = await import('../src/services/judge/judgeEngine')
    const questions = Array.from({ length: 60 }, (_, i) => yesNoQuestion(`question_${i}`, `Question ${i}`))
    const json = JSON.stringify(Object.fromEntries(questions.map(question => [question.id, { yes: 0.5, no: 0.5 }])))
    let looping = false
    let trailingWhitespace = false
    let cancelled = false
    s.mock.method(globalThis, 'fetch', async () => {
      let offset = 0
      let count = 0
      return new Response(new ReadableStream({
        pull(controller) {
          const content = looping ? '"question_0":{"yes":0.5,"no":0.5},'.repeat(12)
            : offset < json.length ? json.slice(offset, offset += 37) : trailingWhitespace ? ' '.repeat(100) : ''
          if (!content || ++count > 400) { controller.close(); return }
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
        },
        cancel() { cancelled = true },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const connection = resolveJudgeConnection('chat', 'judge-loop-check')
    const result = await askJudge(connection, {}, questions)
    assert.equal(result.answers.size, 60)
    assert.ok([...result.answers.values()].every(answer => answer.probability === 0.5))
    trailingWhitespace = true
    const withWhitespace = await askJudge(connection, {}, questions)
    assert.equal(withWhitespace.answers.size, 60, 'a complete JSON answer survives trailing whitespace stopped by the guard')
    assert.equal(cancelled, true)
    cancelled = false
    looping = true
    await assert.rejects(askJudge(connection, {}, questions), /반복 출력/)
    assert.equal(cancelled, true)
  })

  await t.test('a judge with no model of its own asks the judge representative model, whose row cannot be deleted while it points there', async () => {
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const modelless = ChatJudgePresetStore.create({ name: '모델 없음', items: [] })
    const profile = ChatProfileStore.create({ name: '기본 판단', engine: 'llm', providerName: 'chat', judgePresetId: modelless.id })
    assert.equal(judgeSetupOf(profile), null, 'no model anywhere: no judge')
    const jev = ModelSlotStore.list().find((slot) => slot.kind === 'model' && slot.providerName === 'jev')!
    ModelSlotStore.setDefaultJudge(jev.id, true)
    assert.equal(ModelSlotStore.defaultJudgeTarget()?.id, jev.id)
    assert.equal(judgeSetupOf(profile)?.providerName, 'jev')
    assert.throws(() => ModelSlotStore.delete(jev.id), /대표모델 판단/)
    const chatRow = ModelSlotStore.list().find((slot) => slot.kind === 'model' && slot.providerName === 'chat')!
    ModelSlotStore.setDefaultJudge(chatRow.id, true)
    assert.equal(ModelSlotStore.find(ModelSlotStore.routeId('judge')!)?.targetSlotId, chatRow.id, 'the judge route points at one row')
    assert.equal(judgeSetupOf(profile)?.providerName, 'chat')
    ModelSlotStore.setDefaultJudge(chatRow.id, false)
    assert.equal(ModelSlotStore.defaultJudgeTarget(), null)
    assert.equal(judgeSetupOf(profile), null)
    ChatProfileStore.delete(profile.id)
    ChatJudgePresetStore.delete(modelless.id)
  })

  await t.test('every engine keeps judge settings; a deleted preset leaves profiles unjudged', () => {
    const claude = ChatProfileStore.create({ name: 'Claude', engine: 'claude', model: 'sonnet', judgePresetId: preset.id, judgeProviderName: 'jev' })
    assert.equal(claude.judgePresetId, preset.id)
    assert.equal(judgeSetupOf(claude)?.providerName, 'jev')
    ChatProfileStore.delete(claude.id)
    assert.equal(judgeSetupOf(plain), null)
    assert.equal(judgeSetupOf(judged)?.providerName, 'jev')
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'chat', judgePresetId: 99999 }), /판단 프리셋/)
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'chat', judgeProviderName: 'nope' }), /연결을 찾을 수 없어/)
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

  await t.test('interrupting input translation cancels preparation in direct edits and group sends', async (s) => {
    const { mockModelRows } = await import('./modelRowMocks')
    const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
    const { ChatTaskStore } = await import('../src/services/codex-chat/chatTasks')
    mockModelRows(s, { 1: ['chat', 'chat-model'], 2: ['chat', 'translator-model'] }, 1)
    const profile = ChatProfileStore.create({ name: '번역 중단', engine: 'llm', modelSlotId: 1, translationSlotId: 2, summaryEnabled: false, mcpEnabled: false })
    let block = false
    let started: () => void = () => {}
    let translationSignal: AbortSignal | null = null
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== 'POST') return new Response('', { status: 404 })
      const body = JSON.parse(String(init.body))
      if (block && body.model === 'translator-model') {
        translationSignal = init.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          translationSignal!.addEventListener('abort', () => reject(translationSignal!.reason), { once: true })
          started()
        })
      }
      return reply(body.model === 'translator-model' ? 'Hello' : '응, 알았어.')
    })
    for (const mode of ['send', 'edit', 'group'] as const) {
      const thread = mode === 'group'
        ? GroupChatService.create(requester, { profileIds: [profile.id, plain.id], representativeId: profile.id })
        : threadOf(profile.id)
      let messageId = 0
      if (mode === 'edit') {
        block = false
        await LlmChatService.sendMessage(requester, thread, '처음 메시지', () => {})
        await waitFor(() => !LlmChatService.isRunning(thread.id), 'initial reply stored')
        messageId = CodexChatStore.listMessages(thread.id).find((message) => message.role === 'user')!.id
      }
      const translating = new Promise<void>((resolve) => { started = resolve })
      const task = mode === 'group' ? ChatTaskStore.create(thread.id, 'Wait for user', [{ title: 'Continue' }]) : null
      if (task) ChatTaskStore.update(task.id, { status: 'waiting', wait: 'user' })
      block = true
      const pending = mode === 'group'
        ? GroupChatService.sendMessage(requester, thread.id, '안녕', () => {})
        : mode === 'edit'
          ? LlmChatService.rewriteMessage(requester, thread, messageId, '수정 메시지', () => {})
          : LlmChatService.sendMessage(requester, thread, '안녕', () => {})
      await translating
      if (mode === 'group') {
        const stopped = assert.rejects(pending, { name: 'AbortError' })
        await GroupChatService.stop(thread.id)
        await stopped
        assert.equal(CodexChatStore.listMessages(thread.id).length, 0)
        assert.equal(ChatTaskStore.find(task!.id)?.status, 'waiting', 'cancelled preparation never resumes the room task')
      } else {
        LlmChatService.interrupt(thread.id)
        assert.equal((await pending)!.status, 'interrupted')
        await waitFor(() => !LlmChatService.isRunning(thread.id), 'interrupted reply stored')
      }
      assert.equal(translationSignal!.aborted, true)
    }
    ChatProfileStore.delete(profile.id)
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
    // The tool list stays the same every turn (the prompt cache); a withheld tool is named in the directive instead.
    assert.equal(toolNames(firstChat.body).includes('save_lore'), true, 'the tool list does not change with the verdict')
    assert.match(lastUserText(firstChat.body), /이 도구를 쓰지 마: save_lore/, 'a confident no withholds save_lore')
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

  await t.test('the user\'s flags come before a no: the withheld tool is only named, never refused', async (s) => {
    const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
    const flag = ChatFlagStore.create(requester, { name: '기억', content: '이번 이야기를 save_lore로 로어에 남겨' })
    let chatCalls = 0
    const calls = route(s, (body) => (body.questions.lore ? { lore: { type: 'noul', noul: 0.1 } } : { 'follow-up': { type: 'noul', noul: 0.1 } }), () => {
      chatCalls += 1
      if (chatCalls > 1) return reply('남겨 뒀어.')
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-lore', type: 'function', function: { name: 'save_lore', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })
    })
    const thread = threadOf(judged.id)
    await LlmChatService.sendMessage(requester, thread, '오늘 날씨 좋다', () => {}, undefined, [flag.id])
    const chats = calls.filter((call) => call.url.endsWith('/chat/completions'))
    const first = lastUserText(chats[0].body)
    assert.match(first, /이 도구를 쓰지 마: save_lore/)
    assert.match(first, /\[우선순위\]/, 'the judge says the flag wins')
    assert.ok(first.indexOf('[사용자 지시') < first.indexOf('[판단]'))
    const toolResult = (chats[1].body.messages as any[]).find((message) => message.role === 'tool')
    assert.ok(toolResult, 'the tool call ran')
    assert.doesNotMatch(JSON.stringify(toolResult.content), /not available in this reply/)

    // Without a flag the same no still refuses the call.
    chatCalls = 0
    calls.length = 0
    await LlmChatService.sendMessage(requester, threadOf(judged.id), '오늘 날씨 좋다', () => {})
    const plainChats = calls.filter((call) => call.url.endsWith('/chat/completions'))
    assert.doesNotMatch(lastUserText(plainChats[0].body), /\[우선순위\]/)
    assert.match(JSON.stringify((plainChats[1].body.messages as any[]).find((message) => message.role === 'tool').content), /not available in this reply/)
    ChatFlagStore.delete(requester, flag.id)
  })

  await t.test('a yes on a save_lore item lifts the lore spacing for its reply only', async (s) => {
    route(s, () => ({ lore: { type: 'noul', noul: 0.95 } }))
    const thread = threadOf(judged.id)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '나 다음 주에 이사해', tool_calls: [], status: 'completed', error: null })
    const turn = await judgeBeforeReply({ profile: judged, threadId: thread.id, replyId: 'reply-lore', availableTools: ['save_lore'] })
    assert.equal(judgeGrantsLore('reply-lore'), true)
    assert.equal(judgeGrantsLore('another-reply'), false)
    endJudgedTurn(turn, ['save_lore'])
    assert.equal(judgeGrantsLore('reply-lore'), false)
    const [run] = ChatJudgeLogStore.list({ threadId: thread.id })
    assert.equal(run.items[0].outcome.toolUsed, true)
  })

  await t.test('tools the turn does not offer need no judge request or directive', async (s) => {
    const imageOnly = ChatJudgePresetStore.create({ name: '이미지', providerName: 'jev', items: [
      { id: 'image', name: '이미지', instructions: 'Show an image?', tools: ['generate_image*'], directive: '[판단] 이미지를 그려.' },
    ] })
    const profile = ChatProfileStore.create({ name: '달', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, judgePresetId: imageOnly.id })
    const calls = route(s, () => ({ image: { type: 'noul', noul: 0.95 } }))
    const thread = threadOf(profile.id)
    await LlmChatService.sendMessage(requester, thread, '바다 사진 보여줘', () => {})
    const chat = calls.find((call) => call.url.endsWith('/chat/completions'))!
    assert.ok(!lastUserText(chat.body).includes('[판단]'), 'no directive for a tool the profile cannot offer')
    assert.equal(ChatJudgeLogStore.list({ threadId: thread.id }).length, 0)
    assert.equal(calls.filter((call) => !call.url.endsWith('/chat/completions')).length, 0)
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
      { id: 'b', name: 'B', instructions: 'B?', tools: ['save_lore'], uncertain: 'llm' },
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
    const { wakeChatRoom } = await import('../src/services/codex-chat/chatRoomWake')
    const wake = await wakeChatRoom({ requester, threadId: thread.id, instruction: '뭐해?', routing: { source: 'plugin', id: null, name: 'Judge regression' } })
    assert.equal(wake.replies.length, 2, 'a plugin wake includes the completed native follow-up')
    assert.equal(LlmChatService.isRunning(thread.id), false)
    const assistants = CodexChatStore.listMessages(thread.id).filter((entry) => entry.role === 'assistant')
    assert.deepEqual(assistants.map((entry) => entry.content), ['좋아.', '아 그리고 하나 더!'])
    assert.equal(chats, 2)
    const [after] = ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' })
    assert.equal(after.items[0].outcome.followUp, 'sent')
  })

  await t.test('a completed plugin primary reply survives a failed native follow-up', async s => {
    let replies = 0
    route(s, body => body.questions.lore ? { lore: { type: 'noul', noul: 0.5 } } : { 'follow-up': { type: 'noul', noul: 0.95 } },
      () => ++replies === 1 ? reply('Completed primary') : Response.json({ error: { message: 'invalid request' } }, { status: 400 }))
    const { runPluginProfile } = await import('../src/services/plugins/pluginProfileRun')
    const result = await runPluginProfile({ pluginId: 'judge-regression', pluginName: 'Judge regression', requester, profile: judged,
      input: { requestId: 'failed-follow-up', profileId: judged.id, mode: 'profile', message: 'Reply, then follow up.' }, signal: AbortSignal.timeout(5000) })
    assert.equal(result.text, 'Completed primary')
    assert.equal(result.profileRun?.followUpFailed, true)
    assert.equal(result.profileRun?.messageIds.length, 1, 'the native headless writer stores no failed message')
    assert.equal(replies, 2, 'a failed follow-up must not repeatedly judge the same primary reply')
  })

  await t.test('an outside assistant message settles a delayed follow-up instead of hanging plugin drain', async s => {
    const { drainJudgeFollowUps } = await import('../src/services/codex-chat/chatJudge')
    ChatJudgePresetStore.update(preset.id, { followUp: { maxConsecutive: 1, delaySeconds: 1, directive: '' } })
    s.after(() => ChatJudgePresetStore.update(preset.id, { followUp: { maxConsecutive: 1, delaySeconds: 0, directive: '' } }))
    route(s, body => body.questions.lore ? { lore: { type: 'noul', noul: 0.5 } } : { 'follow-up': { type: 'noul', noul: 0.95 } })
    const thread = threadOf(judged.id)
    await LlmChatService.sendMessage(requester, thread, '첫 답변', () => {})
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'after' }).length === 1, 'delayed follow-up judged')
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: 'External generation result', tool_calls: [], status: 'completed', error: null })
    await drainJudgeFollowUps(thread.id, AbortSignal.timeout(2500))
    assert.equal(CodexChatStore.listMessages(thread.id).filter(m => m.role === 'assistant').length, 2)
  })

  await t.test('follow-up drain settles synchronous writer errors; normal cancellation does not abort a writing reply', async s => {
    const { drainJudgeFollowUps, judgeAfterReply, cancelJudgeFollowUp } = await import('../src/services/codex-chat/chatJudge')
    route(s, () => ({ 'follow-up': { type: 'noul', noul: 0.95 } }))
    const warnings = s.mock.method(console, 'warn', () => {})
    const thread = threadOf(judged.id)
    const id = CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: 'Primary reply', tool_calls: [], status: 'completed', error: null })
    const message = CodexChatStore.findMessage(thread.id, id)!
    judgeAfterReply({ profile: judged, threadId: thread.id, message, write: () => { throw new Error('synchronous writer failure') } })
    await drainJudgeFollowUps(thread.id, AbortSignal.timeout(2500))
    assert.ok(warnings.mock.calls.some(call => String(call.arguments).includes('synchronous writer failure')))
    let writeSignal: AbortSignal | undefined, finish!: () => void
    const writing = new Promise<null>(resolve => { finish = () => resolve(null) })
    judgeAfterReply({ profile: judged, threadId: thread.id, message, write: (_directive, signal) => { writeSignal = signal; return writing } })
    await waitFor(() => Boolean(writeSignal), 'follow-up writer starts')
    cancelJudgeFollowUp(thread.id)
    assert.equal(writeSignal!.aborted, false, 'normal cancel only affects judging/delayed replies, not the writing reply')
    finish()
    await drainJudgeFollowUps(thread.id, AbortSignal.timeout(2500))
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
