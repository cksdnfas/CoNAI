import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('lore context: books per request, the index, always-on entries, linked files, read_lore_file', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-lore-context-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-lore-context-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { ChatLorebookStore, normalizeLorebook } = await import('../src/services/codex-chat/chatLorebook')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const lore = await import('../src/services/codex-chat/chatLoreContext')
  const { booksForRequest, buildLoreIndex, LORE_INDEX_MAX_TITLES } = lore
  const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
  const { buildGroupLlmMessages } = await import('../src/services/codex-chat/groupChatContext')
  const { exportChatMarkdown } = await import('../src/services/codex-chat/chatExport')
  const { readLoreFile, loreFileResultText } = await import('../src/mcp/tools/chatLoreTools')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')

  const me = fileOwnerKey(1)
  const other = fileOwnerKey(2)
  const setProfileBooks = (profileId: number, ids: number[]) => db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?').run(JSON.stringify(ids), profileId)
  const materialsOf = (owner: string, folderId: string | null) => FileStoreService.findChild(owner, folderId, '자료')!

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
  const luna = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'conn' })

  // Books: a global one, my account books (one for the profile, one for this chat), and another account's book that
  // someone linked to the same shared profile.
  const harbor = ChatLorebookStore.create({ name: '항구 도시 설정', entries: [{ keys: ['항구'], content: '항구 도시는 늘 안개가 낀다.' }] })
  const kaiBook = OwnedLorebookStore.create(me, { name: '카이', entries: [
    { title: '왼손잡이', keys: ['왼손'], content: '{{char}}는 왼손잡이다.', constant: true },
    { title: '어린 시절', keys: ['어린 시절'], content: '바닷가 마을에서 자랐다.' },
  ] })
  const taste = OwnedLorebookStore.create(me, { name: '내 취향', entries: [{ title: '단 음식', content: '{{user}}는 단 음식을 좋아한다.', constant: true }, { title: '커피', keys: ['커피'], content: '커피는 블랙.' }] })
  const theirs = OwnedLorebookStore.create(other, { name: '남의 책', entries: [{ title: '비밀', content: '다른 계정의 비밀.', constant: true }] })
  setProfileBooks(kai.id, [harbor.id, kaiBook.id, theirs.id])

  const threadId = CodexChatStore.createThread(1, '바다 약속', 'llm', kai.id)
  OwnedLorebookStore.setThreadLinks(threadId, [taste.id])
  OwnedLorebookStore.saveChatBook(threadId, [
    { id: 'promise', title: '바다 약속', content: '내일 저녁 바다에서 반지를 주기로 했다.\n아직 모른다.', constant: true },
    { id: 'ink', title: '먹물 실종', keys: ['먹물'], content: '고양이 먹물이 사흘째 안 보인다.' },
  ])
  const chatBook = OwnedLorebookStore.chatBookOf(threadId)!
  FileStoreService.writeText(me, materialsOf(me, chatBook.folderId).id, '전단지.md', '검은 고양이 먹물을 찾습니다. 왼쪽 귀에 흰 점.')
  OwnedLorebookStore.saveChatBook(threadId, chatBook.entries.map((entry) => entry.id === 'ink' ? { ...entry, file: '자료/전단지.md' } : entry))
  // A long file on the profile's account book: too big to go along, left to the tool.
  FileStoreService.writeText(me, materialsOf(me, kaiBook.folderId).id, '어린시절.md', '바닷가 마을의 기억. '.repeat(300))
  OwnedLorebookStore.update(kaiBook.id, me, { entries: OwnedLorebookStore.find(kaiBook.id, me)!.entries.map((entry) => entry.title === '어린 시절' ? { ...entry, file: '자료/어린시절.md' } : entry) })

  const thread = () => CodexChatStore.findThreadById(threadId)!
  const profile = () => ChatProfileStore.find(kai.id)!
  const say = (role: 'user' | 'assistant', content: string, id = threadId) => CodexChatStore.addMessage({ thread_id: id, role, content, tool_calls: [], status: 'completed', error: null })
  const request = (tools: Array<{ type: 'function'; function: { name: string } }> = []) => buildChatMessages({ profile: profile(), thread: thread(), messages: CodexChatStore.listMessages(threadId), config: resolveContextConfig(thread(), profile()), tools: tools as never })
  const LORE_TOOL = [{ type: 'function' as const, function: { name: 'read_lore_file' } }]

  await t.test('books: the chat book, chat links, the profile account books, then global ones; other owners skipped', () => {
    const books = booksForRequest({ thread: thread(), profile: profile() })
    assert.deepEqual(books.map((book) => [book.label, book.via]), [['이 채팅', 'chat'], ['내 취향', 'thread'], ['카이', 'profile'], ['항구 도시 설정', 'profile']])
    assert.ok(!books.some((book) => book.id === theirs.id), "another account's book on the shared profile is skipped")
    // The owner of that book sees it in their own chat with the same profile, and not mine.
    const theirThread = CodexChatStore.createThread(2, '남의 채팅', 'llm', kai.id)
    assert.deepEqual(booksForRequest({ thread: CodexChatStore.findThreadById(theirThread)!, profile: profile() }).map((book) => book.label), ['남의 책', '항구 도시 설정'])
    // A profile preview has no chat: global books only.
    assert.deepEqual(booksForRequest({ thread: null, profile: profile() }).map((book) => book.label), ['항구 도시 설정'])
  })

  await t.test('the second system message: index in book order, then every attached book\'s always-on entries', () => {
    say('user', '안녕')
    const sent = request()
    const second = String(sent[1].content)
    assert.equal(second, [
      '## 로어북 목차',
      '[이 채팅] 바다 약속 · 먹물 실종(자료)',
      '[내 취향] 단 음식 · 커피',
      '[카이] 왼손잡이 · 어린 시절(자료)',
      '[항구 도시 설정] 항구',
      '(본문은 키워드가 나오면 참고 설정으로 간다.)',
      '',
      '## 상시 항목',
      '- 바다 약속: 내일 저녁 바다에서 반지를 주기로 했다. 아직 모른다.',
      '- 단 음식: 사용자는 단 음식을 좋아한다.',
      '- 왼손잡이: 카이는 왼손잡이다.',
    ].join('\n'))
    assert.ok(!JSON.stringify(sent).includes('다른 계정의 비밀'))
    assert.ok(!String(sent[0].content).includes('왼손잡이'), 'always-on entries left the persona prompt')
    // With read_lore_file offered, the index says how to read a file.
    assert.match(String(request(LORE_TOOL)[1].content), /\(본문은 키워드가 나오면 참고 설정으로 간다\. 자료가 필요하면 read_lore_file\(책, 항목\)\)/)
  })

  await t.test('index caps: 40 titles a book, then the whole index, global books giving up their titles first', () => {
    const book = (id: number, label: string, kind: 'chat' | 'account' | 'global', count: number, title = (index: number) => `항목${index}`) => ({
      id, name: label, label, kind, via: kind === 'chat' ? 'chat' as const : 'profile' as const, owner: null, folderId: null,
      entries: normalizeLorebook(Array.from({ length: count }, (_, index) => ({ title: title(index), content: 'x' }))),
    })
    const estimate = (text: string) => text.length
    const big = buildLoreIndex([book(1, '큰 책', 'global', LORE_INDEX_MAX_TITLES + 1), book(2, '작은 책', 'global', 2)], estimate, (text) => text, false)
    assert.ok(big.includes(`[큰 책] ${LORE_INDEX_MAX_TITLES + 1}개 항목`))
    assert.ok(big.includes('[작은 책] 항목0 · 항목1'))
    const long = (index: number) => `아주 긴 항목 제목 ${index}번`
    const books = [book(1, '채팅', 'chat', 30, long), book(2, '계정', 'account', 30, long), book(3, '글로벌', 'global', 30, long)]
    const index = buildLoreIndex(books, estimate, (text) => text, false)
    assert.ok(estimate(index) <= lore.LORE_INDEX_MAX_TOKENS)
    assert.ok(index.includes('[글로벌] 30개 항목'), 'global titles go first')
    assert.ok(index.includes('[계정] 아주 긴 항목 제목 0번'), 'account titles stay while they fit')
    const tighter = buildLoreIndex([...books, book(4, '계정2', 'account', 30, long)], estimate, (text) => text, false)
    assert.ok(tighter.includes('[글로벌] 30개 항목') && tighter.includes('[계정2] 30개 항목'), 'then account books, the later first')
    assert.ok(tighter.includes('[채팅] 아주 긴 항목 제목 0번'), "the chat's own book keeps its titles")
    assert.equal(buildLoreIndex([book(1, '빈 책', 'global', 0)], estimate, (text) => text, false), '', 'no enabled entries, no index')
  })

  await t.test('a matched entry takes a small file along; a large one leaves a hint for the tool', () => {
    say('assistant', '응')
    say('user', '먹물 전단지 어디 붙였어? 그리고 어린 시절 얘기 해 줘.')
    const reference = (sent: ReturnType<typeof request>) => sent.filter((message) => message.role === 'user').map((message) => String(message.content)).find((content) => content.startsWith('[참고 설정]')) ?? ''
    const withTool = reference(request(LORE_TOOL))
    assert.ok(withTool.includes('고양이 먹물이 사흘째 안 보인다.\n  자료 전단지.md: "검은 고양이 먹물을 찾습니다. 왼쪽 귀에 흰 점."'), withTool)
    assert.ok(withTool.includes('바닷가 마을에서 자랐다.\n  (자료 있음: 어린시절.md; read_lore_file("카이", "어린 시절")로 읽기)'), withTool)
    assert.ok(!withTool.includes('바닷가 마을의 기억'), 'the large file stays out')
    const withoutTool = reference(request())
    assert.ok(withoutTool.includes('바닷가 마을에서 자랐다.\n  (자료 있음: 어린시절.md)'), 'no tool, no call to suggest')
  })

  await t.test('a group room member gets the room\'s book and its own profile books', () => {
    const lunaBook = OwnedLorebookStore.create(me, { name: '루나', entries: [{ title: '달', content: '루나는 달을 좋아한다.', constant: true }] })
    setProfileBooks(luna.id, [lunaBook.id])
    const roomId = ChatGroupStore.create(1, '방', [kai.id, luna.id], kai.id)
    OwnedLorebookStore.saveChatBook(roomId, [{ id: 'room', title: '방 규칙', content: '방에서는 존댓말을 쓰지 않는다.', constant: true }])
    say('user', '다들 안녕', roomId)
    const room = CodexChatStore.findThreadById(roomId)!
    const members = [ChatProfileStore.find(kai.id)!, ChatProfileStore.find(luna.id)!]
    const sentTo = (member: typeof members[number]) => String(buildGroupLlmMessages({ profile: member, thread: room, members, messages: CodexChatStore.listMessages(roomId), windowLimit: 10, tools: [], maxTokens: null, withTools: false })[0].content)
    const toLuna = sentTo(members[1])
    assert.ok(toLuna.includes('[이 채팅] 방 규칙\n[루나] 달'), toLuna)
    assert.ok(toLuna.includes('- 방 규칙: 방에서는 존댓말을 쓰지 않는다.\n- 달: 루나는 달을 좋아한다.'))
    assert.ok(!toLuna.includes('[카이]'), "another member's books stay with that member")
    assert.ok(sentTo(members[0]).includes('[이 채팅] 방 규칙\n[카이] 왼손잡이'))
    // The context tab lists the room's book and every member's books once, naming who brings them.
    const view = lore.threadLorebooks(room, members)
    assert.equal(view.chatBook?.entries[0].title, '방 규칙')
    assert.deepEqual(view.books.map((book) => [book.name, book.via, book.profiles.map((member) => member.name)]), [['카이', 'profile', ['카이']], ['루나', 'profile', ['루나']], ['항구 도시 설정', 'profile', ['카이']]])
  })

  await t.test('the context tab: the chat book, then profile account books, chat links and global books, each once', () => {
    const view = lore.threadLorebooks(thread(), [profile()])
    assert.deepEqual(view.chatBook?.entries.map((entry) => entry.id), ['promise', 'ink'])
    assert.deepEqual(view.linkedIds, [taste.id])
    assert.deepEqual(view.books.map((book) => [book.name, book.kind, book.via]), [['카이', 'account', 'profile'], ['내 취향', 'account', 'thread'], ['항구 도시 설정', 'global', 'profile']])
    assert.equal(view.books.find((book) => book.kind === 'global')?.folderId, null)
    assert.ok(view.books.find((book) => book.name === '카이')?.folderId)
  })

  await t.test("the export lists the chat book's entries under 로어북", () => {
    const markdown = exportChatMarkdown(thread(), CodexChatStore.listMessages(threadId), [], '카이', 'http://localhost')
    assert.ok(markdown.includes('## 로어북\n\n- 바다 약속: 내일 저녁 바다에서 반지를 주기로 했다. 아직 모른다.\n- 먹물 실종: 고양이 먹물이 사흘째 안 보인다. (자료: 자료/전단지.md)\n'), markdown)
    assert.ok(!markdown.includes('고정 기억') && !markdown.includes('왼손잡이'), 'only the chat book')
  })

  await t.test('read_lore_file returns the file as data and says what is there when nothing matches', async () => {
    const chat = { threadId, profileId: kai.id, accountId: 1 }
    const result = await readLoreFile(chat, { book: '이 채팅', title: '먹물 실종' })
    assert.equal(loreFileResultText(result), '[자료 자료/전단지.md]\n검은 고양이 먹물을 찾습니다. 왼쪽 귀에 흰 점.\n[/자료]')
    assert.equal((await readLoreFile(chat, { book: '[카이]', title: '어린 시절' })).text.length, '바닷가 마을의 기억. '.length * 300)
    assert.equal((await readLoreFile(chat, { book: '이 채팅', title: '먹물' })).file, '자료/전단지.md', 'the first keyword finds it too')
    await assert.rejects(readLoreFile(chat, { book: '이 채팅', title: '없는 항목' }), (error: Error & { status?: number }) => error.status === 404 && /not found.*먹물 실종/.test(error.message))
    await assert.rejects(readLoreFile(chat, { book: '남의 책', title: '비밀' }), /Lorebook not found/)
    await assert.rejects(readLoreFile(chat, { book: '이 채팅', title: '바다 약속' }), /no linked file/)
    await assert.rejects(readLoreFile({ ...chat, accountId: 2 }, { book: '이 채팅', title: '먹물 실종' }), /Chat not found/, "another account's chat")

    // Through the chat's MCP bridge: offered beside the room tools while a reply is running, with no scopes needed.
    const context = { threadId, profileId: kai.id, kind: 'direct' as const, replyId: 'lore-reply' }
    const controller = new AbortController()
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: 1, accountType: 'admin' } as never, [], null, { chatContext: context })
    try {
      assert.ok(bridge.tools.some((tool) => tool.function.name === 'read_lore_file'))
      const called = await bridge.call('read_lore_file', { book: '이 채팅', title: '먹물 실종' })
      assert.ok(!called.isError)
      assert.match(JSON.stringify(called.content), /\[자료 자료\/전단지\.md\]/)
    } finally {
      await bridge.close()
      unregister()
    }
    // A chat whose books link no file is not offered the tool.
    const plain = CodexChatStore.createThread(1, '빈 채팅', 'llm', luna.id)
    const quiet = await openChatMcpBridge({ accountId: 1, accountType: 'admin' } as never, [], null, { chatContext: { threadId: plain, profileId: luna.id, kind: 'direct', replyId: 'quiet' } })
    try {
      assert.ok(!quiet.tools.some((tool) => tool.function.name === 'read_lore_file'))
    } finally {
      await quiet.close()
    }
  })
})
