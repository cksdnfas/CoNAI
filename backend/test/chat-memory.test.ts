import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('chat memory: pinned memories, summary segments, plot folding, recall', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-memory-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-memory-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { createUserSettingsSchema } = await import('../src/database/userSettingsSchema')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const memory = await import('../src/services/codex-chat/chatMemory')
  const { ChatSummaryStore, normalizeMemories, recallTerms, selectRecall, splitSegments } = memory
  const context = await import('../src/services/codex-chat/llmChatContext')
  const { buildChatMessages, resolveContextConfig, summarizeAhead, summarizeAll } = context

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn', summaryEnabled: true, contextTurns: 4, contextTokens: 8000, summaryTriggerTurns: 2 })
  const threadId = CodexChatStore.createThread(null, 'memory', 'llm', profile.id)
  const thread = () => CodexChatStore.findThreadById(threadId)!
  const say = (role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null })
  const sentText = (messages: unknown) => JSON.stringify(messages)

  // The summary model: a segment repeats the stretch's keyword, a plot says it is one. Long enough (Korean, ~1 token
  // per character) that three segments outgrow the summary budget (15% of 8000), short enough to be recalled (8000/12).
  const FILLER = '가'.repeat(500)
  let failNext = false
  let failPlot = false
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body)
    requests.push(body)
    if (failPlot && body.includes('구간 요약')) return new Response('plot boom', { status: 500 })
    if (failNext) {
      failNext = false
      return new Response('boom', { status: 500 })
    }
    const keyword = /키워드:(\S+?)[.\\"]/.exec(body)?.[1] ?? '없음'
    const content = body.includes('구간 요약') ? `줄거리 정리. ${FILLER}` : `${keyword}의 기억. ${FILLER}`
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  })

  const stretch = (keyword: string) => {
    const first = say('user', `키워드:${keyword}. 같이 가자.`)
    say('assistant', '좋아.')
    say('user', '그 다음엔?')
    say('assistant', '조금 쉬자.')
    return first
  }

  await t.test('pinned memories are validated and travel in the second system message', () => {
    assert.equal(normalizeMemories('x'), null)
    assert.equal(normalizeMemories([{ text: 3 }]), null)
    const items = normalizeMemories(['  {{user}}와 약속: 내일 바다  ', '', { id: 'keep-me', text: '카이는 왼손잡이' }, { id: 'keep-me', text: '중복 id' }])!
    assert.deepEqual(items.map((item) => item.text), ['{{user}}와 약속: 내일 바다', '카이는 왼손잡이', '중복 id'])
    assert.equal(items[1].id, 'keep-me')
    assert.notEqual(items[2].id, 'keep-me', 'a repeated id gets a new one')
    assert.equal(normalizeMemories(Array.from({ length: 80 }, (_, index) => `m${index}`))!.length, memory.MEMORY_MAX_ITEMS)
    CodexChatStore.setMemories(threadId, items)
    say('assistant', '안녕!')
    const current = thread()
    const sent = buildChatMessages({ profile, thread: current, messages: CodexChatStore.listMessages(threadId), config: resolveContextConfig(current, profile), tools: [] })
    assert.equal(sent[1].role, 'system')
    assert.match(String(sent[1].content), /^## 고정 기억\n- 사용자와 약속: 내일 바다\n- 카이는 왼손잡이/)
  })

  const first = stretch('은하수정원')
  await t.test('summarizing writes a segment and keeps the thread summary in step', async () => {
    assert.ok(await summarizeAll(threadId, profile))
    const segments = ChatSummaryStore.list(threadId)
    assert.equal(segments.length, 1)
    assert.equal(segments[0].level, 0)
    assert.match(segments[0].content, /^은하수정원의 기억/)
    assert.equal(thread().summary_until_message_id, segments[0].until_message_id)
    assert.equal(thread().summary, segments[0].content)
    assert.ok(requests.at(-1)!.includes('앞선 내용'), 'a segment is summarized on its own, with the past as context')
  })

  await t.test('older segments fold into the plot once the summary outgrows its budget; the newest stay', async () => {
    stretch('푸른등대')
    assert.ok(await summarizeAll(threadId, profile))
    stretch('붉은우산')
    assert.ok(await summarizeAll(threadId, profile))
    const { plot, active, folded } = splitSegments(ChatSummaryStore.list(threadId))
    assert.ok(plot, 'a plot was written')
    assert.match(plot!.content, /^줄거리 정리/)
    assert.deepEqual(folded.map((segment) => segment.content.split('의')[0]), ['은하수정원'])
    assert.deepEqual(active.map((segment) => segment.content.split('의')[0]), ['푸른등대', '붉은우산'])
    assert.equal(plot!.until_message_id, folded[0].until_message_id)
    assert.ok(thread().summary!.startsWith('줄거리 정리'))
    assert.ok(!thread().summary!.includes('은하수정원'), 'what the plot covers leaves the summary')
  })

  await t.test('a folded segment comes back when the conversation touches it again', () => {
    say('user', '은하수정원에서 했던 얘기 기억나?')
    const current = thread()
    const messages = CodexChatStore.listMessages(threadId)
    const segments = ChatSummaryStore.list(threadId)
    const sent = buildChatMessages({ profile, thread: current, messages, config: resolveContextConfig(current, profile), tools: [], segments })
    const system = sent.filter((message) => message.role === 'system')
    assert.ok(!sentText(system).includes('은하수정원의 기억'))
    assert.ok(sentText(sent).includes('## 관련된 지난 일\\n은하수정원의 기억'))
    // The next exchange, about something else, recalls nothing.
    say('assistant', '응, 기억나.')
    say('user', '오늘 날씨 어때?')
    const unrelated = buildChatMessages({ profile, thread: thread(), messages: CodexChatStore.listMessages(threadId), config: resolveContextConfig(thread(), profile), tools: [], segments })
    assert.ok(!sentText(unrelated).includes('관련된 지난 일'))
  })

  await t.test('a failed background summary is kept on the thread until one succeeds', async () => {
    stretch('검은고양이')
    failNext = true
    await assert.rejects(summarizeAll(threadId, profile))
    assert.ok(thread().summary_error)
    assert.ok(await summarizeAll(threadId, profile))
    assert.equal(thread().summary_error, null)
  })

  await t.test('a hand edit re-renders the summary', () => {
    const { active } = splitSegments(ChatSummaryStore.list(threadId))
    assert.ok(ChatSummaryStore.editSegment(threadId, active[0].id, '손으로 고친 요약'))
    assert.ok(thread().summary!.includes('손으로 고친 요약'))
    assert.equal(ChatSummaryStore.editSegment(threadId, 999999, 'x'), false)
  })

  await t.test('editing history drops only the segments that reach it', () => {
    const before = splitSegments(ChatSummaryStore.list(threadId))
    const last = before.active[before.active.length - 1]
    CodexChatStore.editUserMessage(threadId, last.from_message_id, '키워드:바뀐내용. 다시')
    const after = splitSegments(ChatSummaryStore.list(threadId))
    assert.ok(after.plot, 'the plot ends before the edit and stays')
    assert.deepEqual(after.active.map((segment) => segment.id), before.active.slice(0, -1).map((segment) => segment.id))
    assert.equal(thread().summary_until_message_id, after.active[after.active.length - 1].until_message_id)
    // An edit inside the plot's range drops the plot and everything after it; nothing earlier is left.
    CodexChatStore.editUserMessage(threadId, first, '처음부터 다시')
    assert.equal(ChatSummaryStore.list(threadId).length, 0)
    assert.equal(thread().summary, null)
    assert.equal(thread().summary_until_message_id, null)
  })

  await t.test('a summary written before segments existed becomes an unbacked plot; an edit inside it starts over', () => {
    const legacyId = CodexChatStore.createThread(null, 'legacy', 'llm', profile.id)
    const ids = ['a', 'b', 'c', 'd'].map((text, index) => CodexChatStore.addMessage({ thread_id: legacyId, role: index % 2 ? 'assistant' : 'user', content: text, tool_calls: [], status: 'completed', error: null }))
    db.prepare('UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ? WHERE id = ?').run('예전 요약', ids[1], legacyId)
    createUserSettingsSchema(db)
    createUserSettingsSchema(db)
    const segments = ChatSummaryStore.list(legacyId)
    assert.equal(segments.length, 1, 'migrated once')
    assert.deepEqual([segments[0].level, segments[0].from_message_id, segments[0].until_message_id, segments[0].content, segments[0].backed], [1, ids[0], ids[1], '예전 요약', 0])
    // A later stretch, then a plot folded from the unbacked one: nothing beneath covers a..b, so it stays unbacked.
    const revision = () => CodexChatStore.findThreadById(legacyId)!.context_revision
    assert.ok(ChatSummaryStore.addSegment(legacyId, { from: ids[2], until: ids[3], content: 'c와 d' }, revision()))
    assert.ok(ChatSummaryStore.setPlot(legacyId, { from: ids[0], until: ids[3], content: '새 줄거리' }, revision()))
    assert.equal(splitSegments(ChatSummaryStore.list(legacyId)).plot!.backed, 0)
    // An edit inside it must not leave c..d alone, with a..b neither summarized nor sent: everything starts over.
    CodexChatStore.prepareRegeneration(legacyId, ids[3])
    assert.equal(ChatSummaryStore.list(legacyId).length, 0)
    assert.equal(CodexChatStore.findThreadById(legacyId)!.summary_until_message_id, null)
  })

  await t.test('a summary written by hand before anything was folded stays a note ahead of every message', () => {
    const noteId = CodexChatStore.createThread(null, 'note', 'llm', profile.id)
    CodexChatStore.addMessage({ thread_id: noteId, role: 'user', content: '첫 메시지', tool_calls: [], status: 'completed', error: null })
    db.prepare('UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = NULL WHERE id = ?').run('손으로 쓴 메모', noteId)
    createUserSettingsSchema(db)
    const [plot] = ChatSummaryStore.list(noteId)
    assert.deepEqual([plot.level, plot.from_message_id, plot.until_message_id, plot.backed], [1, 0, 0, 0])
    const current = CodexChatStore.findThreadById(noteId)!
    const sent = sentText(buildChatMessages({ profile, thread: current, messages: CodexChatStore.listMessages(noteId), config: resolveContextConfig(current, profile), tools: [] }))
    assert.ok(sent.includes('손으로 쓴 메모') && sent.includes('첫 메시지'))
    ChatSummaryStore.replaceAll(noteId, '다시 쓴 메모', null)
    assert.deepEqual(ChatSummaryStore.list(noteId).map((segment) => [segment.until_message_id, segment.content]), [[0, '다시 쓴 메모']])
    ChatSummaryStore.replaceAll(noteId, null, null)
    assert.equal(ChatSummaryStore.list(noteId).length, 0)
    assert.equal(CodexChatStore.findThreadById(noteId)!.summary, null)
  })

  await t.test('a failing plot fold is recorded, turns still fold into segments, and the next success clears it', async () => {
    const roomId = CodexChatStore.createThread(null, 'plot-fail', 'llm', profile.id)
    const sayIn = (role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: roomId, role, content, tool_calls: [], status: 'completed', error: null })
    const stretchIn = (keyword: string) => { sayIn('user', `키워드:${keyword}. 가자.`); sayIn('assistant', '응.'); sayIn('user', '다음?'); sayIn('assistant', '쉬자.') }
    stretchIn('하나')
    assert.ok(await summarizeAll(roomId, profile))
    stretchIn('둘')
    assert.ok(await summarizeAll(roomId, profile))
    stretchIn('셋')
    stretchIn('넷')
    failPlot = true
    await summarizeAhead(roomId, profile, [])
    let split = splitSegments(ChatSummaryStore.list(roomId))
    assert.equal(split.plot, null)
    assert.equal(split.active.length, 3, 'the turns were still folded')
    assert.ok(CodexChatStore.findThreadById(roomId)!.summary_error)
    failPlot = false
    await summarizeAhead(roomId, profile, [])
    split = splitSegments(ChatSummaryStore.list(roomId))
    assert.ok(split.plot)
    assert.equal(CodexChatStore.findThreadById(roomId)!.summary_error, null)
  })

  await t.test('recall matches Korean by shared bigrams, needs several, and keeps to its budget', () => {
    assert.ok(recallTerms('약속을 지켰어').has('약속'))
    assert.ok(recallTerms('Kai went to the harbor 2024').has('harbor'))
    const segment = (id: number, content: string) => ({ id, thread_id: 0, level: 0 as const, from_message_id: id, until_message_id: id, content, backed: 1 as const, created_date: '', updated_date: '' })
    const candidates = [segment(1, '카이와 바닷가에서 반지를 약속했다'), segment(2, '도서관에서 시험 공부를 했다'), segment(3, '시장에서 사과를 샀다')]
    const estimate = (text: string) => text.length
    assert.deepEqual(selectRecall(candidates, '그때 바닷가에서 한 반지 약속 기억해?', 1000, estimate).map((item) => item.id), [1])
    assert.deepEqual(selectRecall(candidates, '약속', 1000, estimate), [], 'one shared word is chance')
    assert.deepEqual(selectRecall(candidates, '바닷가 반지 약속', 5, estimate), [], 'nothing past the budget')
  })
})
