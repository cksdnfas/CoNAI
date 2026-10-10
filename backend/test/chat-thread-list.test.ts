import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('chat list: previews, pin/archive/rename, branch origin', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-thread-list-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-thread-list-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore, previewText } = await import('../src/services/codex-chat/codexChatStore')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')

  updateChatSettings({ enabled: true })
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'] }))
  const requester = { accountId: 1, accountType: 'admin' as const }
  const stranger = { accountId: 2, accountType: 'admin' as const }
  const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'm', mcpEnabled: false, summaryEnabled: false })
  const newThread = () => CodexChatService.createThread(requester, profile.id).id
  const say = (threadId: number, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) =>
    CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null, ...extra })

  await t.test('preview text: one plain line without blocks, reasoning, tags or markdown', () => {
    assert.equal(previewText('*웃으며* 안녕!\n\n```status\n{"hp": 3}\n```\n오늘은 **비**가 와.'), '웃으며 안녕! 오늘은 비가 와.')
    assert.equal(previewText('<think>속으로</think>[링크](http://x) ![그림](a.png) <b>굵게</b>'), '링크 굵게')
    assert.equal(previewText('가'.repeat(300)).length, 120)
  })

  await t.test('previews: the latest message of each chat, shown text first, files and images flagged', () => {
    const a = newThread()
    const b = newThread()
    say(a, 'user', '먼저')
    say(a, 'assistant', 'raw', { display_content: '보이는 답' })
    say(b, 'user', '', { mediaAttachments: [{ compositeHash: 'h', name: 'x.png', mimeType: 'image/png' }] })
    const previews = CodexChatStore.listPreviews([a, b])
    assert.deepEqual(previews.get(a), { text: '보이는 답', role: 'assistant', media: false, files: false })
    assert.deepEqual(previews.get(b), { text: '', role: 'user', media: true, files: false })
    assert.equal(CodexChatStore.listPreviews([]).size, 0)
  })

  await t.test('list state: pin, archive and rename keep the activity order and stay with the owner', () => {
    const id = newThread()
    const before = CodexChatStore.findThreadById(id)!
    const updated = CodexChatService.updateListState(requester, id, { title: '옥상 장면', pinned: true, archived: true })
    assert.deepEqual([updated.title, updated.pinned, updated.archived], ['옥상 장면', 1, 1])
    assert.equal(updated.updated_date, before.updated_date, 'the list sorts by activity: renaming is none')
    assert.equal(CodexChatService.updateListState(requester, id, { archived: false }).archived, 0)
    assert.throws(() => CodexChatService.updateListState(stranger, id, { pinned: false }), /찾을 수 없어/)
    assert.equal(CodexChatStore.findThreadById(id)!.pinned, 1)
  })

  await t.test('greeting preview: the chat saved later opens with the previewed greeting', () => {
    const greeter = ChatProfileStore.create({ name: '하늘', engine: 'llm', providerName: 'test', model: 'm', mcpEnabled: false, summaryEnabled: false,
      greeting: '안녕, {{user}}.', alternateGreetings: ['또 왔네.', '여행 준비됐어?'] })
    const preview = CodexChatService.previewGreeting(requester, greeter.id)
    assert.ok(preview.index !== null && preview.index >= 0 && preview.index < 3)
    assert.equal(preview.userProfileId, null)
    assert.ok(!preview.text.includes('{{user}}'), 'placeholders filled as the saved greeting would be')
    const saved = CodexChatService.createThread(requester, greeter.id, preview.userProfileId, preview.index)
    assert.equal(CodexChatStore.listMessages(saved.id)[0].content, preview.text)
    assert.deepEqual(CodexChatStore.listMessages(saved.id)[0].alternatives.map((alternative) => alternative.content), preview.greetings)
    assert.equal(CodexChatStore.listMessages(saved.id)[0].active_alternative, preview.index)
    const second = CodexChatService.createThread(requester, greeter.id, null, 1)
    assert.equal(CodexChatStore.listMessages(second.id)[0].content, '또 왔네.')
    assert.equal(CodexChatStore.listMessages(second.id)[0].active_alternative, 1)
    CodexChatStore.selectAlternative(second.id, CodexChatStore.listMessages(second.id)[0].id, 2)
    assert.equal(CodexChatStore.listMessages(second.id)[0].content, '여행 준비됐어?')
    const outOfRange = CodexChatService.createThread(requester, greeter.id, null, 9)
    assert.equal(CodexChatStore.listMessages(outOfRange.id).length, 1, 'a stale index still opens with a greeting')
    const quiet = ChatProfileStore.create({ name: '말없음', engine: 'llm', providerName: 'test', model: 'm', mcpEnabled: false, summaryEnabled: false })
    assert.deepEqual(CodexChatService.previewGreeting(requester, quiet.id), { index: null, text: '', greetings: [], userProfileId: null })
    assert.equal(CodexChatStore.listMessages(CodexChatService.createThread(requester, quiet.id, null, null).id).length, 0)
  })

  await t.test('backup: a chat file in 채팅 백업/<date>, with its lorebook, that import brings back', async () => {
    const { backupChatToFiles, backupDateOf, backupFileName, exportChatJson, CHAT_BACKUP_FOLDER } = await import('../src/services/codex-chat/chatBackup')
    const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const { importChatThread } = await import('../src/services/codex-chat/chatImport')
    const id = newThread()
    CodexChatService.updateListState(requester, id, { title: '옥상: "약속"' })
    say(id, 'user', '반지 얘기 기억해?')
    say(id, 'assistant', '응, 내일 저녁이지.')
    OwnedLorebookStore.addChatBookEntries(id, [{ id: 'ring', keys: ['반지'], content: '내일 저녁 반지를 준다.', constant: true }])
    assert.equal(backupDateOf('2026-10-06'), '2026-10-06')
    assert.match(backupDateOf('../x'), /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(backupFileName('옥상: "약속"', id), `옥상_ _약속_ (#${id}).json`)
    assert.equal(backupFileName(' ... ', 7), '새 채팅 (#7).json')

    const json = exportChatJson(requester, id)
    assert.deepEqual(json.lorebook?.entries.map((entry) => [entry.id, entry.content, entry.file]), [['ring', '내일 저녁 반지를 준다.', null]])
    const saved = backupChatToFiles(requester, id, '2026-10-06')
    backupChatToFiles(requester, id, '2026-10-06')
    const owner = fileOwnerKey(requester.accountId)
    const root = FileStoreService.findChild(owner, null, CHAT_BACKUP_FOLDER)!
    const day = FileStoreService.findChild(owner, root.id, '2026-10-06')!
    assert.equal(FileStoreService.list(owner, day.id).total, 1, 'saving the same chat again on the same day replaces its file')
    assert.equal(saved.name, backupFileName('옥상: "약속"', id))
    assert.throws(() => backupChatToFiles(stranger, id, '2026-10-06'), /찾을 수 없어/)

    CodexChatStore.deleteThread(id)
    const raw = fs.readFileSync(FileStoreService.resolveFile(owner, saved.id).filePath)
    const target = { direct: (profileId: number) => CodexChatService.createThread(requester, profileId), group: (): { id: number } => { throw new Error('no rooms here') } }
    const restored = importChatThread(requester, raw, target)
    assert.deepEqual(CodexChatStore.listMessages(restored.threadId).map((message) => message.content), ['반지 얘기 기억해?', '응, 내일 저녁이지.'])
    assert.deepEqual(OwnedLorebookStore.chatBookOf(restored.threadId)?.entries.map((entry) => entry.content), ['내일 저녁 반지를 준다.'])
  })

  await t.test('import: flags, user profile and linked lorebooks tied again by id or name; missing images counted', async () => {
    const { exportChatJson } = await import('../src/services/codex-chat/chatBackup')
    const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
    const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
    const { ChatUserProfileStore } = await import('../src/services/codex-chat/chatUserProfiles')
    const { fileOwnerKey } = await import('../src/services/fileStoreService')
    const { importChatThread } = await import('../src/services/codex-chat/chatImport')
    // Flags of a non-admin account (an admin's are shared with everyone, see chat-flags.test.ts).
    const privateTo = (accountId: number) => ({ accountId, accountType: 'guest' as const })
    const target = (who: typeof requester) => ({ direct: (profileId: number) => CodexChatService.createThread(who, profileId), group: (): { id: number } => { throw new Error('no rooms here') } })
    const flag = ChatFlagStore.create(privateTo(1), { icon: '', name: '반말', content: '반말로 말해.' })
    const quiet = ChatFlagStore.create(privateTo(1), { icon: '', name: '짧게', content: '짧게 말해.' })
    const me = ChatUserProfileStore.create(1, { name: '민준', persona: '여행 좋아함' })
    const book = OwnedLorebookStore.create(fileOwnerKey(1), { name: '세계관' })

    const id = newThread()
    ChatFlagStore.setThreadFlags(id, [flag.id, quiet.id])
    ChatUserProfileStore.setThreadUserProfile(id, me.id)
    OwnedLorebookStore.setThreadLinks(id, [book.id])
    say(id, 'user', '사진 봐')
    say(id, 'assistant', '찾았어')
    const file = exportChatJson(requester, id)
    // Library images this test has no library for: as a file from elsewhere would carry them.
    const [asked, found] = file.messages as unknown as Array<Record<string, unknown>>
    asked.mediaAttachments = [{ compositeHash: 'a'.repeat(48), name: 'x.png', mimeType: 'image/png' }]
    found.tool_calls = [{ id: 'c1', tool: 'search', status: 'completed', arguments: {}, summary: '2개', historyIds: [], compositeHashes: ['b'.repeat(48), 'a'.repeat(48)] }]
    assert.deepEqual(file.links, { flags: [{ id: flag.id, name: '반말' }, { id: quiet.id, name: '짧게' }], userProfile: { id: me.id, name: '민준' }, lorebooks: [{ id: book.id, name: '세계관' }] })

    const back = importChatThread(requester, Buffer.from(JSON.stringify(file)), target(requester))
    const restored = CodexChatStore.findThreadById(back.threadId)!
    assert.deepEqual(JSON.parse(restored.flag_ids ?? '[]'), [flag.id, quiet.id])
    assert.equal(restored.user_profile_id, me.id)
    assert.deepEqual(OwnedLorebookStore.threadLinks(back.threadId), [book.id])
    assert.ok(back.notes.includes('라이브러리에 없거나 볼 수 없는 이미지·영상 2개는 뺐어.'), back.notes.join(' / '))

    // Another account: same names match, missing ones are reported; the plain id never reaches someone else's.
    const theirs = ChatFlagStore.create(privateTo(2), { icon: '', name: '반말', content: '반말.' })
    const theirMe = ChatUserProfileStore.create(2, { name: '민준', persona: '' })
    const there = importChatThread(stranger, Buffer.from(JSON.stringify(file)), target(stranger))
    const copy = CodexChatStore.findThreadById(there.threadId)!
    assert.deepEqual(JSON.parse(copy.flag_ids ?? '[]'), [theirs.id])
    assert.equal(copy.user_profile_id, theirMe.id)
    assert.deepEqual(OwnedLorebookStore.threadLinks(there.threadId), [])
    assert.ok(there.notes.includes('이 계정에 없는 플래그 1개는 켜지 않았어.'), there.notes.join(' / '))
    assert.ok(there.notes.includes('이 계정에 없는 로어북 1개는 연결하지 않았어.'), there.notes.join(' / '))

    const { links: _links, ...older } = file
    const oldThere = importChatThread(stranger, Buffer.from(JSON.stringify(older)), target(stranger))
    assert.equal(CodexChatStore.findThreadById(oldThere.threadId)!.flag_ids, null, 'an old file’s ids are not matched in another account')
  })

  await t.test('reply translation: told who speaks, the profile notes filled after the rules', async () => {
    const { replyTranslationPrompt } = await import('../src/services/codex-chat/chatTranslation')
    const plain = replyTranslationPrompt({ name: '루나' })
    assert.ok(plain.includes('The speaking character is "루나".'))
    assert.ok(!plain.includes('Notes on this character'))
    const noted = replyTranslationPrompt({ name: '루나', translationInstructions: '{{char}}는 반말, {{user}}를 "선배"라고 부른다.' }, '민준')
    const [rules, notes] = noted.split('Notes on this character')
    assert.ok(rules.includes('Keep these exactly as they are'), 'the markup rules come first')
    assert.ok(notes.includes('루나는 반말, 민준를 "선배"라고 부른다.'))
    assert.ok(replyTranslationPrompt({ name: '루나', translationInstructions: '{{user}}에게 존댓말' }).includes('the user에게 존댓말'))
    const saved = ChatProfileStore.create({ name: '번역', engine: 'llm', providerName: 'test', model: 'm', mcpEnabled: false, summaryEnabled: false, translationInstructions: '  말끝을 "…"로  ' })
    assert.equal(saved.translationInstructions, '말끝을 "…"로')
    assert.equal(ChatProfileStore.update(saved.id, { tagline: '바뀜' })!.translationInstructions, '말끝을 "…"로', 'a partial update keeps the notes')
    assert.deepEqual([saved.translationModelLanguage, saved.translationDisplayLanguage], ['en', 'ko'], 'unset languages read as English / Korean')
    const japanese = ChatProfileStore.update(saved.id, { translationModelLanguage: 'ko', translationDisplayLanguage: 'ja' })!
    assert.deepEqual([japanese.translationModelLanguage, japanese.translationDisplayLanguage], ['ko', 'ja'])
    assert.equal(ChatProfileStore.update(saved.id, { tagline: '또 바뀜' })!.translationDisplayLanguage, 'ja', 'a partial update keeps the languages')
    assert.equal(ChatProfileStore.update(saved.id, { translationDisplayLanguage: 'xx' as never })!.translationDisplayLanguage, 'ko', 'an unknown language falls back')
  })

  await t.test('branch origin: purpose and source kept, unlinked (not deleted) when the source goes', () => {
    const id = newThread()
    const first = say(id, 'user', '하나')
    say(id, 'assistant', '둘')
    const kept = CodexChatService.branchThread(requester, id, first, 'preserve')
    const goOn = CodexChatService.branchThread(requester, id, first)
    assert.deepEqual([kept.branched_from_thread_id, kept.branched_at_message_id, kept.branch_purpose], [id, first, 'preserve'])
    assert.equal(goOn.branch_purpose, 'continue')
    assert.equal(CodexChatStore.findThreadById(id)!.branched_from_thread_id, null)
    CodexChatStore.deleteThread(id)
    const orphan = CodexChatStore.findThreadById(kept.id)!
    assert.deepEqual([orphan.branched_from_thread_id, orphan.branch_purpose], [null, 'preserve'])
    assert.equal(CodexChatStore.listMessages(kept.id).length, 1)
  })

  await t.test('unread: replies after the read mark count, writing or reading moves it forward, branches start read', async () => {
    const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
    const events: Array<{ name: string; accountId?: number | null; payload: unknown }> = []
    const unsubscribe = subscribeToRuntimeEvents((event) => { if (event.name === 'chat.message.created') events.push(event) })
    const id = newThread()
    const unread = () => CodexChatStore.countUnread([id]).get(id) ?? 0
    const first = say(id, 'assistant', '안녕')
    const second = say(id, 'assistant', '뭐 해?')
    assert.equal(unread(), 2)
    assert.deepEqual(events.map((event) => [event.accountId, event.payload]), [[1, { threadId: id, messageId: first, requestedByAccountId: 1 }], [1, { threadId: id, messageId: second, requestedByAccountId: 1 }]])
    unsubscribe()

    CodexChatStore.markRead(id, first)
    assert.equal(unread(), 1)
    CodexChatStore.markRead(id, first - 1)
    assert.equal(CodexChatStore.findThreadById(id)!.last_read_message_id, first, 'never moves backwards')
    CodexChatStore.markRead(id, Number.MAX_SAFE_INTEGER)
    assert.equal(CodexChatStore.findThreadById(id)!.last_read_message_id, second, 'capped at the latest message')
    assert.equal(unread(), 0)

    say(id, 'assistant', '대답해 줘')
    const mine = say(id, 'user', '응')
    assert.equal(unread(), 0, 'writing a message reads everything before it')
    assert.equal(CodexChatStore.findThreadById(id)!.last_read_message_id, mine)

    say(id, 'assistant', '좋아')
    const branch = CodexChatService.branchThread(requester, id, mine)
    assert.equal(CodexChatStore.countUnread([branch.id]).get(branch.id) ?? 0, 0)
    assert.equal(unread(), 1, 'the source keeps its own mark')
  })
})
