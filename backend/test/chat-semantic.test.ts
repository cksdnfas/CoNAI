import './support/testTemp'
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
const DIM = 768

function fakeVector(text: string, dim = DIM) {
  const vector = new Float32Array(dim)
  vector[dim - 1] = 1
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
  let modelCached = true
  embedding.embeddingRuntime.isModelCached = () => modelCached
  t.mock.method(embedding.textWorker, 'request', async (op: string, payload: any) => {
    requests.push({ op, payload })
    if (op === 'embed') return { device: 'cpu', items: payload.items.map((item: { text: string }) => [{ start: 0, end: item.text.length, vector: base64(fakeVector(item.text, payload.dim)) }]) }
    if (op === 'chunk') return { items: payload.texts.map((text: string) => [{ start: 0, end: text.length }]) }
    if (op === 'load') {
      modelCached = true
      return {}
    }
    throw new Error(`unexpected op ${op}`)
  })

  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { ChatLorebookStore, selectLoreEntries } = await import('../src/services/codex-chat/chatLorebook')
  const { booksForRequest, keyedLoreEntries } = await import('../src/services/codex-chat/chatLoreContext')
  const { selectRecall } = await import('../src/services/codex-chat/chatMemory')
  const { semanticIndexer, semanticIndexInternals, indexMessagesNow, indexSegmentsNow, indexLoreNow } = await import('../src/services/embeddings/semanticIndex')
  const { semanticContextFor } = await import('../src/services/embeddings/chatSemantic')
  const { standouts } = await import('../src/services/embeddings/rankFusion')
  const { searchChatHistory } = await import('../src/services/codex-chat/chatHistorySearch')
  const { vectorStore } = await import('../src/services/vectors/vectorStore')
  const { notifySemanticChange } = await import('../src/services/embeddings/semanticSignal')
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

  await t.test('a missing model is fetched on its own before any work', async () => {
    modelCached = false
    assert.equal(await semanticIndexer.sweep(), episodes.length, 'then the first batch')
    assert.deepEqual(requests.slice(0, 2).map((request) => request.op), ['load', 'embed'])
    assert.equal(requests[0].payload.model, 'embedding')
  })

  await t.test('the background pass embeds segments, then keyword lore (not "always on"), then nothing', async () => {
    while (await semanticIndexer.sweep() > 0) { /* drain */ }
    assert.equal(vectorStore.count('chat-recall', embedding.EMBEDDING_MODEL_KEY), episodes.length)
    assert.equal(vectorStore.count('chat-lore', embedding.EMBEDDING_MODEL_KEY), 6)
    assert.ok(requests.filter((request) => request.op === 'embed').every((request) => request.payload.kind === 'document'))
    const before = requests.length
    assert.equal(await semanticIndexer.sweep(), 0, 'unchanged text is not embedded again')
    assert.equal(requests.length, before)

    db.prepare('UPDATE chat_summary_segments SET content = ? WHERE id = ?').run('설원의 늑대 무리와 이끼 이야기, 다시 정리함.', segmentIds[1])
    assert.equal(semanticIndexInternals.pendingSegments(50).length, 1, 'an edited segment is embedded again')
    while (await semanticIndexer.sweep() > 0) { /* drain */ }
  })

  await t.test('session recall resolves older active-path messages outside a bounded input and excludes the replaced reply', async () => {
    const sessionProfile = { ...profile, engine: 'claude' as const }
    const id = CodexChatStore.createThread(null, 'session recall', 'llm', profile.id)
    const older = say(id, 'assistant', '선술집 정보상이 비밀 통로 지도를 팔았다.')
    for (let i = 0; i < 60; i++) CodexChatStore.addMessage({ thread_id: id, role: i % 2 ? 'user' : 'assistant', content: `unrelated ${i}`, tool_calls: [], status: 'completed', error: null })
    say(id, 'user', '선술집 정보상 지도 기억나?')
    const replaced = say(id, 'assistant', '선술집 정보상의 지도')
    await indexMessagesNow([id], 100)
    const source = { threadId: id, excludeMessageId: replaced.id }
    const full = CodexChatStore.listMessages(id).filter(message => message.id !== replaced.id)
    const bounded = CodexChatStore.listContextMessages(source, { afterId: Number.MAX_SAFE_INTEGER, recentMessages: 4, textMessages: 2 })
    const params = { profile: sessionProfile, thread: CodexChatStore.findThreadById(id)!, judgeDecidesLore: false }
    const expected = await semanticContextFor({ ...params, messages: full })
    const actual = await semanticContextFor({ ...params, messages: bounded, historySource: source })
    assert.deepEqual(actual, expected)
    assert.ok(actual?.messages?.some(message => message.id === older.id))
    assert.ok(!actual?.messages?.some(message => message.id === replaced.id))
    CodexChatStore.deleteThread(id)
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

  await t.test('a signalled change is looked at; an unsignalled one waits for the full pass', async () => {
    while (await semanticIndexer.sweep() > 0) { /* drain */ }
    semanticIndexer.start()
    t.after(() => semanticIndexer.stop())
    const insert = () => Number(db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, 900, 909, ?)')
      .run(threadId, '설원의 이끼를 다시 찾으러 갔다.').lastInsertRowid)
    const quiet = insert()
    assert.equal(await semanticIndexer.sweep(false), 0, 'no signal: nothing is scanned')
    notifySemanticChange('recall')
    assert.equal(await semanticIndexer.sweep(false), 1)
    assert.equal(vectorStore.get('chat-recall', String(quiet), embedding.EMBEDDING_MODEL_KEY).length, 1)
    db.prepare('DELETE FROM chat_summary_segments WHERE id = ?').run(quiet)
    semanticIndexInternals.pruneVectors()
  })

  await t.test('the loaded vectors follow writes without a reload', () => {
    const space = 'test-cache'
    const axis = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0))
    vectorStore.replace(space, 'a', 'm', [{ vector: axis(0) }])
    vectorStore.replace(space, 'b', 'm', [{ vector: axis(1) }])
    assert.deepEqual(vectorStore.search(space, 'm', axis(0), { limit: 1 }).map((hit) => hit.sourceKey), ['a'])
    vectorStore.replace(space, 'c', 'm', [{ vector: axis(0) }, { vector: axis(2) }])
    vectorStore.replace(space, 'a', 'm', [{ vector: axis(3) }])
    assert.deepEqual(vectorStore.search(space, 'm', axis(0), { minScore: 0.5 }).map((hit) => hit.sourceKey), ['c'], 'a moved, c joined')
    assert.deepEqual(vectorStore.search(space, 'm', axis(3), { minScore: 0.5 }).map((hit) => hit.sourceKey), ['a'])
    vectorStore.remove(space, 'c')
    assert.deepEqual(vectorStore.search(space, 'm', axis(0), { minScore: 0.5 }), [])
    for (let i = 0; i < 3000; i += 1) vectorStore.replace(space, 'churn', 'm', [{ vector: axis(i % 8) }])
    assert.deepEqual(vectorStore.search(space, 'm', axis(1), { minScore: 0.5 }).map((hit) => hit.sourceKey).sort(), ['b'], 'compacted, still right')
    assert.equal(vectorStore.contentHash(space, 'b', 'm'), null)
    assert.equal(vectorStore.contentHash(space, 'gone', 'm'), undefined)
    vectorStore.replace(space, 'ties', 'm', Array.from({ length: 12 }, () => ({ vector: axis(1), ownerKey: 'reader' })))
    const options = { sourceKeys: ['ties', 'b', 'ties'], ownerKeys: ['reader', null] }
    const all = vectorStore.search(space, 'm', axis(1), options)
    assert.equal(all.length, 13, 'a repeated source filter does not duplicate hits')
    for (const limit of [1, 5, 20]) {
      assert.deepEqual(vectorStore.search(space, 'm', axis(1), { ...options, limit }), all.slice(0, limit), 'top K retains stable tie order and owner/source filtering')
    }
  })

  await t.test('versions: an older library is below the pinned one', () => {
    assert.equal(embedding.versionBelow('4.57.1', '5.19.0'), true)
    assert.equal(embedding.versionBelow('5.19.0', '5.19.0'), false)
    assert.equal(embedding.versionBelow('5.19.0.dev0', '5.19.0'), false)
    assert.equal(embedding.versionBelow('5.20.1', '5.19.0'), false)
    assert.equal(embedding.versionBelow('6.0.0+cpu', '6.1.0'), true)
  })

  await t.test('another DB connection refreshes the cache and oversized spaces retain owner/source filtering', async () => {
    const Database = (await import('better-sqlite3')).default
    const { VECTOR_DB_PATH } = await import('../src/database/vectorDb')
    const { vectorCachePolicy } = await import('../src/services/vectors/vectorStore')
    const space = 'external-cache'
    vectorStore.replace(space, 'a', 'm', [{ vector: [1, 0], ownerKey: 'reader' }])
    assert.equal(vectorStore.search(space, 'm', [1, 0])[0].score, 1)
    const other = new Database(VECTOR_DB_PATH)
    try {
      other.prepare('UPDATE vectors SET vector = ? WHERE space = ?').run(Buffer.from(new Float32Array([0, 1]).buffer), space)
      assert.equal(vectorStore.search(space, 'm', [1, 0])[0].score, 0, 'external commits invalidate a loaded matrix')
      other.prepare("INSERT INTO vectors SELECT space, 'b', chunk, model_key, dim, owner_key, content_hash, span_start, span_end, vector, updated_at FROM vectors WHERE space = ?").run(space)
      assert.equal(vectorStore.search(space, 'm', [0, 1]).length, 2)
      other.prepare("DELETE FROM vectors WHERE space = ? AND source_key = 'a'").run(space)
      assert.deepEqual(vectorStore.search(space, 'm', [0, 1]).map(hit => hit.sourceKey), ['b'])
    } finally { other.close() }
    vectorStore.replace(space, 'private', 'm', [{ vector: [0, 1], ownerKey: 'other' }])
    vectorStore.replace(space, 'public', 'm', [{ vector: [1, 0], ownerKey: null }])
    const budget = vectorCachePolicy.maxMatrixBytes
    const options = { sourceKeys: ['b', 'public', 'private'], ownerKeys: ['reader', null], limit: 2 }
    const expected = vectorStore.search(space, 'm', [0, 1], options)
    assert.ok(vectorCachePolicy.matrixBytes > 0)
    try {
      vectorCachePolicy.maxMatrixBytes = 1
      assert.deepEqual(vectorStore.search(space, 'm', [0, 1], options), expected, 'streamed search preserves the same scores and boundaries')
      assert.equal(vectorCachePolicy.matrixBytes, 0, 'oversized matrices are evicted rather than exempted from the budget')
    } finally { vectorCachePolicy.maxMatrixBytes = budget; vectorStore.invalidateAll() }
  })

  await t.test('late indexing cannot resurrect deleted lore/recall or overwrite a newer message vector', async t => {
    const id = CodexChatStore.createThread(null, 'race', 'llm', profile.id)
    const message = say(id, 'assistant', 'old race message')
    const segment = Number(db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, ?, ?, ?)').run(id, message.id, message.id, 'old race summary').lastInsertRowid)
    const lore = ChatLorebookStore.create({ name: 'race', entries: [{ id: 'race', keys: ['race'], content: 'old race lore' }] })
    const request = embedding.textWorker.request.bind(embedding.textWorker)
    let release!: () => void
    let entered!: () => void
    let blocked = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    t.mock.method(embedding.textWorker, 'request', async (...args: Parameters<typeof request>) => {
      const [op, payload] = args
      if (op === 'embed' && (payload?.items as Array<{ text: string }>).some(item => item.text.includes('old race'))) {
        if (++blocked === 3) entered()
        await gate
      }
      return request(...args)
    })
    const old = Promise.all([indexMessagesNow([id], 32), indexSegmentsNow(id, 8), indexLoreNow(new Set([lore.id]), 16)])
    try {
      await started
      db.prepare('DELETE FROM chat_summary_segments WHERE id = ?').run(segment)
      ChatLorebookStore.delete(lore.id)
      CodexChatStore.editAssistantMessage(id, message.id, 'new race message')
      await indexMessagesNow([id], 32)
      const current = vectorStore.contentHash('chat-message', String(message.id), embedding.EMBEDDING_MODEL_KEY)
      release()
      await old
      assert.equal(vectorStore.get('chat-recall', String(segment), embedding.EMBEDDING_MODEL_KEY).length, 0)
      assert.equal(vectorStore.get('chat-lore', `${lore.id}:race`, embedding.EMBEDDING_MODEL_KEY).length, 0)
      assert.equal(vectorStore.contentHash('chat-message', String(message.id), embedding.EMBEDDING_MODEL_KEY), current)
      assert.equal(current, dbModule.semanticTextHash('new race message'))
    } finally { release(); await old; CodexChatStore.deleteThread(id) }
  })

  await t.test('history keyword results are not held behind a backfill request', async t => {
    const id = CodexChatStore.createThread(null, 'history wait', 'llm', profile.id)
    say(id, 'user', 'history wait keyword')
    const request = embedding.textWorker.request.bind(embedding.textWorker)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    t.mock.method(embedding.textWorker, 'request', async (...args: Parameters<typeof request>) => {
      if (args[0] === 'embed' && args[1]?.kind === 'document') await gate
      return request(...args)
    })
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([searchChatHistory([id], 'keyword', 10), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('history waited for background indexing')), 1000) })])
      assert.equal(result[0].excerpt, 'history wait keyword')
    } finally { clearTimeout(timer); release(); await indexMessagesNow([id], 32); CodexChatStore.deleteThread(id) }
  })

  await t.test('knowledge semantics: optional, permissions before ranking, and current content only', async () => {
    const { PostStore } = await import('../src/services/posts/postStore')
    const { KnowledgeStore } = await import('../src/services/posts/knowledgeStore')
    const { semanticPostCandidates, postSemanticStatus } = await import('../src/services/embeddings/postSemantic')
    const { updatePostsSettings } = await import('../src/services/posts/postsSettings')
    const owner = { accountId: 1, isAdmin: true, keys: new Set<string>(), profileId: null, origin: 'human' as const }
    const reader = { accountId: 2, isAdmin: false, keys: new Set(['posts.view']), profileId: null, origin: 'human' as const }
    let publicPost = PostStore.create(owner, { title: '겨울 여행 지식', body: '설원에서 늑대를 피해 이끼를 찾아갔다.' })
    let privatePost = PostStore.create(owner, { title: '비공개 계획', body: '설원 늑대 이끼 늑대 늑대', status: 'hidden' })
    publicPost = KnowledgeStore.patch(owner, publicPost.id, { expectedRevision: publicPost.revision, enabled: true })
    privatePost = KnowledgeStore.patch(owner, privatePost.id, { expectedRevision: privatePost.revision, enabled: true })
    settingsService.updateEmbeddingSettings({ postSearch: false })
    const before = requests.length
    assert.deepEqual(await semanticPostCandidates(reader, '눈밭'), [])
    assert.equal(requests.length, before, 'disabled knowledge search never starts or requests the worker')
    assert.equal(postSemanticStatus(reader).total, 1, 'status does not disclose private document counts')
    settingsService.updateEmbeddingSettings({ postSearch: true })
    while (await semanticIndexer.sweep() > 0) { /* existing indexer drains the isolated fixtures */ }
    assert.ok(vectorStore.get('post-knowledge', String(privatePost.id), embedding.EMBEDDING_MODEL_KEY).length)
    assert.deepEqual((await semanticPostCandidates(reader, '눈밭')).map(hit => hit.postId), [publicPost.id])
    assert.equal(postSemanticStatus(reader).indexed, 1)
    publicPost = PostStore.update(owner, publicPost.id, { expectedRevision: publicPost.revision, body: '고춧가루를 넣고 스튜를 끓였다.' })
    assert.deepEqual(await semanticPostCandidates(reader, '눈밭'), [], 'a stale vector cannot return the old procedure')
    assert.equal(postSemanticStatus(reader).indexed, 0)
    updatePostsSettings({ knowledge: { enabled: false } })
    const disabledBefore = requests.length
    assert.deepEqual(await semanticPostCandidates(reader, '스튜'), [])
    assert.equal(requests.length, disabledBefore, 'the knowledge master switch also prevents semantic requests')
    updatePostsSettings({ knowledge: { enabled: true } })
    KnowledgeStore.trash(owner, publicPost.id, { expectedRevision: publicPost.revision })
    semanticIndexInternals.pruneVectors()
    assert.equal(vectorStore.get('post-knowledge', String(publicPost.id), embedding.EMBEDDING_MODEL_KEY).length, 0)
    settingsService.updateEmbeddingSettings({ postSearch: false })
  })

  await t.test('knowledge search combines semantic relevance and quality within a band while retaining unindexed keyword candidates', async () => {
    const { PostStore } = await import('../src/services/posts/postStore')
    const { KnowledgeStore } = await import('../src/services/posts/knowledgeStore')
    const { KnowledgeAssessmentStore } = await import('../src/services/posts/knowledgeAssessment')
    const { updatePostsSettings } = await import('../src/services/posts/postsSettings')
    const owner = { accountId: 1,isAdmin: true,keys: new Set<string>(),profileId: null,origin: 'human' as const }
    const reader = { accountId: 2,isAdmin: false,keys: new Set(['posts.view','posts.evaluate']),profileId: null,origin: 'human' as const }
    semanticIndexer.stop()
    settingsService.updateEmbeddingSettings({ postSearch: true })
    updatePostsSettings({ knowledge: { rankingEnabled: true } })
    const make = (title: string,body: string) => {
      const post=PostStore.create(owner,{title,body})
      return KnowledgeStore.patch(owner,post.id,{expectedRevision:post.revision})
    }
    const strong=make('관련 절차','눈밭에서 진행하는 절차')
    const weak=make('보충 절차','눈밭에서 고춧가루를 준비하는 절차')
    while(await semanticIndexer.sweep()>0) { /* existing worker fake produces real indexed candidates */ }
    const unindexed=make('아직 색인 중인 절차','눈밭에서 진행하는 절차')
    assert.equal(vectorStore.get('post-knowledge',String(unindexed.id),embedding.EMBEDDING_MODEL_KEY).length,0)
    KnowledgeStore.review(owner,strong.id,{contentVersion:1,action:'verify'})
    KnowledgeAssessmentStore.vote(reader,weak.id,{contentVersion:1,idempotencyKey:'semantic-weak-up',quality:'up'})
    const initial=await PostStore.list(reader,{q:'눈밭',kind:'knowledge',sort:'relevance'})
    assert.deepEqual(initial.items.map(post=>post.id),[strong.id,weak.id,unindexed.id],'stronger semantic relevance wins over a small quality bonus inside the same body-match band')
    for(let index=0;index<10;index++) KnowledgeAssessmentStore.vote({...reader,accountId:100+index},strong.id,{contentVersion:1,idempotencyKey:`semantic-strong-down-${index}`,quality:'down'})
    const penalized=await PostStore.list(reader,{q:'눈밭',kind:'knowledge',sort:'relevance'})
    assert.equal(penalized.items[0].id,weak.id,'grounded human negatives still lower a previously verified semantic match')
    assert.ok(penalized.items.some(post=>post.id===unindexed.id),'missing vectors never remove a keyword match')
    settingsService.updateEmbeddingSettings({postSearch:false})
    const keywords=await PostStore.list(reader,{q:'눈밭',kind:'knowledge',sort:'relevance'})
    assert.deepEqual(keywords.items.map(post=>post.id),[weak.id,unindexed.id,strong.id],'the same quality policy works with baseline keyword relevance only')
    updatePostsSettings({knowledge:{rankingEnabled:false}})
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
    assert.deepEqual(standouts(new Map([['a', 0.68], ['b', 0.73]]), 0.66, 0.06).map(([key]) => key), ['b'])
  })

  semanticIndexer.stop()
})
