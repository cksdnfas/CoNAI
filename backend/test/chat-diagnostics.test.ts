import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { test } from 'node:test'
import type { ChatContextMeta } from '../src/services/codex-chat/llmChatContext'
import type { ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'

test('chat diagnostics: capture, read-time permissions, alternatives, branches and group persistence', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-diagnostics-test-'))
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
    assert.equal(path.dirname(root), temp)
    assert.ok(path.basename(root).startsWith('conai-diagnostics-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { codexInputMeta } = await import('../src/services/codex-chat/codexChatService')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { ChatSummaryStore, selectRecall } = await import('../src/services/codex-chat/chatMemory')
  const { ChatLorebookStore, normalizeLorebook, selectLoreEntries, loreEntryKey } = await import('../src/services/codex-chat/chatLorebook')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
  const { loadChatSettings, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { getChatDiagnostics, exportChatDiagnostics, visibleContextMessages } = await import('../src/services/codex-chat/chatDiagnostics')
  const { contextHash, contextSource, limitContextMeta, CHAT_CONTEXT_META_LIMITS } = await import('../src/services/codex-chat/chatContextDiagnostics')
  const { saveChatRequestCapture, redactChatRequestBody, readChatRequestCapture } = await import('../src/services/codex-chat/chatRequestCaptures')
  const { branchChatThread } = await import('../src/services/codex-chat/chatBranch')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { diagnosticsScopeOf, diagnosticsScopeForProfile } = await import('../src/services/codex-chat/codexChatAccess')
  const ADMIN_MARKER = 'test:admin'
  const diagnosticKeys = ['chat.diagnostics.view', ADMIN_MARKER]
  let grants = [...diagnosticKeys]
  // Raw prompts are an administrator view, so the test's account is an administrator while it holds that marker.
  t.mock.method(AuthAccount, 'findById', (id) => ({ id, status: 'active', account_type: grants.includes(ADMIN_MARKER) ? 'admin' : 'guest' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use', ...grants.filter((key) => key !== ADMIN_MARKER)] }))
  t.mock.method(AuthAccessControlService, 'hasPermission', () => true)
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: JSON.stringify({ max_concurrent_requests: 3 }) }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => 'fake-api-secret')
  const requests: Array<{ messages: ChatCompletionMessage[]; tools?: unknown[] }> = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fake-api-secret')
    assert.ok(!String(init?.body).includes('fake-api-secret'))
    requests.push(body)
    return Response.json({ choices: [{ message: { content: '답변 본문' }, finish_reason: 'stop' }], usage: { prompt_tokens: 123 } })
  })
  assert.deepEqual(loadChatSettings().diagnostics, { enabled: true, captureRaw: false, captureLimit: 20 })
  updateChatSettings({ enabled: true, diagnostics: { enabled: true, captureRaw: false, captureLimit: 2 } })
  const requester = { accountId: 1, accountType: 'admin' as const }
  const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'test', model: 'm', pageAssist: true, systemPrompt: 'ADMIN_SYSTEM_PRIVATE',
    promptSections: [{ id: 'private', title: '설정', kind: 'text', enabled: true, content: 'ADMIN_SECTION_PRIVATE' }, { id: 'post', title: '', kind: 'post', enabled: true, content: 'ADMIN_POST_PRIVATE' }],
    authorNote: '사용자에게 보이는 작가 노트', extraParams: '{"private_custom":"EXTRA_SECRET"}', summaryEnabled: false, mcpEnabled: false })
  const threadId = CodexChatStore.createThread(requester.accountId, '진단 / 시험', 'llm', profile.id)
  const thread = () => CodexChatStore.findThreadById(threadId)!
  const message = (id: number) => CodexChatStore.listMessages(threadId).find((entry) => entry.id === id)!
  const metaOf = (id: number) => JSON.parse(message(id).context_meta!) as ChatContextMeta
  const countCaptures = () => (db.prepare('SELECT COUNT(*) AS n FROM chat_request_captures').get() as { n: number }).n
  const global = ChatLorebookStore.create({ name: '전역', entries: [{ id: 'world', title: '바다', keys: ['바다'], content: '이미 공개된 글로벌 본문' }] })
  ChatProfileStore.update(profile.id, { lorebookIds: [global.id] })
  const accountBook = OwnedLorebookStore.create(fileOwnerKey(1), { name: '계정', entries: [{ id: 'account', keys: ['바다'], content: '내 계정 로어 본문' }] })
  OwnedLorebookStore.linkProfile(profile.id, accountBook.id, fileOwnerKey(1))
  const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
  const state = ChatSharedBlockStore.create({ name: '상태', block: { key: 'status', example: '{"hp":2}', rules: '상태의 공개 규칙\n두 번째 규칙도 보여' } })
  ChatProfileStore.update(profile.id, { blockIds: [state.id] })
  const { ChatUserProfileStore } = await import('../src/services/codex-chat/chatUserProfiles')
  const persona = ChatUserProfileStore.create(1, { name: '사용자', persona: '내 사용자 페르소나' })
  ChatUserProfileStore.setThreadUserProfile(threadId, persona.id)
  const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
  const flag = ChatFlagStore.create(requester, { name: '조용히', content: '공개된 플래그 본문' })
  OwnedLorebookStore.saveChatBook(threadId, [{ id: 'pinned', title: '약속', constant: true, content: '채팅 책 상시 본문' }])
  let answerId = 0

  await t.test('final sections include connected-page guidance and both continuation messages', async () => {
    const updated = ChatProfileStore.update(profile.id, { mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page'] })!
    const page = { instanceId: 'page-12345678', connectionId: 'connection-12345678', revision: 'revision-12345678', title: '테스트 페이지', path: '/groups', kind: 'groups', resourceId: null, fields: [], actions: [] }
    await LlmChatService.sendMessage(requester, thread(), '바다로 가자', () => {}, undefined, [flag.id], undefined, undefined, undefined, page)
    answerId = CodexChatStore.listMessages(threadId).at(-1)!.id
    assert.equal(message(answerId).status, 'completed', message(answerId).error ?? '')
    let meta = metaOf(answerId)
    const request = requests.at(-1)!
    const messages = meta.sections!.filter((section) => section.role !== 'tool-definition')
    assert.equal(messages.length, request.messages.length)
    assert.deepEqual(messages.map(({ position, role }) => [position, role]), request.messages.map((entry, index) => [index, entry.role]))
    assert.ok(messages.some((section) => section.kind === 'page'))
    assert.equal(meta.promptTokens, 123)
    assert.ok(!JSON.stringify(meta).includes('ADMIN_SYSTEM_PRIVATE'))
    assert.equal(countCaptures(), 0)
    ChatProfileStore.update(updated.id, { mcpEnabled: false, toolAllowlist: null })
    await LlmChatService.continueReply(requester, thread(), answerId, () => {})
    meta = metaOf(answerId)
    const continued = requests.at(-1)!.messages
    const messageSections = meta.sections!.filter((section) => section.role !== 'tool-definition')
    assert.equal(messageSections.length, continued.length)
    assert.deepEqual(messageSections.slice(-2).map(({ kind, role }) => [kind, role]), [['continuation', 'assistant'], ['continuation', 'user']])
  })

  await t.test('a profile with the page assistant off refuses a connected page', async () => {
    const page = { instanceId: 'page-87654321', connectionId: 'connection-87654321', revision: 'revision-87654321', title: '테스트 페이지', path: '/groups', kind: 'groups', resourceId: null, fields: [], actions: [] }
    ChatProfileStore.update(profile.id, { pageAssist: false })
    try {
      await assert.rejects(LlmChatService.sendMessage(requester, thread(), '페이지 봐줘', () => {}, undefined, undefined, undefined, undefined, undefined, page), /어시스턴트/)
    } finally { ChatProfileStore.update(profile.id, { pageAssist: true }) }
  })

  await t.test('view/content/prompts are cumulative and rechecked on every historical read and export', async () => {
    assert.equal(diagnosticsScopeOf([], false), 'none')
    assert.equal(diagnosticsScopeOf(['chat.diagnostics.view'], false), 'content')
    assert.equal(diagnosticsScopeOf([], true), 'prompts')
    assert.equal(diagnosticsScopeForProfile('prompts', false), 'view', 'a deleted profile shows composition only')
    assert.equal(diagnosticsScopeForProfile('none', false), 'none')
    updateChatSettings({ diagnostics: { captureRaw: true } })
    saveChatRequestCapture(answerId, '{"messages":[{"content":"ADMIN_RAW_PRIVATE"}]}')
    for (const [keys, expected] of [[diagnosticKeys.slice(0, 1), 'content'], [diagnosticKeys, 'prompts']] as const) {
      grants = [...keys]
      const result = await getChatDiagnostics(requester, threadId, answerId)
      assert.equal(result.scope, expected)
      const body = JSON.stringify(result)
      if (expected === 'view') assert.equal(result.texts, undefined)
      if (expected === 'content') {
        assert.ok(result.texts?.every((source) => source.promptText === undefined))
        assert.ok(body.includes('이미 공개된 글로벌 본문'))
        assert.ok(body.includes('내 계정 로어 본문'))
        assert.ok(body.includes('채팅 책 상시 본문'))
        assert.ok(body.includes('사용자에게 보이는 작가 노트'))
        assert.ok(body.includes('내 사용자 페르소나'))
        assert.ok(body.includes('상태의 공개 규칙'))
        assert.ok(body.includes('공개된 플래그 본문'))
        assert.ok(!body.includes('아래 값이 지금 장면의 사실이야'))
        assert.ok(!body.includes('본문은 키워드가 나오면 참고 설정으로 간다'))
        const stateText = result.texts?.find((source) => source.kind === 'state')
        assert.ok(stateText?.text?.includes('두 번째 규칙도 보여'))
        assert.ok(stateText?.text?.includes('"hp":2'))
        assert.equal(stateText?.changedSince, false)
        assert.ok(result.texts?.find((source) => source.kind === 'lore-index')?.text?.includes('[이 채팅] 약속'))
      }
      const exported = await exportChatDiagnostics(requester, threadId, answerId)
      assert.match(exported.path, /채팅 진단\/\d{4}-\d{2}-\d{2}\/진단 _ 시험 \(#\d+-\d+\)\.json$/)
      const fileText = (await FileStoreService.readText(fileOwnerKey(requester.accountId), exported.file.id, 0, 32000)).text
      if (expected === 'prompts') {
        assert.ok(body.includes('ADMIN_SYSTEM_PRIVATE'))
        assert.ok(body.includes('ADMIN_RAW_PRIVATE'))
        assert.ok(fileText.includes('ADMIN_RAW_PRIVATE'))
        assert.ok(result.texts?.find((source) => source.kind === 'state')?.promptText?.includes('아래 값이 지금 장면의 사실이야'))
        assert.ok(result.texts?.find((source) => source.kind === 'lore-index')?.promptText?.includes('본문은 키워드가 나오면 참고 설정으로 간다'))
      } else {
        for (const hidden of ['ADMIN_SYSTEM_PRIVATE', 'ADMIN_SECTION_PRIVATE', 'ADMIN_POST_PRIVATE', 'ADMIN_RAW_PRIVATE', '아래 값이 지금 장면의 사실이야', '본문은 키워드가 나오면 참고 설정으로 간다']) {
          assert.ok(!body.includes(hidden), `${hidden} in ${expected} response`)
          assert.ok(!fileText.includes(hidden), `${hidden} in ${expected} export`)
        }
      }
    }
    grants = []
    await assert.rejects(getChatDiagnostics(requester, threadId, answerId), /권한/)
    const hidden = visibleContextMessages(thread(), [message(answerId)], requester.accountId)[0]
    assert.equal(JSON.parse(hidden.context_meta!).version, undefined)
    assert.ok(hidden.alternatives.every((variant) => !variant.context_meta || JSON.parse(variant.context_meta).version === undefined))
    assert.equal(metaOf(answerId).version, 2, 'read-time masking must not rewrite stored history')
    grants = [...diagnosticKeys]
    await assert.rejects(getChatDiagnostics({ ...requester, accountId: 2 }, threadId, answerId), /찾을 수 없어/)
    await assert.rejects(getChatDiagnostics(requester, threadId, answerId, 100), /변형/)
  })

  await t.test('state and lore-index keep public text at prompts scope and compare hashes against full prompt text', async () => {
    grants = [...diagnosticKeys]
    const prompts = await getChatDiagnostics(requester, threadId, answerId)
    for (const [kind, guidance] of [['state', '아래 값이 지금 장면의 사실이야'], ['lore-index', '본문은 키워드가 나오면 참고 설정으로 간다']] as const) {
      const source = prompts.texts?.find((entry) => entry.kind === kind)
      assert.ok(source?.text)
      assert.ok(source.promptText?.includes(guidance))
      assert.ok(!source.text.includes(guidance))
      if (kind === 'state') assert.ok(!source.text.includes('## 현재 상태'))
      assert.notEqual(contextHash(source.text), source.hash, `${kind} public text must differ from the full prompt`)
      assert.equal(contextHash(source.promptText!), source.hash)
      assert.equal(source.changedSince, false, `${kind} unchanged full prompt must not be marked changed`)
    }
    grants = diagnosticKeys.slice(0, 1)
    const content = await getChatDiagnostics(requester, threadId, answerId)
    for (const kind of ['state', 'lore-index']) {
      const source = content.texts?.find((entry) => entry.kind === kind)
      assert.equal(source?.text, prompts.texts?.find((entry) => entry.kind === kind)?.text)
      assert.equal(source?.promptText, undefined)
      assert.equal(source?.changedSince, false)
    }
    grants = [...diagnosticKeys]
  })

  await t.test('thread metadata resolves account grants once and each profile once per batch', async (s) => {
    const other = ChatProfileStore.create({ name: '범위 캐시', engine: 'llm', providerName: 'test', model: 'm' })
    const accountLookup = AuthAccount.findById
    const permissionLookup = AuthAccessControlService.resolveForAccountId
    const profileLookup = ChatProfileStore.find
    let accountReads = 0
    let permissionReads = 0
    const profileReads: number[] = []
    s.mock.method(AuthAccount, 'findById', (id) => { accountReads += 1; return accountLookup(id) })
    s.mock.method(AuthAccessControlService, 'resolveForAccountId', (id) => { permissionReads += 1; return permissionLookup(id) })
    s.mock.method(ChatProfileStore, 'find', (id) => { profileReads.push(id); return profileLookup(id) })
    const grouped = { ...thread(), kind: 'group' as const }
    const original = message(answerId)
    const messages = Array.from({ length: 2000 }, (_, index) => ({ ...original, id: index + 1, speaker_profile_id: index % 2 ? other.id : profile.id }))
    const visible = visibleContextMessages(grouped, messages, requester.accountId)
    assert.equal(accountReads, 1)
    assert.equal(permissionReads, 1)
    assert.deepEqual(profileReads, [profile.id, other.id])
    assert.equal(visible.length, messages.length)
    assert.equal(JSON.parse(visible[0].context_meta!).version, 2)
    assert.equal(JSON.parse(visible.at(-1)!.context_meta!).version, 2)
    assert.equal(JSON.parse(visible[0].context_meta!).scope, 'prompts')
    assert.equal(JSON.parse(visible[1].context_meta!).scope, 'prompts', 'every profile follows the account grant')
    assert.ok(visible[1].alternatives.every((variant) => !variant.context_meta || JSON.parse(variant.context_meta).scope === 'prompts'))
    assert.equal(JSON.parse(original.context_meta!).scope, undefined, 'scope belongs to the response, not stored history')
    grants = []
    const revoked = visibleContextMessages(grouped, messages, requester.accountId)
    assert.equal(accountReads, 2)
    assert.equal(permissionReads, 2)
    assert.deepEqual(profileReads, [profile.id, other.id, profile.id, other.id])
    assert.equal(JSON.parse(revoked[0].context_meta!).version, undefined)
    assert.equal(JSON.parse(revoked[0].context_meta!).scope, undefined)
    assert.ok(revoked[0].alternatives.every((variant) => !variant.context_meta || JSON.parse(variant.context_meta).version === undefined))
    grants = [...diagnosticKeys]
  })

  await t.test('group window fitting hashes the diagnostic only after the final window is chosen', async (s) => {
    const { buildGroupLlmMessages } = await import('../src/services/codex-chat/groupChatContext')
    const marker = 'REVIEW_FINAL_WINDOW_HASH_MARKER'
    const createHash = crypto.createHash
    let markerHashes = 0
    s.mock.method(crypto, 'createHash', (...args) => {
      const hash = createHash(...args)
      const update = hash.update
      hash.update = function (data, ...args) {
        if (data === marker) markerHashes += 1
        return update.call(this, data, ...args)
      }
      return hash
    })
    const bounded = { ...ChatProfileStore.find(profile.id)!, systemPrompt: marker, promptSections: [], contextTokens: 5000 }
    const grouped = { ...thread(), id: threadId + 100000, kind: 'group' as const, summary_enabled: 0 as const }
    const history = Array.from({ length: 6 }, (_, index) => ({ ...message(answerId), id: index + 1, role: 'user' as const, speaker_profile_id: null, tool_calls: [], flags: [], content: '가'.repeat(2000) }))
    let meta: ChatContextMeta | undefined
    const result = buildGroupLlmMessages({ profile: bounded, thread: grouped, members: [bounded], messages: history, windowLimit: 20, tools: [], maxTokens: 512, withTools: false, books: [], onMeta: (value) => { meta = value } })
    assert.ok(meta!.sentMessages < history.length, 'the token budget must force candidate windows to shrink')
    assert.equal(markerHashes, 2, 'the final section part and source are each hashed once')
    assert.equal(meta?.sections?.length, result.length)
  })

  await t.test('dropped turns count only unsummarized history outside direct and group windows', async () => {
    const { buildGroupLlmMessages } = await import('../src/services/codex-chat/groupChatContext')
    const current = { ...ChatProfileStore.find(profile.id)!, contextTokens: null }
    const history = Array.from({ length: 12 }, (_, index) => ({ ...message(answerId), id: index + 1, role: index % 2 ? 'assistant' as const : 'user' as const, speaker_profile_id: index % 2 ? profile.id : null, tool_calls: [], flags: [], content: `대화 ${index + 1}` }))
    for (const summaryEnabled of [true, false]) {
      for (const narrow of [false, true]) {
        const offset = (summaryEnabled ? 1 : 2) * 100000 + (narrow ? 10 : 20)
        const direct = { ...thread(), id: threadId + offset, summary: '두 턴의 요약', summary_until_message_id: 4, summary_enabled: summaryEnabled ? 1 as const : 0 as const }
        let directMeta: ChatContextMeta | undefined
        let groupMeta: ChatContextMeta | undefined
        buildChatMessages({ profile: current, thread: direct, messages: history, config: { ...resolveContextConfig(direct, current), summaryEnabled, contextTurns: narrow ? 2 : 20 }, tools: [], books: [], onMeta: (value) => { directMeta = value } })
        buildGroupLlmMessages({ profile: current, thread: { ...direct, id: direct.id + 1, kind: 'group' }, members: [current], messages: history, windowLimit: narrow ? 2 : 20, tools: [], maxTokens: null, withTools: false, books: [], onMeta: (value) => { groupMeta = value } })
        const expected = narrow ? summaryEnabled ? 3 : 5 : 0
        assert.equal(directMeta?.window?.droppedTurns, expected)
        assert.equal(groupMeta?.window?.droppedTurns, expected)
      }
    }
  })

  await t.test('edited current sources are marked and deleted ones unavailable', async () => {
    grants = [...diagnosticKeys]
    ChatLorebookStore.update(global.id, { entries: [{ id: 'world', title: '바다', keys: ['바다'], content: '고친 글로벌 본문' }] })
    let result = await getChatDiagnostics(requester, threadId, answerId)
    assert.equal(result.texts?.find((source) => source.kind === 'lore' && source.entryId === 'world')?.changedSince, true)
    ChatLorebookStore.update(global.id, { entries: [] })
    result = await getChatDiagnostics(requester, threadId, answerId)
    assert.equal(result.texts?.find((source) => source.kind === 'lore' && source.entryId === 'world')?.unavailable, true)
  })

  await t.test('v2 metadata survives alternatives and branches with message/recall ids remapped', async () => {
    const userId = CodexChatStore.listMessages(threadId).find((entry) => entry.role === 'user')!.id
    db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, ?, ?, ?)').run(threadId, userId, userId, '바다 반지 약속')
    const segment = ChatSummaryStore.list(threadId)[0]
    const original = metaOf(answerId)
    const meta = { ...original, recall: [{ segmentId: segment.id, score: 3, terms: ['바다'], hash: contextHash(segment.content) }] }
    CodexChatStore.setContextMeta(answerId, meta)
    const active = message(answerId).active_alternative
    CodexChatStore.addAlternative(threadId, answerId, { content: '다른 답변', tool_calls: [], status: 'completed', error: null, created_at: new Date().toISOString() })
    CodexChatStore.setContextMeta(answerId, { ...meta, toolRounds: 7 })
    CodexChatStore.selectAlternative(threadId, answerId, active)
    assert.deepEqual(metaOf(answerId).recall, meta.recall)
    assert.equal((await getChatDiagnostics(requester, threadId, answerId, message(answerId).alternatives.length - 1)).meta.toolRounds, 7)
    const branchId = branchChatThread(thread(), answerId)!
    const copied = CodexChatStore.listMessages(branchId)
    const branchMeta = JSON.parse(copied.at(-1)!.context_meta!) as ChatContextMeta
    assert.deepEqual(branchMeta.sections, meta.sections)
    assert.equal(branchMeta.windowFromMessageId, copied[0].id)
    assert.equal(branchMeta.recall![0].segmentId, ChatSummaryStore.list(branchId)[0].id)
    assert.equal(branchMeta.sources!.find((source) => source.kind === 'window')!.id, copied[0].id)
    assert.equal((await getChatDiagnostics(requester, branchId, copied.at(-1)!.id)).texts?.find((source) => source.kind === 'recall')?.changedSince, false)
  })

  await t.test('capture redacts extraParams by key without replacing common words in conversation', () => {
    const target = { apiKey: 'long-api-secret', endpoint: 'http://private.invalid/chat', generation: { extraParams: { language: 'en', feature: 'true' } } } as never
    const original = 'A sentence in en, true and weekend.'
    const body = JSON.parse(redactChatRequestBody({ language: 'en', feature: 'true', messages: [{ role: 'user', content: original }], nested: { secret: 'long-api-secret http://private.invalid/chat' } }, target))
    assert.equal(body.language, '[가림]')
    assert.equal(body.feature, '[가림]')
    assert.equal(body.messages[0].content, original)
    assert.equal(body.nested.secret, '[가림] [가림]')
  })

  await t.test('raw capture defaults off, retains N per thread/alternative, redacts secrets and cascades on deletion', async () => {
    const current = ChatProfileStore.find(profile.id)!
    await LlmChatService.sendMessage(requester, thread(), '원문 테스트', () => {})
    const reply = CodexChatStore.listMessages(threadId).at(-1)!
    assert.equal(reply.status, 'completed', reply.error ?? '')
    const captured = JSON.stringify(readChatRequestCapture(reply.id, reply.active_alternative))
    assert.ok(captured.includes('ADMIN_SYSTEM_PRIVATE'))
    assert.ok(!captured.includes('EXTRA_SECRET'))
    assert.ok(!captured.includes('fake-api-secret'))
    assert.ok(!captured.includes('unused.invalid'))
    assert.ok(captured.includes('가림'))
    const target = { apiKey: 'a-secret', endpoint: 'http://private/endpoint', generation: { extraParams: { custom: { token: 'sensitive' } } } } as never
    const redacted = redactChatRequestBody({ custom: { token: 'sensitive' }, endpoint: 'http://private/endpoint', headers: { Authorization: 'a-secret' }, nested: { text: 'a-secret http://private/endpoint' } }, target)
    for (const secret of ['sensitive', 'a-secret', 'http://private/endpoint']) assert.ok(!redacted.includes(secret))
    for (let i = 0; i < 4; i += 1) {
      CodexChatStore.addAlternative(threadId, reply.id, { content: String(i), tool_calls: [], status: 'completed', error: null, created_at: new Date().toISOString() })
      saveChatRequestCapture(reply.id, JSON.stringify({ round: i }))
    }
    const rows = db.prepare('SELECT alternative FROM chat_request_captures WHERE message_id = ? ORDER BY alternative').all(reply.id) as Array<{ alternative: number }>
    assert.deepEqual(rows.map((row) => row.alternative), [3, 4])
    CodexChatStore.selectAlternative(threadId, reply.id, 3)
    assert.deepEqual(readChatRequestCapture(reply.id, 3), { round: 2 })
    db.prepare('DELETE FROM codex_chat_messages WHERE id = ?').run(reply.id)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chat_request_captures WHERE message_id = ?').get(reply.id) as { n: number }).n, 0)
    assert.equal(current.extraParams, '{"private_custom":"EXTRA_SECRET"}')
  })

  await t.test('group replies and regenerated alternatives persist the same diagnostics and tool round count', async (s) => {
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => Response.json({
      choices: [{ message: ++calls === 1 ? { content: '', tool_calls: [{ id: 'routing', type: 'function', function: { name: 'chat_reply_to', arguments: '{"to":["user"]}' } }] } : { content: '도구 뒤 답변' }, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 123 },
    }))
    const other = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'm', summaryEnabled: false, mcpEnabled: false })
    const room = GroupChatService.create(requester, { profileIds: [profile.id, other.id], representativeId: profile.id, userProfileId: null })
    await GroupChatService.sendMessage(requester, room.id, '@카이 진단', () => {})
    let reply = CodexChatStore.listMessages(room.id).at(-1)!
    assert.equal(reply.status, 'completed', reply.error ?? '')
    assert.equal(JSON.parse(reply.context_meta!).version, 2)
    assert.equal(JSON.parse(reply.context_meta!).profileId, profile.id)
    assert.equal(JSON.parse(reply.context_meta!).toolRounds, 1)
    await GroupChatService.rewriteMessage(requester, room.id, reply.id, undefined, () => {})
    reply = CodexChatStore.listMessages(room.id).find((entry) => entry.id === reply.id)!
    assert.equal(reply.alternatives.length, 2)
    assert.ok(reply.alternatives.every((alternative) => JSON.parse(alternative.context_meta!).version === 2))
    assert.ok(reply.alternatives.every((alternative) => !JSON.stringify(alternative).includes('requestCapture')))
  })

  await t.test('a dispatched request with an empty failed answer retains its diagnostic and capture', async (s) => {
    s.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42 } }))
    await LlmChatService.sendMessage(requester, thread(), '빈 답변 진단', () => {})
    const reply = CodexChatStore.listMessages(threadId).at(-1)!
    assert.equal(reply.status, 'failed')
    assert.equal(JSON.parse(reply.context_meta!).version, 2)
    assert.equal(JSON.parse(reply.context_meta!).promptTokens, 42)
    assert.ok(readChatRequestCapture(reply.id, reply.active_alternative))
  })

  await t.test('global off stores only legacy fields and denies old diagnostics/export', async () => {
    const before = countCaptures()
    updateChatSettings({ diagnostics: { enabled: false, captureRaw: true } })
    await LlmChatService.sendMessage(requester, thread(), '진단 꺼짐', () => {})
    const reply = CodexChatStore.listMessages(threadId).at(-1)!
    assert.equal(reply.status, 'completed', reply.error ?? '')
    assert.equal(JSON.parse(reply.context_meta!).version, undefined)
    assert.equal(JSON.parse(reply.context_meta!).sections, undefined)
    assert.equal(countCaptures(), before)
    await assert.rejects(getChatDiagnostics(requester, threadId, answerId), /권한/)
    await assert.rejects(exportChatDiagnostics(requester, threadId, answerId), /권한/)
    updateChatSettings({ diagnostics: { enabled: true, captureRaw: false } })
    const legacy = await getChatDiagnostics(requester, threadId, reply.id)
    assert.equal(legacy.meta.version, undefined)
  })

  await t.test('lore decisions preserve selected output and cover skip/budget/secondary/regex/files with unmatched counts only', async () => {
    const entries = normalizeLorebook([
      { id: 'constant', title: '상시', constant: true, content: '상시', order: 0 },
      { id: 'key', title: '키', keys: ['반지'], content: '키 본문', order: 1 },
      { id: 'secondary', keys: ['반지'], secondaryKeys: ['바다'], secondaryLogic: 'andAll', content: '보조 실패' },
      { id: 'budget', keys: ['반지'], content: 'B'.repeat(100), order: -1 },
      { id: 'sent', keys: ['반지'], content: '이미 전송' },
      { id: 'regex', keys: ['/반.지/'], content: '정규식', order: 2 },
      { id: 'unmatched', keys: ['우주'], content: '아무 키도 없음' },
    ])
    const keyed = entries.map((entry) => ({ key: loreEntryKey(1, entry), bookId: 1, bookKind: 'global' as const, entry }))
    const selected = selectLoreEntries({ lorebookIds: [], loreScanDepth: 4, loreTokenBudget: 20 }, [{ content: '반지 반쪽지' }], (text) => text.length, (text) => text, { entries: keyed, skip: (key) => key.includes(':sent:') })
    assert.deepEqual(selected.labels, ['상시', '키', '/반.지/'])
    assert.equal(selected.text, '상시\n\n키 본문\n\n정규식')
    assert.equal(selected.unmatched, 1)
    assert.ok(!selected.decisions.some((entry) => entry.entryId === 'unmatched'))
    for (const reason of ['constant', 'key:반지', 'secondary-failed', 'budget', 'codex-sent', 'regex']) assert.ok(selected.decisions.some((entry) => entry.reason === reason), reason)
    const linked = normalizeLorebook([{ id: 'file', keys: ['반지'], content: '본문', file: '자료/test.md' }])[0]
    for (const inline of [true, false]) {
      const result = selectLoreEntries({ lorebookIds: [], loreScanDepth: 4, loreTokenBudget: 100 }, [{ content: '반지' }], (text) => text.length, (text) => text,
        { entries: [{ key: loreEntryKey(1, linked), entry: linked, file: () => ({ name: 'test.md', text: '자료 본문', truncated: false }) }], files: { inline, hint: () => '자료 힌트' } })
      assert.equal(result.text, inline ? '본문\n  자료 test.md: "자료 본문"' : '본문\n  자료 힌트')
      assert.equal(result.decisions.length, 1)
      assert.equal(result.decisions[0].reason, 'key:반지')
      assert.equal(result.decisions[0].file, inline ? 'inline' : 'hint')
      const id = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: '파일 선택 진단', tool_calls: [], status: 'completed', error: null })
      CodexChatStore.setContextMeta(id, { ...metaOf(answerId), sources: [], auxiliarySources: [], recall: [], loreEntries: [{ ...result.decisions[0], bookId: accountBook.id, entryId: 'account' }] })
      const diagnostic = await getChatDiagnostics(requester, threadId, id)
      assert.equal(diagnostic.meta.loreEntries?.length, 1)
      assert.equal(diagnostic.meta.loreEntries?.[0].file, inline ? 'inline' : 'hint')
      assert.equal(diagnostic.texts?.length, 1)
      assert.equal(diagnostic.texts?.[0].text, '내 계정 로어 본문')
      const current = ChatProfileStore.find(profile.id)!
      const codex = codexInputMeta(current, [], { keyed: result.keyed, keyedKeys: result.keyedKeys, selected: { ...result, index: '', books: [] }, index: { text: '', keys: [] } }, '파일 입력', result.keys, [])
      assert.equal(codex.lore.length, 1)
      assert.equal(codex.loreEntries?.[0].file, inline ? 'inline' : 'hint')
    }
  })

  await t.test('recall ids, weighted scores and shared terms reach metadata; metadata caps are enforced', () => {
    const segment = { id: 987, thread_id: threadId, level: 0, from_message_id: 1, until_message_id: 1, content: '바닷가 반지 약속을 꼭 기억해', created_date: '', updated_date: '', backed: 1 }
    const selected = selectRecall([segment], '바닷가 반지 약속', 800, (text) => text.length)
    assert.equal(selected[0].id, 987)
    assert.ok(selected[0].score > 0)
    assert.ok(selected[0].terms.includes('반지'))
    const userId = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: '바닷가 반지 약속', tool_calls: [], status: 'completed', error: null })
    const current = { ...thread(), summary: '줄거리', summary_until_message_id: userId }
    let meta: ChatContextMeta | undefined
    buildChatMessages({ profile: ChatProfileStore.find(profile.id)!, thread: current, messages: CodexChatStore.listMessages(threadId), config: { ...resolveContextConfig(current, profile), summaryEnabled: true }, tools: [], segments: [{ ...segment, until_message_id: userId }, { ...segment, id: 988, level: 1, content: '줄거리', until_message_id: userId }], onMeta: (value) => { meta = value } })
    assert.equal(meta?.recall?.[0].segmentId, 987)
    assert.ok(meta?.recall?.[0].score! > 0)
    const capped = limitContextMeta({ ...meta!, lore: Array.from({ length: 300 }, () => '가'.repeat(200)), sources: Array.from({ length: 600 }, () => contextSource('window', 'text', 1)[0]) })
    assert.equal(capped.truncated, true)
    assert.equal(capped.lore.length, CHAT_CONTEXT_META_LIMITS.lore)
    assert.equal(capped.lore[0].length, CHAT_CONTEXT_META_LIMITS.string)
    assert.equal(capped.sources?.length, CHAT_CONTEXT_META_LIMITS.sources)
  })

  await t.test('Codex records only CoNAI input references and opaque thread usage, including index-sent constants', async () => {
    grants = [...diagnosticKeys]
    const { selectRequestLore, booksForRequest, loreIndexText } = await import('../src/services/codex-chat/chatLoreContext')
    const current = ChatProfileStore.find(profile.id)!
    const messages = CodexChatStore.listMessages(threadId)
    const selected = selectRequestLore(current, booksForRequest({ thread: thread(), profile: current }), messages, (text) => text.length, (text) => text, { toolOffered: false, inlineFiles: false })
    const lore = { keyed: selected.keyed, keyedKeys: selected.keyedKeys, index: { text: loreIndexText(selected), keys: ['lore-index:abc'] }, selected }
    const meta = codexInputMeta(current, messages, lore, 'CODEX_INPUT_PRIVATE', ['lore-index:abc', 'note:def'], contextSource('author-note', current.authorNote))
    assert.equal(meta.engine, 'codex')
    assert.equal(meta.opaqueContext, true)
    assert.deepEqual(meta.codexKeys, ['lore-index:abc', 'note:def'])
    assert.ok(!JSON.stringify(meta).includes('CODEX_INPUT_PRIVATE'))
    assert.equal(meta.sections?.length, 1)
    const sent = codexInputMeta(current, messages, { ...lore, index: { text: '', keys: [] } }, '다음 입력', [], [])
    assert.ok(sent.loreSkipped?.some((entry) => entry.entryId === 'pinned' && entry.reason === 'codex-sent'))
    assert.equal(sent.memories, 0)
    const id = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: 'Codex 답변', tool_calls: [], status: 'completed', error: null })
    CodexChatStore.setContextMeta(id, { ...meta, tokenUsage: { contextTokens: 11, inputTokens: 20, cachedInputTokens: 4, outputTokens: 9 } })
    const result = await getChatDiagnostics(requester, threadId, id)
    assert.equal(result.meta.opaqueContext, true)
    assert.equal(result.meta.tokenUsage?.inputTokens, 20)
  })

  await t.test('permissions v2 folds old chat keys once and leaves prompts to administrators', async () => {
    const Database = (await import('better-sqlite3')).default
    const auth = new Database(':memory:')
    try {
      auth.pragma('foreign_keys = ON')
      const { createAuthTables } = await import('../src/database/authDbSchema')
      const { seedAccessControlDefaults } = await import('../src/database/authDbSeed')
      createAuthTables(auth)
      // An auth database from before v2: the old keys exist and the conversion has not run.
      for (const key of ['chat.llm.use', 'chat.codex.use', 'chat.diagnostics.content', 'chat.diagnostics.prompts', 'chat.tools.read']) {
        auth.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run(key, key, 'x')
      }
      for (const name of ['llm-test', 'codex-test', 'no-chat-test']) auth.prepare('INSERT INTO auth_permission_groups (group_key, name) VALUES (?, ?)').run(name, name)
      const grant = (group: string, key: string, allowed = 1) => auth.prepare(`INSERT OR REPLACE INTO auth_group_permissions (group_id, permission_id, allowed)
        SELECT g.id, p.id, ? FROM auth_permission_groups g JOIN auth_permissions p ON p.permission_key = ? WHERE g.group_key = ?`).run(allowed, key, group)
      grant('llm-test', 'chat.llm.use')
      grant('llm-test', 'chat.diagnostics.content')
      grant('llm-test', 'chat.diagnostics.prompts')
      grant('codex-test', 'chat.codex.use')
      grant('no-chat-test', 'chat.tools.read')
      seedAccessControlDefaults(auth)
      const keys = (group: string) => (auth.prepare(`SELECT p.permission_key FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id
        JOIN auth_permission_groups g ON g.id = gp.group_id WHERE g.group_key = ? AND gp.allowed = 1 ORDER BY p.permission_key`).all(group) as Array<{ permission_key: string }>).map((row) => row.permission_key)
      assert.deepEqual(keys('llm-test'), ['chat.diagnostics.view', 'chat.use', 'images.view'], 'raw prompts are no longer a grantable key')
      assert.deepEqual(keys('codex-test'), ['chat.agent.use', 'chat.diagnostics.view', 'images.view'], 'older conversions still run first on an old database')
      assert.deepEqual(keys('no-chat-test'), [], 'bot tool keys are gone; the account feature keys decide')
      assert.equal(auth.prepare("SELECT COUNT(*) AS n FROM auth_permissions WHERE permission_key LIKE 'chat.tools.%' OR permission_key = 'chat.llm.use'").get().n, 0)
      auth.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'llm-test') AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'chat.diagnostics.view')").run()
      seedAccessControlDefaults(auth)
      assert.ok(!keys('llm-test').includes('chat.diagnostics.view'), 'restart must not undo a later revocation')
    } finally { auth.close() }
  })
})
