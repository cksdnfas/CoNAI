import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Text embeddings in chat, Node side, with the Python worker replaced by a concept-vector fake: the background index,
 * recall fused with shared words, lore brought in by meaning (or proposed to the judge), hybrid history search, and
 * the fallback to the keyword paths when embeddings are off.
 */

// Words of one concept land on the same axis; anything else on a shared "noise" axis, like EmbeddingGemma's ~0.6 floor.
const CONCEPTS: string[][] = [
  ['선술집', '지도', '정보상'],
  ['늑대', '설원', '이끼', '눈밭'],
  ['발목', '절벽'],
  ['고춧가루', '스튜', '국'],
  ['역병', '검은 점', '반점'],
  ['실권자', '재상', '오르윈'],
  ['등불', '망자'],
]
const DIM = 256

function fakeVector(text: string) {
  const vector = new Float32Array(DIM)
  vector[DIM - 1] = 1
  CONCEPTS.forEach((words, axis) => {
    for (const word of words) if (text.includes(word)) vector[axis] += 1.5
  })
  let norm = 0
  for (const value of vector) norm += value * value
  return vector.map((value) => value / Math.sqrt(norm))
}

const base64 = (vector: Float32Array) => Buffer.from(vector.buffer).toString('base64')

test('chat semantic: index, recall, lore, history search', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-semantic-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.AI_RUNTIME_DIR = path.join(root, 'ai-runtime')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { settingsService } = await import('../src/services/settingsService')
  const embedding = await import('../src/services/aiWorker/textEmbeddingService')
  const requests: Array<{ op: string; payload: any }> = []
  embedding.embeddingRuntime.checkDependencies = async () => ({ available: true, message: 'ok', missingPackages: [], python: 'fake' })
  t.mock.method(embedding.textWorker, 'request', async (op: string, payload: any) => {
    requests.push({ op, payload })
    if (op === 'embed') return { device: 'cpu', items: payload.items.map((item: { text: string }) => [{ start: 0, end: item.text.length, vector: base64(fakeVector(item.text)) }]) }
    if (op === 'chunk') return { items: payload.texts.map((text: string) => [{ start: 0, end: text.length }]) }
    throw new Error(`unexpected op ${op}`)
  })

  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { ChatLorebookStore, selectLoreEntries } = await import('../src/services/codex-chat/chatLorebook')
  const { booksForRequest, keyedLoreEntries } = await import('../src/services/codex-chat/chatLoreContext')
  const { selectRecall } = await import('../src/services/codex-chat/chatMemory')
  const { semanticIndexer, semanticIndexInternals } = await import('../src/services/embeddings/semanticIndex')
  const { semanticContextFor } = await import('../src/services/embeddings/chatSemantic')
  const { standouts } = await import('../src/services/embeddings/rankFusion')
  const { searchChatHistory } = await import('../src/services/codex-chat/chatHistorySearch')
  const { vectorStore } = await import('../src/services/vectors/vectorStore')
  const db = dbModule.getUserSettingsDb()

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const book = ChatLorebookStore.create({ name: '설정', entries: [
    { keys: ['오르윈'], title: '재상 오르윈', content: '냉정한 재상이자 왕국의 실권자. 마법을 혐오한다.' },
    { keys: ['역병'], title: '검은 역병', content: '피부에 검은 반점이 생기는 병.' },
    { keys: ['축제'], title: '등불의 밤', content: '바다에 등불을 띄워 망자를 기리는 축제.' },
    { keys: ['길드'], title: '용병 길드', content: '의뢰 게시판과 등급제.' },
    { keys: ['마탑'], title: '마탑', content: '북쪽 절벽 위의 마법사 조합.' },
    { keys: ['항구'], title: '벨마르 항구', content: '밤이면 밀수선이 드나드는 수도의 부두.' },
    { keys: ['상시'], title: '세계', content: '대륙 서쪽의 왕국.', constant: true },
  ] })
  const profile = ChatProfileStore.create({ name: '리아', engine: 'llm', providerName: 'conn', summaryEnabled: true, lorebookIds: [book.id] })
  const threadId = CodexChatStore.createThread(null, '모험', 'llm', profile.id)
  const thread = () => CodexChatStore.findThreadById(threadId)!
  const say = (id: number, role: 'user' | 'assistant', content: string) => {
    const messageId = CodexChatStore.addMessage({ thread_id: id, role, content, tool_calls: [], status: 'completed', error: null })
    return CodexChatStore.listMessages(id).find((message) => message.id === messageId)!
  }
  const episodes = [
    '주인공과 리아는 선술집에서 정보상을 만나 비밀 통로 지도를 샀다.',
    '설원에서 이끼를 찾다가 늑대 무리에게 쫓겼다.',
    '절벽을 오르다 리아가 발목을 다쳤다.',
    '주인공이 끓인 스튜에 리아가 고춧가루를 잔뜩 넣었다.',
    '등불을 바다에 띄우며 리아가 울었다.',
    '하루 종일 걸어서 다음 마을에 도착했다.',
  ]
  const segmentIds = episodes.map((content, index) => Number(db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, ?, ?, ?)')
    .run(threadId, index * 10 + 1, index * 10 + 9, content).lastInsertRowid))

  await t.test('off: nothing is embedded and the context is null', async () => {
    assert.equal(await semanticIndexer.sweep(), 0)
    assert.equal(await semanticContextFor({ profile, thread: thread(), messages: [say(threadId, 'user', '늑대')], judgeDecidesLore: false }), null)
    assert.equal(requests.length, 0)
  })

  settingsService.updateEmbeddingSettings({ enabled: true })

  await t.test('the background pass embeds segments, then keyword lore (not "always on"), then nothing', async () => {
    while (await semanticIndexer.sweep() > 0) { /* drain */ }
    assert.equal(vectorStore.count('chat-recall', embedding.EMBEDDING_MODEL_KEY), episodes.length)
    assert.equal(vectorStore.count('chat-lore', embedding.EMBEDDING_MODEL_KEY), 6)
    assert.ok(requests.every((request) => request.payload.kind === 'document'))
    const before = requests.length
    assert.equal(await semanticIndexer.sweep(), 0, 'unchanged text is not embedded again')
    assert.equal(requests.length, before)

    db.prepare('UPDATE chat_summary_segments SET content = ? WHERE id = ?').run('설원의 늑대 무리와 이끼 이야기, 다시 정리함.', segmentIds[1])
    assert.equal(semanticIndexInternals.pendingSegments(50).length, 1, 'an edited segment is embedded again')
    while (await semanticIndexer.sweep() > 0) { /* drain */ }
  })

  await t.test('recall: an episode told in other words comes back, fused with shared words', async () => {
    say(threadId, 'assistant', '오늘은 어디로 갈까?')
    const latest = say(threadId, 'user', '너 저번에 내 국에 그 빨간 가루 왕창 넣었잖아. 고춧가루 말이야.')
    const semantic = await semanticContextFor({ profile, thread: thread(), messages: CodexChatStore.listMessages(threadId), judgeDecidesLore: false })
    assert.ok(semantic)
    assert.deepEqual([...semantic.recall.keys()], [segmentIds[3]])
    const segments = db.prepare('SELECT * FROM chat_summary_segments WHERE thread_id = ? ORDER BY id').all(threadId) as any[]
    const plain = selectRecall(segments, '그 빨간 가루 기억나?', 10_000, () => 10)
    assert.equal(plain.length, 0, 'no shared words: keywords alone recall nothing')
    const fused = selectRecall(segments, '그 빨간 가루 기억나?', 10_000, () => 10, 3, 3, semantic.recall)
    assert.deepEqual(fused.map((segment) => segment.id), [segmentIds[3]])
    assert.equal(fused[0].similarity, semantic.recall.get(segmentIds[3]), 'carries its closeness')
    assert.equal(requests.at(-1)!.payload.kind, 'query')
    assert.deepEqual(requests.at(-1)!.payload.items.map((item: { text: string }) => item.text), ['오늘은 어디로 갈까?', latest.content], 'the latest exchange, one query per message')
  })

  await t.test('lore: the entry the exchange is about comes in by meaning, labelled; with a judge it is only a candidate', async () => {
    const messages = [{ content: '그 늙은 실권자 녀석이 또 마법사들을 압박한대.' }]
    say(threadId, 'user', messages[0].content)
    const semantic = await semanticContextFor({ profile, thread: thread(), messages: CodexChatStore.listMessages(threadId), judgeDecidesLore: false })
    const entries = keyedLoreEntries(booksForRequest({ thread: thread(), profile }))
    const chancellor = entries.find((item) => item.entry.title === '재상 오르윈')!
    assert.deepEqual([...semantic!.loreKeys], [chancellor.key])
    const selected = selectLoreEntries(profile, messages, (text) => text.length, (text) => text, { entries, semantic: semantic!.loreKeys })
    assert.ok(selected.keys.includes(chancellor.key))
    assert.equal(selected.decisions.find((decision) => decision.key === chancellor.key)?.reason, 'semantic')

    const judged = await semanticContextFor({ profile, thread: thread(), messages: CodexChatStore.listMessages(threadId), judgeDecidesLore: true })
    assert.equal(judged!.loreKeys.size, 0)
    const best = [...judged!.loreScores.entries()].sort((a, b) => b[1] - a[1])[0]
    assert.equal(best[0], chancellor.key, 'the judge is offered it first')
  })

  await t.test('lore: an edited entry is not scored from its old vector', async () => {
    ChatLorebookStore.update(book.id, { entries: [
      ...book.entries.filter((entry) => entry.title !== '재상 오르윈'),
      { ...book.entries.find((entry) => entry.title === '재상 오르윈')!, title: '정원사', keys: ['정원사'], content: '은퇴한 정원사.' },
    ] })
    const semantic = await semanticContextFor({ profile, thread: thread(), messages: [say(threadId, 'user', '실권자 이야기')], judgeDecidesLore: false })
    assert.equal(semantic!.loreKeys.size, 0)
  })

  await t.test('history search: words first, related wording too; only chats that share knowledge are embedded', async () => {
    const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
    const room = ChatGroupStore.create(null, '방', [profile.id, kai.id], profile.id)
    say(room, 'user', '설원에서 늑대한테 쫓긴 거 기억나?')
    say(room, 'assistant', '응, 이끼 캐다가 그랬지.')
    say(room, 'user', '오늘 장 보러 가자.')
    const lonely = CodexChatStore.createThread(null, '혼자', 'llm', kai.id)
    say(lonely, 'user', '늑대')
    assert.ok(!semanticIndexInternals.historyThreadIds().includes(lonely))

    settingsService.updateEmbeddingSettings({ chatHistory: false })
    const lexical = await searchChatHistory([room], '눈밭', 10)
    assert.equal(lexical.length, 0, 'off: keywords only')

    settingsService.updateEmbeddingSettings({ chatHistory: true })
    const hits = await searchChatHistory([room], '눈밭', 10)
    assert.ok(hits.length >= 1)
    assert.ok(hits.every((hit) => hit.chat_id === room))
    assert.match(hits[0].excerpt, /늑대|이끼/)
    const words = await searchChatHistory([room], '장 보러', 10)
    assert.equal(words[0].excerpt, '오늘 장 보러 가자.')
  })

  await t.test('prune drops vectors whose source is gone', async () => {
    db.prepare('DELETE FROM chat_summary_segments WHERE id = ?').run(segmentIds[5])
    semanticIndexInternals.pruneVectors()
    assert.equal(vectorStore.get('chat-recall', String(segmentIds[5]), embedding.EMBEDDING_MODEL_KEY).length, 0)
    assert.equal(vectorStore.count('chat-recall', embedding.EMBEDDING_MODEL_KEY), episodes.length - 1)
  })

  await t.test('standouts: a lead over the median, or a high score among few', () => {
    const many = new Map([['a', 0.8], ['b', 0.62], ['c', 0.6], ['d', 0.61], ['e', 0.63]])
    assert.deepEqual(standouts(many, 0.66, 0.06).map(([key]) => key), ['a'])
    assert.deepEqual(standouts(new Map([['a', 0.7], ['b', 0.73]]), 0.66, 0.06).map(([key]) => key), ['b'])
  })

  semanticIndexer.stop()
})
