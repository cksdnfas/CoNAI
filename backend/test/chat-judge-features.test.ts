import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('judge beyond turn items: group rooms, status fields, lore and recall, expression assets', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-judge-features-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatJudgePresetStore } = await import('../src/services/codex-chat/chatJudgePresets')
  const { ChatJudgeLogStore } = await import('../src/services/codex-chat/chatJudgeLogs')
  const { JUDGE_OPTION_DEFAULTS } = await import('../src/services/codex-chat/chatJudgeDefaults')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
  const { foldBlockState, parseBlockEdits } = await import('../src/services/codex-chat/chatBlockState')
  const { ChatLorebookStore, selectLoreEntries } = await import('../src/services/codex-chat/chatLorebook')
  const { keyedLoreEntries, booksForRequest } = await import('../src/services/codex-chat/chatLoreContext')
  const { ChatSummaryStore } = await import('../src/services/codex-chat/chatMemory')
  const { recalledSegments } = await import('../src/services/codex-chat/llmChatContext')
  const { judgeExpression } = await import('../src/services/codex-chat/chatJudgeAssets')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
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
  const reply = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50 } })
  type Captured = { url: string; body: any }
  /** Routes the judge (`/v1/systemone`) and the chat model (`/chat/completions`) to their own answers. */
  const route = (s: { mock: typeof t.mock }, answers: (body: any) => unknown, chat: (body: any) => Response = () => reply('응, 알았어.')) => {
    const calls: Captured[] = []
    s.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url: String(url), body })
      if (String(url).endsWith('/v1/systemone')) return Response.json({ model: 'jev-1.13.0', answers: answers(body) })
      return chat(body)
    })
    return calls
  }
  const judgeCalls = (calls: Captured[]) => calls.filter((call) => call.url.endsWith('/v1/systemone'))
  /** A Jev choice answer over these probabilities. */
  const choice = (probabilities: Record<string, number>) => {
    const [top] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
    return { type: 'choice', choice: top[0], probabilities, confidence: top[1] }
  }
  const waitFor = async (check: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail(`timed out: ${label}`)
  }

  const preset = ChatJudgePresetStore.create({ name: '방 판단', providerName: 'jev', items: [], context: { ...JUDGE_OPTION_DEFAULTS.context, lore: { ...JUDGE_OPTION_DEFAULTS.context.lore, enabled: false }, recall: { enabled: false, threshold: 0.35 } } })
  const member = (name: string, extra: Record<string, unknown> = {}) => ChatProfileStore.create({ name, tagline: `${name}의 한 줄 소개`, engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, ...extra })
  const luna = member('루나')
  const kai = member('카이')
  const mira = member('미라')
  const roomOf = () => {
    const room = GroupChatService.create(requester, { profileIds: [luna.id, kai.id, mira.id], representativeId: luna.id, userProfileId: null })
    GroupChatService.updateRoom(requester, room.id, { judgePresetId: preset.id })
    return room.id
  }
  const label = (profile: { id: number }) => `m${profile.id}`
  const speakers = (threadId: number) => CodexChatStore.listMessages(threadId).filter((message) => message.role === 'assistant').map((message) => message.speaker_profile_id)

  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-judge-features-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('preset sections fall back to their defaults and rooms reference a preset until it is deleted', () => {
    const spare = ChatJudgePresetStore.create({ name: '부분', room: { route: { enabled: false } } as never, fields: { threshold: 5 } as never })
    assert.equal(spare.room.route.enabled, false)
    assert.equal(spare.room.next.enabled, true)
    assert.equal(spare.room.next.continueThreshold, JUDGE_OPTION_DEFAULTS.room.next.continueThreshold)
    assert.equal(spare.fields.threshold, 1, 'a threshold is held to 0..1')
    assert.equal(spare.context.lore.candidates, JUDGE_OPTION_DEFAULTS.context.lore.candidates)
    const room = GroupChatService.create(requester, { profileIds: [luna.id, kai.id], representativeId: luna.id, userProfileId: null })
    const updated = GroupChatService.updateRoom(requester, room.id, { judgePresetId: spare.id })
    assert.equal(updated.group.judgePresetId, spare.id)
    assert.deepEqual(ChatJudgePresetStore.find(spare.id)?.rooms.map((entry) => entry.id), [room.id])
    assert.throws(() => GroupChatService.updateRoom(requester, room.id, { judgePresetId: 99999 }), /판단 프리셋/)
    ChatJudgePresetStore.delete(spare.id)
    assert.equal(GroupChatService.getThread(requester, room.id).group.judgePresetId, null)
  })

  await t.test('a message naming no one goes to the member the judge picks, and the room waits when it says so', async (s) => {
    const calls = route(s, (body) => {
      if (body.questions.route) return { route: choice({ [label(luna)]: 0.1, [label(kai)]: 0.8, [label(mira)]: 0.1 }) }
      return { next: choice({ [label(luna)]: 0.05, [label(mira)]: 0.05, wait: 0.9 }) }
    })
    const threadId = roomOf()
    await GroupChatService.sendMessage(requester, threadId, '다들 뭐해?', () => {})
    assert.deepEqual(speakers(threadId), [kai.id], 'the judge picked 카이 over the representative')
    const user = CodexChatStore.listMessages(threadId).find((message) => message.role === 'user')!
    assert.deepEqual(user.routing?.recipients, [kai.id])
    const [routeCall, nextCall] = judgeCalls(calls)
    assert.deepEqual(Object.keys(routeCall.body.questions.route.criteria).sort(), [label(luna), label(kai), label(mira)].sort())
    assert.ok(routeCall.body.questions.route.criteria[label(kai)].startsWith('카이'))
    assert.equal(routeCall.body.state.conversation.at(-1).text, '다들 뭐해?')
    assert.ok(!(label(kai) in nextCall.body.questions.next.criteria), 'the member who just spoke is not asked to go on')
    assert.ok('wait' in nextCall.body.questions.next.criteria)
    const runs = ChatJudgeLogStore.list({ threadId })
    assert.deepEqual(runs.map((run) => [run.stage, run.items[0].action, run.profileId]).reverse(), [['route', 'route', null], ['next', 'wait', null]])
  })

  await t.test('an @mention or an unsure judge leaves routing as it was', async (s) => {
    const calls = route(s, (body) => {
      if (body.questions.route) return { route: choice({ [label(luna)]: 0.34, [label(kai)]: 0.33, [label(mira)]: 0.33 }) }
      return { next: choice({ [label(kai)]: 0.1, [label(mira)]: 0.1, [label(luna)]: 0.1, wait: 0.7 }) }
    })
    const threadId = roomOf()
    await GroupChatService.sendMessage(requester, threadId, '@미라 안녕', () => {})
    assert.deepEqual(speakers(threadId), [mira.id])
    assert.ok(judgeCalls(calls).every((call) => !call.body.questions.route), 'a named member needs no routing')
    calls.length = 0
    await GroupChatService.sendMessage(requester, threadId, '음…', () => {})
    assert.deepEqual(speakers(threadId), [mira.id, luna.id], 'below the minimum the representative answers')
  })

  await t.test('the judge keeps the room going within its chain limit', async (s) => {
    const calls = route(s, (body) => {
      if (body.questions.route) return { route: choice({ [label(luna)]: 0.1, [label(kai)]: 0.8, [label(mira)]: 0.1 }) }
      const options = Object.keys(body.questions.next.criteria).filter((key) => key !== 'wait')
      // Whoever did not just speak: 미라 first, else 루나; going on is likely.
      const next = options.includes(label(mira)) ? label(mira) : label(luna)
      return { next: choice({ ...Object.fromEntries(options.map((key) => [key, 0.05])), [next]: 0.8, wait: 0.1 }) }
    })
    const threadId = roomOf()
    GroupChatService.updateRoom(requester, threadId, { chainLimit: 2 })
    await GroupChatService.sendMessage(requester, threadId, '이야기 좀 해줘', () => {})
    assert.deepEqual(speakers(threadId), [kai.id, mira.id, luna.id], 'two more members spoke on, then the limit stopped the room')
    assert.equal(judgeCalls(calls).filter((call) => call.body.questions.next).length, 2, 'not asked again once the limit is reached')
    const nextRuns = ChatJudgeLogStore.list({ threadId, stage: 'next' })
    assert.ok(nextRuns.every((run) => run.items[0].action === 'next'))
  })

  await t.test('a member answering another member wakes no one by itself: the judge decides, here to wait', async (s) => {
    let nextAsked = 0
    route(s, (body) => {
      if (body.questions.route) return { route: choice({ [label(luna)]: 0.1, [label(kai)]: 0.8, [label(mira)]: 0.1 }) }
      nextAsked += 1
      const options = Object.keys(body.questions.next.criteria).filter((key) => key !== 'wait')
      // First: 미라 speaks on. Then: the room waits.
      if (nextAsked === 1) return { next: choice({ ...Object.fromEntries(options.map((key) => [key, 0.05])), [label(mira)]: 0.85, wait: 0.05 }) }
      return { next: choice({ ...Object.fromEntries(options.map((key) => [key, 0.05])), wait: 0.9 }) }
    })
    const threadId = roomOf()
    await GroupChatService.sendMessage(requester, threadId, '카이 생각은?', () => {})
    assert.deepEqual(speakers(threadId), [kai.id, mira.id], '미라 answered 카이, and 카이 was not woken back')
    const miraReply = CodexChatStore.listMessages(threadId).at(-1)!
    assert.deepEqual(miraReply.routing?.recipients, [kai.id], 'the reply still says whom it answers')
  })

  await t.test('a room without a preset never asks the judge', async (s) => {
    const calls = route(s, () => assert.fail('judge must not be called'))
    const room = GroupChatService.create(requester, { profileIds: [luna.id, kai.id], representativeId: luna.id, userProfileId: null })
    await GroupChatService.sendMessage(requester, room.id, '안녕', () => {})
    assert.deepEqual(speakers(room.id), [luna.id])
    assert.equal(judgeCalls(calls).length, 0)
  })

  await t.test('status fields the reply left alone are settled by the judge and folded like a fence', async (s) => {
    const block = ChatSharedBlockStore.create({ name: '기분', block: { key: 'mood', example: '{"emotion":"calm","place":"home"}', fields: [{ name: 'emotion', values: ['calm', 'happy', 'sad'] }, { name: 'place', values: ['home', 'park'] }] } })
    const fieldsPreset = ChatJudgePresetStore.create({ name: '필드', providerName: 'jev', items: [], context: { ...JUDGE_OPTION_DEFAULTS.context, lore: { ...JUDGE_OPTION_DEFAULTS.context.lore, enabled: false }, recall: { enabled: false, threshold: 0.35 } } })
    const sol = ChatProfileStore.create({ name: '솔', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, judgePresetId: fieldsPreset.id })
    ChatProfileStore.update(sol.id, { blockIds: [block.id] })
    const calls = route(s, (body) => {
      const answers: Record<string, unknown> = {}
      for (const [id, question] of Object.entries(body.questions as Record<string, { criteria: Record<string, string> }>)) {
        const values = Object.entries(question.criteria)
        // emotion: clearly happy now; place: unsure between the two.
        answers[id] = values.some(([, value]) => value === 'happy') ? choice({ v1: 0.1, v2: 0.85, v3: 0.05 }) : choice({ v1: 0.55, v2: 0.45 })
      }
      return answers
    }, () => reply('우와, 진짜 신난다!'))
    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '필드', 'llm', sol.id))!
    const sent = await LlmChatService.sendMessage(requester, thread, '선물 사왔어', () => {})
    await waitFor(() => CodexChatStore.listMessages(thread.id).find((message) => message.id === sent.id)!.content.includes('```mood'), 'fence added')
    const stored = CodexChatStore.listMessages(thread.id).find((message) => message.id === sent.id)!
    assert.ok(stored.content.startsWith('우와, 진짜 신난다!'))
    assert.ok(stored.content.endsWith('```mood\n{"emotion":"happy"}\n```'), 'only the confident change is written')
    const folded = foldBlockState(ChatProfileStore.find(sol.id)!, CodexChatStore.listMessages(thread.id), parseBlockEdits(thread.block_edits))!
    assert.deepEqual(folded.state.mood, { emotion: 'happy', place: 'home' })
    const question = judgeCalls(calls).find((call) => Object.keys(call.body.questions).some((id) => id.startsWith('field-')))!
    assert.deepEqual(question.body.state.status.mood, { emotion: 'calm', place: 'home' })
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'fields' }).length === 1, 'fields run logged')
    const [run] = ChatJudgeLogStore.list({ threadId: thread.id, stage: 'fields' })
    assert.deepEqual(run.items.map((item) => [item.name, item.action, item.choice]).sort(), [['mood.emotion', 'set', 'happy'], ['mood.place', 'none', 'home']])
    const stats = ChatJudgeLogStore.stats({ presetId: fieldsPreset.id }).filter((entry) => entry.stage === 'fields')
    assert.deepEqual(stats.map((entry) => [entry.itemId, entry.runs]), [['field', 2]], 'fields count together under one row')

    // A reply that wrote the field itself is not asked about it.
    calls.length = 0
    s.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url: String(url), body })
      if (String(url).endsWith('/v1/systemone')) return Response.json({ model: 'jev', answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, choice({ v1: 0.9, v2: 0.1 })])) })
      return reply('조금 슬퍼.\n\n```mood\n{"emotion":"sad"}\n```')
    })
    const second = await LlmChatService.sendMessage(requester, thread, '미안', () => {})
    await waitFor(() => ChatJudgeLogStore.list({ threadId: thread.id, stage: 'fields' }).length === 2, 'second fields run')
    const asked = judgeCalls(calls).flatMap((call) => Object.values(call.body.questions as Record<string, { instructions: string }>).map((entry) => entry.instructions))
    assert.ok(asked.every((text) => !text.includes('"emotion"')), 'the field the reply wrote is left alone')
    assert.ok(asked.some((text) => text.includes('"place"')))
    assert.equal(CodexChatStore.listMessages(thread.id).find((message) => message.id === second.id)!.content, '조금 슬퍼.\n\n```mood\n{"emotion":"sad"}\n```', 'place stays: the judge chose the current value')
  })

  await t.test('lore entries the judge picks go in without a keyword; recall keeps only what the judge kept', () => {
    const book = ChatLorebookStore.create({ name: '우주 설정', entries: [
      { keys: ['정거장'], title: '은하 정거장', content: '은하 정거장은 궤도 위의 큰 항구다.' },
      { keys: ['비밀코드'], title: '은하 정거장 금고', content: '금고는 은하 정거장 지하에 있다.' },
    ] })
    const profile = ChatProfileStore.create({ name: '별', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, lorebookIds: [book.id] })
    const entries = keyedLoreEntries(booksForRequest({ thread: null, profile }))
    const vault = entries.find((entry) => entry.entry.title === '은하 정거장 금고')!
    const messages = [{ content: '우주 항구 지하에는 뭐가 있어?' }]
    const plain = selectLoreEntries(profile, messages, (text) => text.length, (text) => text, { entries })
    assert.equal(plain.keys.length, 0)
    const judged = selectLoreEntries(profile, messages, (text) => text.length, (text) => text, { entries, judged: new Set([vault.key]) })
    assert.deepEqual(judged.keys, [vault.key])
    assert.equal(judged.decisions.find((decision) => decision.key === vault.key)?.reason, 'judge')

    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '회상', 'llm', profile.id))!
    const first = CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '바다 여행 갔던 날 기억나?', tool_calls: [], status: 'completed', error: null })
    const second = CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '응, 바다 여행 정말 좋았지.', tool_calls: [], status: 'completed', error: null })
    const revision = () => CodexChatStore.findThreadById(thread.id)!.context_revision
    assert.ok(ChatSummaryStore.addSegment(thread.id, { from: first, until: first, content: '둘은 바다 여행을 떠나 해변 모래성을 쌓았다.' }, revision()))
    assert.ok(ChatSummaryStore.addSegment(thread.id, { from: second, until: second, content: '바다 여행 마지막 날 해변 불꽃놀이를 봤다.' }, revision()))
    assert.ok(ChatSummaryStore.setPlot(thread.id, { from: first, until: second, content: '둘은 바다 여행을 다녀왔다.' }, revision()))
    const segments = ChatSummaryStore.list(thread.id)
    const later = [...CodexChatStore.listMessages(thread.id), { id: 9999, role: 'user', content: '바다 여행 해변 또 가자', tool_calls: [], status: 'completed', error: null } as never]
    const byTerms = recalledSegments(profile, segments, later, { contextTokens: null })
    assert.ok(byTerms.length >= 1)
    const kept = segments.find((segment) => segment.content.includes('불꽃놀이'))!
    const judgedRecall = recalledSegments(profile, segments, later, { contextTokens: null }, new Set([kept.id]))
    assert.deepEqual(judgedRecall.map((segment) => segment.id), [kept.id])
    assert.deepEqual(recalledSegments(profile, segments, later, { contextTokens: null }, new Set()), [], 'nothing kept: nothing recalled')
  })

  await t.test('a turn asks about lore no keyword named and the entry the judge picks reaches the request', async (s) => {
    const book = ChatLorebookStore.create({ name: '마을 설정', entries: [
      { keys: ['등대지기'], title: '등대 마을 축제', content: '등대 마을 축제는 매년 가을 바닷가 등대 앞에서 열린다.' },
      { keys: ['용광로'], title: '대장간', content: '대장간은 산 위에 있다.' },
    ] })
    const lorePreset = ChatJudgePresetStore.create({ name: '로어', providerName: 'jev', items: [], context: { ...JUDGE_OPTION_DEFAULTS.context, recall: { enabled: false, threshold: 0.35 } } })
    const guide = ChatProfileStore.create({ name: '안내인', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, lorebookIds: [book.id], judgePresetId: lorePreset.id })
    const calls = route(s, (body) => Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: 'noul', noul: 0.9 }])))
    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '로어', 'llm', guide.id))!
    const sent = await LlmChatService.sendMessage(requester, thread, '가을에 바닷가 등대 마을 축제 가볼까?', () => {})
    const judge = judgeCalls(calls)[0]
    const asked = Object.values(judge.body.questions as Record<string, { instructions: string }>).map((entry) => entry.instructions)
    assert.equal(asked.length, 1, 'only the entry sharing words with the exchange is asked about')
    assert.ok(asked[0].includes('등대 마을 축제'))
    const chat = calls.find((call) => call.url.endsWith('/chat/completions'))!
    assert.ok(JSON.stringify(chat.body.messages).includes('매년 가을 바닷가 등대 앞에서'), 'the picked entry is in the request')
    const meta = JSON.parse(CodexChatStore.listMessages(thread.id).find((message) => message.id === sent.id)!.context_meta!)
    assert.equal(meta.loreEntries.find((entry: { title: string }) => entry.title === '등대 마을 축제')?.reason, 'judge')
    assert.equal(meta.judge.items[0].action, 'lore')
  })

  await t.test('the first log tables (turns only) are made again on start', async () => {
    const Database = (await import('better-sqlite3')).default
    const { createUserSettingsSchema } = await import('../src/database/userSettingsSchema')
    const old = new Database(':memory:')
    old.exec(`CREATE TABLE chat_judge_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, thread_id INTEGER NOT NULL, profile_id INTEGER NOT NULL, preset_id INTEGER NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('before', 'after')), message_id INTEGER, reply_id TEXT, engine TEXT NOT NULL, provider_name TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT, request TEXT, tools_called TEXT, follow_up_message_id INTEGER)`)
    old.exec("INSERT INTO chat_judge_runs (thread_id, profile_id, preset_id, stage, engine) VALUES (1, 1, 1, 'before', 'typesafe')")
    createUserSettingsSchema(old)
    const sql = (old.prepare("SELECT sql FROM sqlite_master WHERE name = 'chat_judge_runs'").get() as { sql: string }).sql
    assert.ok(!sql.includes('CHECK'))
    old.prepare("INSERT INTO chat_judge_runs (thread_id, profile_id, preset_id, stage, engine) VALUES (NULL, NULL, 1, 'asset', 'typesafe')").run()
    assert.ok((old.prepare('PRAGMA table_info(chat_judge_presets)').all() as Array<{ name: string }>).some((column) => column.name === 'options'))
    old.close()
  })

  await t.test('an expression candidate is read from its tags; a down judge reads nothing', async (s) => {
    const assetPreset = ChatJudgePresetStore.create({ name: '자산', providerName: 'jev', items: [] })
    const face = ChatProfileStore.create({ name: '얼굴', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, judgePresetId: assetPreset.id })
    const calls = route(s, () => ({ emotion: choice({ e1: 0.1, e2: 0.7, e3: 0.2 }) }))
    const result = await judgeExpression({ profile: face, emotions: ['중립', '기쁨', '수줍음'], emotion: '수줍음', tags: { general: ['1girl', 'smile', 'blush'], rating: {} } })
    assert.deepEqual(result, { picked: '기쁨', probability: 0.2 })
    const question = judgeCalls(calls)[0].body.questions.emotion
    assert.ok(question.criteria.e2.startsWith('기쁨 (typical tags:'), 'a known emotion carries its expected tags')
    assert.equal(question.criteria.e3, '수줍음', 'a custom emotion is offered as it is')
    const [run] = ChatJudgeLogStore.list({ stage: 'asset' })
    assert.equal(run.threadId, null)
    assert.equal(run.items[0].verdict, 'no')
    s.mock.method(globalThis, 'fetch', async () => { throw new Error('down') })
    assert.equal(await judgeExpression({ profile: face, emotions: ['중립', '기쁨'], emotion: '기쁨', tags: { general: ['smile'], rating: {} } }), null)
    ChatJudgePresetStore.update(assetPreset.id, { assets: { enabled: false } })
    assert.equal(await judgeExpression({ profile: ChatProfileStore.find(face.id)!, emotions: ['중립', '기쁨'], emotion: '기쁨', tags: { general: ['smile'], rating: {} } }), null)
  })
})
