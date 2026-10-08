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
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  updateChatSettings({ enabled: true })
  // This fixture tests private lore ownership; the chat engine still needs an active authorized reader.
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'] }))

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

  /** The system message split at the lore index: the persona prompt before it, the lore (and summary) from it on. */
  const systemParts = (sent: Array<{ role: string; content: unknown }>) => {
    const system = String(sent[0].content)
    const at = system.indexOf('## 로어북 목차')
    return { persona: at < 0 ? system : system.slice(0, at), lore: at < 0 ? '' : system.slice(at) }
  }

  await t.test('the system message ends with the index in book order, then every attached book\'s always-on entries', () => {
    say('user', '안녕')
    const sent = request()
    assert.equal(sent.filter((message) => message.role === 'system').length, 1, 'one system message: Qwen-style templates reject a second')
    const second = systemParts(sent).lore
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
    assert.ok(!systemParts(sent).persona.includes('왼손잡이'), 'always-on entries left the persona prompt')
    // With read_lore_file offered, the index says how to read a file.
    assert.match(systemParts(request(LORE_TOOL)).lore, /\(본문은 키워드가 나오면 참고 설정으로 간다\. 자료가 필요하면 read_lore_file\(책, 항목\)\)/)
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
    // An offset inside a character starts on the next one; a wrong one says how large the file is.
    const inside = await readLoreFile(chat, { book: '[카이]', title: '어린 시절', offset: 1 })
    assert.equal(inside.offset, 3)
    assert.ok(inside.text.startsWith('닷가 마을의 기억.'))
    const size = Buffer.byteLength('바닷가 마을의 기억. '.repeat(300))
    await assert.rejects(readLoreFile(chat, { book: '[카이]', title: '어린 시절', offset: size + 1 }), new RegExp(`잘못된 읽기 범위야 \\(파일 크기 ${size}바이트\\)`))
    // A file longer than one call ends with where to go on.
    assert.equal(
      loreFileResultText({ book: '카이', title: '어린 시절', file: '자료/어린시절.md', text: '바닷가', offset: 0, nextOffset: 32000, size: 40000 }),
      '[자료 자료/어린시절.md]\n바닷가\n[/자료]\n(파일 40000바이트 중 32000바이트까지 읽음. 이어 읽으려면 read_lore_file(book="카이", title="어린 시절", offset=32000))',
    )

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

  await t.test('timed lore: message boundaries, active path, member isolation and card conversion', async (t) => {
    const { selectLoreEntries, loreEntryKey } = await import('../src/services/codex-chat/chatLorebook')
    const { loreDiagnostics, metadataOnly } = await import('../src/services/codex-chat/chatContextDiagnostics')
    const { importChatCard, readLorebookFile } = await import('../src/services/codex-chat/chatCardImport')
    const { branchChatThread } = await import('../src/services/codex-chat/chatBranch')
    const { selectChatLore } = await import('../src/services/codex-chat/llmChatContext')
    type History = import('../src/services/codex-chat/chatLorebook').LoreHistoryMessage
    const entry = { id: 'timed', keys: ['trigger'], content: 'timed body', sticky: 4, cooldown: 3 }
    const selectionMeta = (reason = 'key:trigger', bookId = 41) => JSON.stringify({ version: 2, loreEntries: [{ bookId, entryId: entry.id, selected: true, reason }] })
    const choose = (messages: History[], raw: unknown[] = [entry], timed = true) => selectLoreEntries(
      { lorebookIds: [], loreScanDepth: 1, loreTokenBudget: 1000 }, messages, (text) => text.length, (text) => text,
      { entries: normalizeLorebook(raw).map((entry) => ({ key: loreEntryKey(41, entry), entry, bookId: 41 })), ...(timed ? { timing: { messages } } : {}) },
    )
    const historyAt = (age: number, keyword = false): History[] => [
      { role: 'assistant', content: 'answer', context_meta: selectionMeta() },
      ...Array.from({ length: age - 1 }, () => ({ role: 'user', content: 'other' })),
    ].map((message, index) => keyword && index === age - 1 ? { ...message, content: 'trigger' } : message)

    await t.test('normalization defaults, integers, extensions and JSON round trips', () => {
      const [plain, invalid, imported] = normalizeLorebook([
        { content: 'plain' }, { content: 'bad', sticky: -1, cooldown: Infinity, delay: '2', group: 7 },
        { content: 'valid', sticky: 3.8, extensions: { cooldown: 2, delay: 4, group: ' scene ' } },
      ])
      for (const entry of [plain, invalid]) assert.deepEqual([entry.sticky, entry.cooldown, entry.delay, entry.group], [0, 0, 0, ''])
      assert.deepEqual([imported.sticky, imported.cooldown, imported.delay, imported.group], [3, 2, 4, 'scene'])
      assert.deepEqual(normalizeLorebook(JSON.stringify([imported]))[0], imported)
    })

    await t.test('sticky and cooldown use all messages, delay gates the exact count, and old records have no history', () => {
      for (const age of [1, 2, 3, 4]) {
        const chosen = choose(historyAt(age)).decisions[0]
        assert.equal(chosen.reason, 'sticky')
        assert.equal(chosen.remaining, 4 - age)
        assert.equal(chosen.selected, true)
      }
      for (const age of [5, 6, 7]) {
        const chosen = choose(historyAt(age, true)).decisions[0]
        assert.equal(chosen.reason, 'cooldown')
        assert.equal(chosen.selected, false)
      }
      assert.equal(choose(historyAt(8, true)).decisions[0].reason, 'key:trigger')
      assert.equal(choose(historyAt(8)).unmatched, 1)
      assert.equal(choose([{ role: 'user', content: 'trigger' }], [{ ...entry, delay: 2 }]).decisions[0].reason, 'delay')
      assert.equal(choose([{ role: 'user', content: 'other' }, { role: 'user', content: 'trigger' }], [{ ...entry, delay: 2 }]).decisions[0].selected, true)
      assert.equal(choose(historyAt(4), [{ ...entry, delay: 5 }]).decisions[0].reason, 'delay')
      assert.equal(choose(historyAt(5, true), [{ ...entry, constant: true }]).decisions[0].reason, 'cooldown')
      assert.equal(choose(historyAt(3, true), [{ ...entry, sticky: 0 }]).decisions[0].reason, 'cooldown')
      assert.equal(choose(historyAt(4, true), [{ ...entry, sticky: 0 }]).decisions[0].selected, true)
      for (const context_meta of [null, '{', JSON.stringify({ lore: ['timed'] }), JSON.stringify({ loreEntries: [{ bookId: 41, entryId: entry.id, selected: false }] })]) {
        assert.equal(choose([{ role: 'assistant', content: 'other', context_meta }]).keys.length, 0)
      }
      const diagnostic = metadataOnly({ version: 2, lore: [], ...loreDiagnostics(choose(historyAt(2)).decisions, 0) })
      assert.equal(diagnostic.loreEntries?.[0].remaining, 2)
      assert.equal(loreDiagnostics(choose(historyAt(5, true)).decisions, 0).loreSkipped?.[0].reason, 'cooldown')
    })

    await t.test('sticky selections do not renew the period and content edits keep the same timer', () => {
      const messages = historyAt(2)
      messages.push({ role: 'assistant', content: 'answer', context_meta: selectionMeta('sticky') }, { role: 'user', content: 'other' })
      const changed = choose(messages, [{ ...entry, content: 'edited body' }])
      assert.equal(changed.text, 'edited body')
      assert.equal(changed.decisions[0].remaining, 0)
      messages.push({ role: 'assistant', content: 'answer', context_meta: selectionMeta('sticky') }, { role: 'user', content: 'trigger' })
      assert.equal(choose(messages).decisions[0].reason, 'cooldown')
      messages.push({ role: 'assistant', content: 'answer' }, { role: 'user', content: 'trigger' })
      assert.equal(choose(messages).decisions[0].reason, 'key:trigger')
      let oldReads = 0
      const unread: History = { role: 'assistant', content: 'old', get context_meta(): string { oldReads++; return selectionMeta() } }
      assert.equal(choose([unread, ...Array.from({ length: 10000 }, () => ({ role: 'user', content: 'other' }))]).keys.length, 0)
      assert.equal(oldReads, 0)
    })

    await t.test('group winners prefer sticky then highest order, ties are stable, and Codex is unchanged', () => {
      const entries = [{ ...entry, group: 'scene', order: 1 }, { ...entry, id: 'other', group: 'scene', order: 99 }, { ...entry, id: 'free', group: '' }]
      assert.deepEqual(choose(historyAt(2, true), entries).decisions.filter((entry) => entry.selected).map((entry) => entry.entryId), ['timed', 'free'])
      assert.equal(choose(historyAt(2, true), entries).decisions.find((entry) => entry.entryId === 'other')?.reason, 'group')
      assert.equal(choose([{ role: 'user', content: 'trigger' }], entries).decisions.find((entry) => entry.entryId === 'other')?.selected, true)
      const ties = entries.slice(0, 2).map((entry) => ({ ...entry, order: 1 }))
      assert.equal(choose([{ role: 'user', content: 'trigger' }], ties).decisions.find((entry) => entry.selected)?.entryId, 'timed')
      const codex = choose([{ role: 'user', content: 'trigger' }], entries.map((entry) => ({ ...entry, delay: 100 })), false)
      assert.equal(codex.keys.length, 3)
      assert.equal(choose(historyAt(2), entries, false).keys.length, 0)
      const books = [{ id: 41, name: 'timed', label: 'timed', kind: 'global' as const, via: 'profile' as const, owner: null, folderId: null, entries: normalizeLorebook(entries.map((entry) => ({ ...entry, delay: 100 }))) }]
      assert.equal(selectChatLore({ ...kai, engine: 'codex' }, [{ content: 'trigger' }], null, { books }).keys.length, 3)
    })

    await t.test('regeneration, variant switches, edits and nested branches recompute from real active records', async (t) => {
      const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
      const timed = ChatProfileStore.create({ name: '시간', engine: 'llm', providerName: 'conn', loreScanDepth: 1, mcpEnabled: false, summaryEnabled: false })
      const id = CodexChatStore.createThread(1, '시간', 'llm', timed.id)
      let book = OwnedLorebookStore.saveChatBook(id, [entry])!
      const current = () => CodexChatStore.findThreadById(id)!
      const requester = { accountId: 1, accountType: 'admin' as const }
      t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }))
      await LlmChatService.sendMessage(requester, current(), 'trigger', () => {})
      const answer = CodexChatStore.listMessages(id).at(-1)!
      const original = JSON.parse(answer.context_meta!)
      assert.equal(original.loreEntries[0].reason, 'key:trigger')
      // The reply being regenerated must be absent from both its count and its history.
      await LlmChatService.rewriteMessage(requester, current(), answer.id, undefined, () => {})
      assert.equal(JSON.parse(CodexChatStore.listMessages(id).at(-1)!.context_meta!).loreEntries[0].reason, 'key:trigger')
      assert.equal(CodexChatStore.listMessages(id).at(-1)!.alternatives.length, 2)
      CodexChatStore.addAlternative(id, answer.id, { content: 'unused', tool_calls: [], status: 'completed', error: null, created_at: new Date().toISOString(), context_meta: JSON.stringify({ version: 2, loreEntries: [] }) })
      say('user', 'other', id)
      const selected = () => selectChatLore(timed, CodexChatStore.listMessages(id), null, { thread: current() })
      assert.equal(selected().keys.length, 0)
      CodexChatStore.selectAlternative(id, answer.id, 0)
      assert.equal(selected().decisions[0].reason, 'sticky')
      book = OwnedLorebookStore.saveChatBook(id, book.entries.map((entry) => ({ ...entry, content: 'changed body' })))!
      assert.equal(selected().keyed, 'changed body')
      assert.equal(selected().decisions[0].remaining, 2)
      const branchId = branchChatThread(current(), answer.id)!
      const branchBook = OwnedLorebookStore.chatBookOf(branchId)!
      assert.notEqual(book.id, branchBook.id)
      const inBranch = () => selectChatLore(timed, CodexChatStore.listMessages(branchId), null, { thread: CodexChatStore.findThreadById(branchId)! })
      assert.equal(inBranch().decisions[0].reason, 'sticky')
      assert.equal(inBranch().decisions[0].remaining, 3)
      const nestedId = branchChatThread(CodexChatStore.findThreadById(branchId)!, CodexChatStore.listMessages(branchId).at(-1)!.id)!
      assert.equal(selectChatLore(timed, CodexChatStore.listMessages(nestedId), null, { thread: CodexChatStore.findThreadById(nestedId)! }).decisions[0].reason, 'sticky')
      const firstUser = CodexChatStore.listMessages(id)[0]
      CodexChatStore.editUserMessage(id, firstUser.id, 'other')
      assert.equal(selected().keys.length, 0)
    })

    await t.test('group timers use the full room count and only the replying member history, outside the prompt window', () => {
      const roomId = ChatGroupStore.create(1, '시간 그룹', [kai.id, luna.id], kai.id)
      const room = CodexChatStore.findThreadById(roomId)!
      const book = OwnedLorebookStore.saveChatBook(roomId, [entry])!
      const answer = CodexChatStore.addMessage({ thread_id: roomId, role: 'assistant', content: 'answer', speaker_profile_id: kai.id, tool_calls: [], status: 'completed', error: null })
      CodexChatStore.setContextMeta(answer, JSON.parse(selectionMeta('key:trigger', book.id)))
      say('user', 'other', roomId)
      const request = (profile: typeof kai) => {
        let meta: import('../src/services/codex-chat/llmChatContext').ChatContextMeta | undefined
        buildGroupLlmMessages({ profile, thread: room, members: [kai, luna], messages: CodexChatStore.listMessages(roomId), windowLimit: 1, tools: [], withTools: false, maxTokens: null, onMeta: (value) => { meta = value } })
        return meta!
      }
      assert.equal(request(kai).loreEntries?.[0].reason, 'sticky')
      assert.equal(request(kai).loreEntries?.[0].remaining, 2)
      assert.equal(request(luna).loreEntries?.length, 0)
      for (let index = 0; index < 3; index++) CodexChatStore.addMessage({ thread_id: roomId, role: 'assistant', content: 'trigger', speaker_profile_id: luna.id, tool_calls: [], status: 'completed', error: null })
      assert.equal(request(kai).loreSkipped?.[0].reason, 'cooldown')
      assert.equal(request(luna).loreEntries?.[0].reason, 'key:trigger')
    })

    await t.test('disabled diagnostics still preserve activation history and remap branch book identifiers', () => {
      updateChatSettings({ diagnostics: { enabled: false } })
      try {
        const id = CodexChatStore.createThread(1, '비공개 진단', 'llm', kai.id)
        const book = OwnedLorebookStore.saveChatBook(id, [entry])!
        say('user', 'trigger', id)
        let meta: import('../src/services/codex-chat/llmChatContext').ChatContextMeta | undefined
        const thread = CodexChatStore.findThreadById(id)!
        buildChatMessages({ profile: { ...kai, loreScanDepth: 1 }, thread, messages: CodexChatStore.listMessages(id), config: resolveContextConfig(thread, kai), tools: [], onMeta: (value) => { meta = value } })
        assert.equal(meta!.version, undefined)
        assert.equal(meta!.sections, undefined)
        assert.equal(meta!.loreEntries?.[0].bookId, book.id)
        assert.equal(metadataOnly(meta!).loreEntries, undefined)
        const answer = say('assistant', 'answer', id)
        CodexChatStore.setContextMeta(answer, meta)
        const branchId = branchChatThread(thread, answer)!
        const selected = selectChatLore(kai, CodexChatStore.listMessages(branchId), null, { thread: CodexChatStore.findThreadById(branchId)! })
        assert.equal(selected.decisions[0].reason, 'sticky')
        assert.equal(selected.decisions[0].bookId, OwnedLorebookStore.chatBookOf(branchId)!.id)
      } finally {
        updateChatSettings({ diagnostics: { enabled: true } })
      }
    })

    await t.test('card imports convert row/extension fields, highest-order overrides and report ignored group scoring', async () => {
      const raw = [
        { id: 'plain', content: 'plain', keys: ['trigger'], order: 10000, group: 'scene' },
        { id: 'override', content: 'override', keys: ['trigger'], order: -10, extensions: { sticky: 4, cooldown: 3, delay: 2, group: 'scene', groupOverride: true, groupWeight: 25, useGroupScoring: true } },
        { id: 'row', content: 'row', sticky: 2, cooldown: 1, delay: 3, group: 'other', groupOverride: true, groupWeight: 10, useGroupScoring: false },
      ]
      const imported = await importChatCard(Buffer.from(JSON.stringify({ spec: 'chara_card_v2', data: { name: '시간 카드', character_book: { entries: raw } } })), 'conn')
      const book = ChatLorebookStore.find(imported.lorebookIds![0])!
      const winner = book.entries.find((entry) => entry.id === 'override')!
      assert.deepEqual([winner.sticky, winner.cooldown, winner.delay, winner.group], [4, 3, 2, 'scene'])
      assert.ok(winner.order > book.entries.find((entry) => entry.id === 'plain')!.order)
      assert.equal(normalizeLorebook(JSON.stringify(book.entries)).find((entry) => entry.id === 'override')!.order, winner.order)
      assert.ok(imported.importReport.converted.some((line) => line.includes('유지·쿨다운·지연')))
      assert.ok(imported.importReport.converted.some((line) => line.includes('포함 그룹')))
      assert.ok(imported.importReport.converted.some((line) => line.includes('groupOverride')))
      assert.ok(imported.importReport.dropped.some((line) => line.includes('그룹 가중치 무시')))
      assert.ok(imported.importReport.dropped.some((line) => line.includes('그룹 점수 무시')))
      assert.ok(!imported.importReport.dropped.some((line) => line.includes('유지·쿨다운·지연') || line.includes('포함 그룹')))
      const world = readLorebookFile(Buffer.from(JSON.stringify({ entries: Object.fromEntries(raw.map((entry, index) => [index, entry])) })), 'world.json')
      assert.deepEqual(world.entries, book.entries)
      assert.ok(!('groupOverride' in winner) && !('groupWeight' in winner) && !('useGroupScoring' in winner))
      const multiple = readLorebookFile(Buffer.from(JSON.stringify({ entries: [
        { id: 'low', content: 'low', group: 'scene', order: 2, groupOverride: true },
        { id: 'high', content: 'high', group: 'scene', order: 7, groupOverride: true },
        { id: 'ordinary', content: 'ordinary', group: 'scene', order: 10000 },
      ] })), 'multiple.json').entries
      assert.ok(multiple[1].order > multiple[0].order && multiple[0].order > multiple[2].order)
    })
  })
})
