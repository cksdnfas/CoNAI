import './support/testTemp'
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
  // Admin rights are re-read from the account (accounts 1 and 2 are the admins below, 3 and 4 guests).
  t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: id === 1 || id === 2 ? 'admin' : 'guest' }) as never)
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'] }))
  const requester = { accountId: 1, accountType: 'admin' as const }
  const stranger = { accountId: 2, accountType: 'admin' as const }
  const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'm', mcpEnabled: false, summaryEnabled: false })
  const newThread = () => CodexChatService.createThread(requester, profile.id).id
  const say = (threadId: number, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) =>
    CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null, ...extra })

  await t.test('tail and single-message reads keep older quotes but never resolve a quote into another chat', () => {
    const id = newThread()
    const earlier = say(id, 'user', 'earlier')
    const elsewhere = say(newThread(), 'user', 'private')
    const quote = (messageId: number) => ({ messageId, role: 'user', speakerProfileId: null, speakerName: 'user', excerpt: 'quoted', alternative: 0 })
    const own = say(id, 'assistant', 'own quote', { routing: { recipients: ['user'], replyTo: quote(earlier) } })
    const foreign = say(id, 'assistant', 'foreign quote', { routing: { recipients: ['user'], replyTo: quote(elsewhere) } })
    const tail = CodexChatStore.listMessages(id, { tail: 2 })
    assert.deepEqual(tail.map((message) => message.id), [own, foreign])
    assert.equal(tail[0].routing?.replyTo?.excerpt, 'quoted')
    assert.equal(tail[0].routing?.replyTo?.unavailable, undefined)
    assert.equal(tail[1].routing?.replyTo?.unavailable, true)
    assert.equal(tail[1].routing?.replyTo?.excerpt, '')
    assert.deepEqual(CodexChatStore.findMessage(id, own), tail[0])
    assert.equal(CodexChatStore.findMessage(id, elsewhere), undefined)
    assert.equal(CodexChatStore.latestMessage(id)?.id, foreign)
    assert.equal(CodexChatStore.messageCount(id), 3)
    assert.deepEqual(CodexChatStore.listMessages(id, { tail: 1, before: foreign }).map((message) => message.id), [own])
    assert.deepEqual(CodexChatStore.listMessages(id, { tail: 2, before: own }).map((message) => message.id), [earlier])
    assert.deepEqual(CodexChatStore.listMessages(id, { tail: 2, before: earlier }), [])
    assert.equal(CodexChatStore.hasMessagesBefore(id, earlier), false)
    assert.equal(CodexChatStore.hasMessagesBefore(id, own), true)
    assert.throws(() => CodexChatStore.listMessages(id, { tail: 2, before: 0 }), /cursor/)
    assert.deepEqual(CodexChatStore.listJudgeMessages(id, 2).map((message) => message.content), ['own quote', 'foreign quote'])
    assert.equal(CodexChatStore.trailingReplyCount(id), 2)
  })

  await t.test('HTTP cursor pages retain thread authorization and validate cursors', async () => {
    const express = (await import('express')).default
    const router = (await import('../src/routes/codex-chat.routes')).default
    const app = express()
    app.use((req, _res, next) => {
      req.session = { accountId: req.headers['x-test-account'] === '2' ? 2 : 1, accountType: 'admin' } as typeof req.session
      next()
    })
    app.use('/api/codex-chat', router)
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const address = server.address() as import('node:net').AddressInfo
      const id = newThread()
      const first = say(id, 'user', 'first private message')
      const middle = say(id, 'assistant', 'middle private message')
      const last = say(id, 'user', 'last private message')
      const url = `http://127.0.0.1:${address.port}/api/codex-chat/threads/${id}`
      const tail = await (await fetch(`${url}?tail=1`)).json() as any
      assert.deepEqual(tail.data.messages.map((message: any) => message.id), [last])
      assert.equal(tail.data.hasMoreBefore, true)
      const page = await (await fetch(`${url}?tail=2&before=${last}`)).json() as any
      assert.deepEqual(page.data.messages.map((message: any) => message.id), [first, middle])
      assert.equal(page.data.hasMoreBefore, false)
      assert.equal(page.data.messageCount, 3)
      assert.equal((await fetch(`${url}?tail=2&before=0`)).status, 400)
      assert.equal((await fetch(`${url}?before=${last}`)).status, 400)
      const denied = await fetch(`${url}?tail=2&before=${last}`, { headers: { 'x-test-account': '2' } })
      assert.equal(denied.status, 404)
      assert.doesNotMatch(await denied.text(), /private message/)
      CodexChatStore.updateListState(id, { title: 'Directory visible' })
      const hidden = CodexChatStore.createThread(2, 'Directory secret', 'llm', profile.id)
      const directory = `http://127.0.0.1:${address.port}/api/codex-chat/threads`
      const listed = await (await fetch(`${directory}?limit=1&query=Directory`)).json() as any
      assert.equal(listed.success, true)
      assert.deepEqual(listed.data.map((thread: any) => thread.id), [id])
      assert.deepEqual(listed.pagination, { total: 1, has_more: false, next_cursor: null })
      assert.equal(listed.data[0].preview.text, 'last private message')
      assert.equal(listed.data[0].running, false)
      assert.equal('summary' in listed.data[0], false, 'list rows do not load detail/context fields')
      const legacy = await (await fetch(directory)).json() as any
      assert.ok(Array.isArray(legacy.data))
      assert.equal('pagination' in legacy, false, 'the existing full-directory UI keeps its response envelope')
      assert.ok(!legacy.data.some((thread: any) => thread.title === 'Directory secret'))
      assert.equal((await fetch(`${directory}?limit=101`)).status, 400)
      assert.equal((await fetch(`${directory}?limit=1&cursor=invalid`)).status, 400)
      const targeted = await (await fetch(`${directory}?ids=${id},${hidden}`)).json() as any
      assert.deepEqual(targeted.data.map((thread: any) => thread.id), [id], 'off-page lookups keep the same account boundary')
      assert.equal(targeted.data[0].preview.text, 'last private message')
      assert.equal('summary' in targeted.data[0], false)
      assert.equal((await fetch(`${directory}?ids=0`)).status, 400)
      assert.equal((await fetch(`${directory}?ids=${id}&limit=1`)).status, 400)
      const unread = await (await fetch(`${directory}/unread-count`)).json() as any
      const expectedUnread = [...CodexChatStore.countUnread(CodexChatStore.listThreads(1, { archive: 'active' }).map((thread) => thread.id)).values()].reduce((sum, count) => sum + count, 0)
      assert.equal(unread.data, expectedUnread, 'the badge counts all active rooms rather than one directory page')
      const pinned = newThread()
      CodexChatStore.updateListState(pinned, { title: 'Directory pinned', pinned: true })
      const firstRoomPage = await (await fetch(`${directory}?limit=1&query=Directory&pinned_first=true`)).json() as any
      assert.deepEqual(firstRoomPage.data.map((thread: any) => thread.id), [pinned])
      assert.equal(firstRoomPage.pagination.has_more, true)
      const nextRoomPage = await (await fetch(`${directory}?limit=1&query=Directory&pinned_first=true&cursor=${encodeURIComponent(firstRoomPage.pagination.next_cursor)}`)).json() as any
      assert.deepEqual(nextRoomPage.data.map((thread: any) => thread.id), [id])
      assert.equal(nextRoomPage.pagination.has_more, false)
      CodexChatStore.updateListState(pinned, { archived: true })
      const archivedRooms = await (await fetch(`${directory}?limit=1&query=Directory&archive=archived`)).json() as any
      assert.deepEqual(archivedRooms.data.map((thread: any) => thread.id), [pinned])
      assert.equal(archivedRooms.has_archived_chats, true)
      assert.equal(archivedRooms.has_archived_automation, false)
      const otherAccountRooms = await (await fetch(`${directory}?limit=1`, { headers: { 'x-test-account': '2' } })).json() as any
      assert.equal(otherAccountRooms.has_archived_chats, false, 'another account’s archives do not expose an archive section')
      const automationIds: number[] = []
      const db = dbModule.getUserSettingsDb()
      try {
        for (let index = 0; index < 41; index++) {
          const roomId = CodexChatStore.createThread(1, `Directory automation ${index}`, 'llm', profile.id)
          automationIds.push(roomId)
          db.prepare('INSERT INTO chat_automation_rooms (account_key, room_key, thread_id) VALUES (?, ?, ?)').run('1', `workflow:directory:${index}`, roomId)
        }
        CodexChatStore.updateListState(automationIds[0], { archived: true })
        const bootstrap = await (await fetch(`${directory}?limit=40&archive=active&bootstrap=true`)).json() as any
        assert.equal(bootstrap.data.length, 40)
        assert.ok(bootstrap.data.every((room: any) => room.automation === 'workflow'))
        assert.equal(bootstrap.has_automation, true)
        assert.equal(bootstrap.has_archived_automation, true)
        assert.equal(bootstrap.default_thread.id, id, 'the newest regular room stays the default even beyond the first page')
        assert.equal('summary' in bootstrap.default_thread, false)
      } finally {
        for (const roomId of automationIds) {
          db.prepare('DELETE FROM chat_automation_rooms WHERE thread_id = ?').run(roomId)
          CodexChatStore.deleteThread(roomId)
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  await t.test('tail detail keeps state from earlier replies and manual edits, including group member state', async () => {
    const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
    const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
    const block = ChatSharedBlockStore.create({ name: 'tail state', block: { key: 'status', example: '{"hp":2}' } })
    const stateProfile = ChatProfileStore.create({ name: 'state', engine: 'llm', providerName: 'test', model: 'm', blockIds: [block.id], mcpEnabled: false })
    const id = CodexChatService.createThread(requester, stateProfile.id).id
    const beforeEdit = say(id, 'assistant', '```status\n{"hp":5}\n```')
    CodexChatStore.setBlockEdits(id, [{ id: 'edit', key: 'status', afterMessageId: beforeEdit, data: { hp: 8 }, at: new Date().toISOString() }])
    say(id, 'user', 'latest')
    const full = CodexChatService.getThread(requester, id)
    const tail = CodexChatService.getThread(requester, id, 1)
    assert.deepEqual(tail.messages, full.messages.slice(-1))
    assert.equal(tail.messageCount, full.messages.length)
    assert.equal(tail.messagesFrom, tail.messages[0].id)
    assert.deepEqual(tail.blocks, full.blocks)
    assert.equal(tail.blocks?.state.status.hp, 8)
    const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
    CodexChatStore.updateThreadContext(id, { summaryEnabled: true })
    ;(await import('../src/services/codex-chat/chatMemory')).ChatSummaryStore.replaceAll(id, 'old state folded', beforeEdit)
    const thread = CodexChatStore.findThreadById(id)!
    const source = { threadId: id }
    const bounded = CodexChatStore.listContextMessages(source, { afterId: beforeEdit, recentMessages: 1, textMessages: 1 })
    const params = { profile: stateProfile, thread, config: resolveContextConfig(thread, stateProfile), tools: [] }
    assert.deepEqual(buildChatMessages({ ...params, messages: bounded, historySource: source }),
      buildChatMessages({ ...params, messages: CodexChatStore.listMessages(id) }))
    assert.throws(() => CodexChatService.getThread(stranger, id, 1), /찾을 수 없어/)

    const room = GroupChatService.create(requester, { profileIds: [stateProfile.id, profile.id], representativeId: stateProfile.id, userProfileId: null })
    say(room.id, 'assistant', '```status\n{"hp":7}\n```', { speaker_profile_id: stateProfile.id })
    say(room.id, 'user', 'latest')
    const fullRoom = GroupChatService.getThread(requester, room.id)
    const roomTail = GroupChatService.getThread(requester, room.id, 1)
    assert.deepEqual(roomTail.memberBlocks, fullRoom.memberBlocks)
    assert.equal(roomTail.memberBlocks?.[stateProfile.id]?.state.status.hp, 7)
  })

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
    assert.deepEqual(CodexChatService.previewGreeting(requester, quiet.id), { index: null, text: '', greetings: [], userProfileId: null, before: [], after: [] })
    assert.equal(CodexChatStore.listMessages(CodexChatService.createThread(requester, quiet.id, null, null).id).length, 0)
  })

  await t.test('new chats keep only the selected flags visible to their owner', async () => {
    const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
    const guest = { accountId: 3, accountType: 'guest' as const }
    const shared = ChatFlagStore.create(requester, { name: '공유', icon: '', content: '공유 지침' })
    const hidden = ChatFlagStore.create(requester, { name: '숨김', icon: '', content: '숨긴 지침' })
    const own = ChatFlagStore.create(guest, { name: '내 플래그', icon: '', content: '내 지침' })
    const foreign = ChatFlagStore.create({ accountId: 4, accountType: 'guest' }, { name: '다른 계정', icon: '', content: '다른 계정 지침' })
    ChatFlagStore.delete(guest, hidden.id)
    const saved = CodexChatService.createThread(guest, profile.id, null, null, [shared.id, own.id, own.id, hidden.id, foreign.id, -1])
    assert.deepEqual(JSON.parse(saved.flag_ids!), [shared.id, own.id])
    assert.equal(CodexChatStore.findThread(saved.id, guest.accountId)?.flag_ids, saved.flag_ids)
    assert.equal(CodexChatService.createThread(guest, profile.id, null, null).flag_ids, null)
    assert.equal(CodexChatService.createThread(guest, profile.id, null, null, []).flag_ids, null)
  })

  await t.test('initial flag save failure rolls back the new chat and greeting', async (s) => {
    const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
    const flag = ChatFlagStore.list(requester)[0]
    const greeter = ChatProfileStore.create({ name: 'rollback', engine: 'llm', providerName: 'test', model: 'm', greeting: 'hello' })
    const db = dbModule.getUserSettingsDb()
    const counts = () => [db.prepare('SELECT COUNT(*) AS count FROM codex_chat_threads').get(), db.prepare('SELECT COUNT(*) AS count FROM codex_chat_messages').get()]
    const before = counts()
    s.mock.method(ChatFlagStore, 'setThreadFlags', () => { throw new Error('flag save failed') })
    assert.throws(() => CodexChatService.createThread(requester, greeter.id, null, 0, [flag.id]), /flag save failed/)
    assert.deepEqual(counts(), before)
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
    assert.deepEqual(file.links, { flags: [{ id: flag.id, name: '반말' }, { id: quiet.id, name: '짧게' }], userProfile: { id: me.id, name: '민준' }, lorebooks: [{ id: book.id, name: '세계관' }], linkedFiles: [], loreRecordBook: null })

    const back = importChatThread(requester, Buffer.from(JSON.stringify(file)), target(requester))
    const restored = CodexChatStore.findThreadById(back.threadId)!
    assert.deepEqual(JSON.parse(restored.flag_ids ?? '[]'), [flag.id, quiet.id])
    assert.equal(restored.user_profile_id, me.id)
    assert.deepEqual(OwnedLorebookStore.threadLinks(back.threadId), [book.id])
    assert.ok(back.notes.includes('라이브러리에 없거나 볼 수 없는 이미지·영상 2개는 뺐어.'), back.notes.join(' / '))

    // Another account: same names match, missing ones are reported; the plain id never reaches someone else's.
    // Account lorebooks are shared, so the same book links again.
    const theirs = ChatFlagStore.create(privateTo(2), { icon: '', name: '반말', content: '반말.' })
    const theirMe = ChatUserProfileStore.create(2, { name: '민준', persona: '' })
    const there = importChatThread(stranger, Buffer.from(JSON.stringify(file)), target(stranger))
    const copy = CodexChatStore.findThreadById(there.threadId)!
    assert.deepEqual(JSON.parse(copy.flag_ids ?? '[]'), [theirs.id])
    assert.equal(copy.user_profile_id, theirMe.id)
    assert.deepEqual(OwnedLorebookStore.threadLinks(there.threadId), [book.id])
    assert.ok(there.notes.includes('이 계정에 없는 플래그 1개는 켜지 않았어.'), there.notes.join(' / '))
    assert.ok(!there.notes.some((note) => note.includes('로어북')), there.notes.join(' / '))

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

  await t.test('full profile lists batch dependencies without changing role, preset or per-profile block resolution', async () => {
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const { ChatJudgePresetStore } = await import('../src/services/codex-chat/chatJudgePresets')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
    const db = dbModule.getUserSettingsDb()
    const slot = ModelSlotStore.routeId('chat')
    const judge = ChatJudgePresetStore.create({ name: 'List judge' })
    const generation = ChatGenerationPresetStore.create({ name: 'List generation', kind: 'nai' })
    const a = ChatSharedBlockStore.create({ name: 'First state', block: { key: 'liststate', template: 'first' } })
    const b = ChatSharedBlockStore.create({ name: 'Second state', block: { key: 'liststate', template: 'second' } })
    const ids: number[] = []
    for (let index = 0; index < 12; index++) {
      const linked = ChatProfileStore.create({ name: `List linked ${index}`, engine: 'codex' })
      ids.push(linked.id)
      const blocks = index % 2 ? [b.id, a.id] : [a.id, b.id]
      db.prepare(`UPDATE llm_chat_profiles SET model_slot_id = ?, summary_slot_id = ?, translation_slot_id = ?,
        suggest_slot_id = ?, judge_slot_id = ?, judge_preset_id = ?, generation_preset_ids = ?, block_ids = ? WHERE id = ?`)
        .run(slot, slot, slot, slot, slot, judge.id, JSON.stringify([generation.id, 999999]), JSON.stringify(blocks), linked.id)
    }
    // A missing role/preset stays unset in both full single-profile reads and the batched list.
    db.prepare('UPDATE llm_chat_profiles SET model_slot_id = 999999, judge_preset_id = 999999 WHERE id = ?').run(ids[0])
    const expected = ChatProfileStore.listNames().map(({ id }) => ChatProfileStore.find(id))
    let queries = 0
    const prepare = db.prepare.bind(db)
    const counter = t.mock.method(db, 'prepare', (sql: string) => {
      if (/^\s*SELECT\b/i.test(sql)) queries++
      return prepare(sql)
    })
    try {
      const listed = ChatProfileStore.list()
      assert.deepEqual(listed, expected)
      assert.equal(queries, 5, 'one profile query plus batched slots, judges, generation presets and requested block definitions')
      queries = 0
      assert.equal(ChatProfileStore.listNames({ ids }).length, 12)
      assert.equal(queries, 1, 'name-only lists never hydrate dependencies')
      const first = listed.find((row) => row.id === ids[0])!
      const second = listed.find((row) => row.id === ids[1])!
      assert.equal(first.modelSlotId, null)
      assert.equal(first.judgePresetId, null)
      assert.deepEqual(first.generationPresetIds, [generation.id])
      assert.equal(first.style.blocks[0].template, 'first')
      assert.equal(second.style.blocks[0].template, 'second', 'duplicate keys are resolved per profile, in link order')
    } finally { counter.mock.restore() }
  })
})
