import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('group room memory: the room summary, what its members see, and recall', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-group-memory-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-group-memory-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatSummaryStore, splitSegments } = await import('../src/services/codex-chat/chatMemory')
  const { groupSummarizer, summarizeGroupAhead, summarizeGroupAll } = await import('../src/services/codex-chat/llmChatContext')
  const { buildGroupLlmMessages } = await import('../src/services/codex-chat/groupChatContext')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn', contextTokens: 8000 })
  const luna = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'conn', contextTokens: 8000 })
  const members = [kai, luna]
  const WINDOW = 5
  const threadId = ChatGroupStore.create(null, '방', [kai.id, luna.id], kai.id)
  db.prepare('UPDATE codex_chat_threads SET group_window_limit = ? WHERE id = ?').run(WINDOW, threadId)
  const thread = () => CodexChatStore.findThreadById(threadId)!
  const say = (speaker: typeof kai | null, content: string) => CodexChatStore.addMessage({ thread_id: threadId, role: speaker ? 'assistant' : 'user', content, tool_calls: [], status: 'completed', error: null, speaker_profile_id: speaker?.id ?? null })
  const sentTo = (profile: typeof kai) => JSON.stringify(buildGroupLlmMessages({ profile, thread: thread(), members, messages: CodexChatStore.listMessages(threadId), windowLimit: WINDOW, tools: [], maxTokens: null, withTools: false, segments: ChatSummaryStore.list(threadId) }))

  // The summary model: a segment repeats the stretch's keyword, a plot says it is one. Long enough (Korean, ~1 token
  // per character) that three segments outgrow the summary budget (15% of 8000), short enough to be recalled.
  const FILLER = '가'.repeat(500)
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = String(init.body)
    requests.push(body)
    const keyword = /키워드:(\S+?)[.\\"]/.exec(body)?.[1] ?? '없음'
    const content = body.includes('구간 요약') ? `줄거리 정리. ${FILLER}` : `${keyword}의 기억. ${FILLER}`
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  })
  const stretch = (keyword: string) => {
    say(null, `키워드:${keyword}. 다들 어때?`)
    say(kai, '좋아.')
    say(luna, '나도.')
    say(null, '그럼 가자.')
  }

  await t.test('the room summarizes only when its own switch is on; member profiles do not decide', async () => {
    stretch('은하수정원')
    stretch('푸른등대')
    assert.equal(await summarizeGroupAhead(threadId, members, WINDOW), null)
    assert.equal(ChatSummaryStore.list(threadId).length, 0)
    assert.ok(!sentTo(kai).includes('지금까지의 대화 요약'), 'no summary goes out while it is off')
  })

  await t.test('with the summary on, the oldest messages beyond the window fold under everyone\'s names', async () => {
    CodexChatStore.updateThreadContext(threadId, { summaryEnabled: true })
    assert.ok(await summarizeGroupAhead(threadId, members, WINDOW))
    const [segment] = ChatSummaryStore.list(threadId)
    assert.ok(segment)
    assert.match(segment.content, /^은하수정원의 기억/)
    const request = requests.at(-1)!
    assert.ok(request.includes('카이: 좋아.') && request.includes('루나: 나도.') && request.includes('사용자: 키워드:은하수정원'), 'the transcript names each speaker')
    assert.equal(thread().summary_until_message_id, segment.until_message_id)
    // What the summary covers leaves every member's request; the summary stands in for it.
    const sent = sentTo(luna)
    assert.ok(sent.includes('## 지금까지의 대화 요약\\n은하수정원의 기억'))
    assert.ok(!sent.includes('키워드:은하수정원'))
    assert.ok(sent.includes('키워드:푸른등대'))
  })

  await t.test('a folded stretch comes back to a member when the room talks about it again', async () => {
    assert.ok(await summarizeGroupAll(threadId, members, WINDOW))
    stretch('붉은우산')
    assert.ok(await summarizeGroupAll(threadId, members, WINDOW))
    stretch('검은고양이')
    assert.ok(await summarizeGroupAll(threadId, members, WINDOW))
    const { plot, folded } = splitSegments(ChatSummaryStore.list(threadId))
    assert.ok(plot, 'the older stretches were folded into a plot')
    assert.ok(folded.some((segment) => segment.content.startsWith('은하수정원')))
    say(null, '은하수정원에서 했던 얘기 기억나?')
    assert.ok(sentTo(kai).includes('## 관련된 지난 일\\n은하수정원의 기억'))
    say(kai, '응, 기억나.')
    say(null, '오늘 날씨 어때?')
    assert.ok(!sentTo(luna).includes('관련된 지난 일'))
  })

  await t.test('the room needs an API LLM member to summarize; without one the failure is kept on the thread', async () => {
    assert.equal(groupSummarizer({ profile_id: luna.id }, members)?.id, luna.id, 'the representative when it is an LLM')
    assert.equal(groupSummarizer({ profile_id: 999 }, members)?.id, kai.id, 'else the first LLM member')
    assert.equal(groupSummarizer({ profile_id: kai.id }, [{ ...kai, engine: 'codex' }]), null)
    stretch('하얀여우')
    await assert.rejects(summarizeGroupAll(threadId, [{ ...kai, engine: 'codex' }], WINDOW), /LLM 참가자/)
    assert.match(thread().summary_error ?? '', /LLM 참가자/)
    assert.ok(await summarizeGroupAll(threadId, members, WINDOW))
    assert.equal(thread().summary_error, null)
  })
})
