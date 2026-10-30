import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

/**
 * Knowledge that outlives one chat: linked-file search stays inside the links, text files keep their earlier versions,
 * chats sharing a book or folder can search each other, and group rooms keep lore spacing, summaries and wakes sane.
 */
test('chat knowledge: linked search, file versions, connected history, group memory', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-knowledge-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-chat-knowledge-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { FileStoreRevisions, REVISIONS_PER_FILE } = await import('../src/services/fileStoreRevisions')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const linked = await import('../src/services/codex-chat/chatLinkedFiles')
  const { connectedThreadIds, searchChatMessages, sharesKnowledge } = await import('../src/services/codex-chat/chatHistorySearch')
  const { proposeLore } = await import('../src/services/codex-chat/chatLoreProposals')
  const { buildGroupCodexInput, withoutStaleWakes } = await import('../src/services/codex-chat/groupChatContext')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')

  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const rina = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn' })
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
  const me = fileOwnerKey(null)
  const requester = { accountId: null, accountType: 'admin' as const }
  const controller = new AbortController()
  const textOf = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)

  await t.test('linked_search looks inside the linked places, however many hits the rest of the store has', async () => {
    // The linked file is the oldest hit and sorts last by name: a store-wide top 200 would never reach it.
    const project = FileStoreService.createFolder(me, null, '가을 이벤트')
    const minutes = FileStoreService.writeText(me, project.id, '회의 정리.md', '# 회의\n등대 앞 광장에서 연다.\n', { create: true })
    dbModule.getUserSettingsDb().prepare("UPDATE stored_file_entries SET updated_at = datetime('now', '-1 day') WHERE id = ?").run(minutes.id)
    const noise = FileStoreService.createFolder(me, null, '잡동사니')
    for (let index = 0; index < 210; index++) FileStoreService.writeText(me, noise.id, `메모-${index}.md`, '등대 이야기\n', { create: true })
    const threadId = CodexChatStore.createThread(null, '기획', 'llm', rina.id)
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: project.id, write: true }])
    const places = linked.placesForRequest({ thread: CodexChatStore.findThreadById(threadId)!, profile: ChatProfileStore.find(rina.id) })
    const found = await linked.searchLinked(places, '등대')
    assert.match(found, /\[가을 이벤트\]\/회의 정리\.md/, 'the newer noise files do not push it out')
    assert.doesNotMatch(found, /메모-/)
  })

  await t.test('a replaced text file keeps its earlier text with who wrote and who replaced it; restore puts it back', () => {
    const folder = FileStoreService.createFolder(me, null, '버전')
    const file = FileStoreService.writeText(me, folder.id, '계획.md', '첫 판\n', { create: true, source: { via: 'editor', accountId: null } })
    FileStoreService.updateText(me, file.id, '둘째 판\n', { source: { via: 'chat', threadId: 7, profileId: rina.id, replyId: 'r-a' } })
    FileStoreService.editText(me, file.id, (text) => `${text}셋째 줄\n`, { source: { via: 'chat', threadId: 7, profileId: rina.id, replyId: 'r-a' } })
    const versions = FileStoreRevisions.list(me, file.id)
    assert.equal(versions.length, 2)
    assert.equal(FileStoreRevisions.readText(me, file.id, versions[1].id), '첫 판\n')
    assert.equal(versions[1].writtenBy?.via, 'editor')
    assert.equal(versions[1].replacedBy?.replyId, 'r-a')
    assert.deepEqual(FileStoreRevisions.writer(file.id), { via: 'chat', threadId: 7, profileId: rina.id, replyId: 'r-a' })
    // What the file was before the reply touched it: its first change's version.
    const before = FileStoreRevisions.beforeReply(me, file.id, 7, 'r-a')
    assert.equal(before?.id, versions[1].id)
    FileStoreService.restoreRevision(me, file.id, before!.id, { via: 'restore', accountId: null })
    assert.equal(fs.readFileSync(path.join(root, 'files', `${file.id}.bin`), 'utf8'), '첫 판\n')
    assert.equal(FileStoreRevisions.list(me, file.id).length, 3, 'the restore kept the text it replaced')

    for (let index = 0; index < REVISIONS_PER_FILE + 5; index++) FileStoreService.updateText(me, file.id, `판 ${index}\n`)
    assert.equal(FileStoreRevisions.list(me, file.id).length, REVISIONS_PER_FILE, 'only the newest are kept')
    // The shared store keeps every file and version flat (no per-account folders).
    const revisionCopies = () => fs.readdirSync(path.join(root, 'files', '.revisions')).filter((name) => name.endsWith('.bin'))
    const kept = revisionCopies()
    assert.equal(kept.length, REVISIONS_PER_FILE + 0, 'trimmed versions take their copies with them')

    FileStoreService.delete(me, [file.id])
    assert.equal(FileStoreRevisions.list(me, file.id).length, 0, 'a deleted file takes its versions')
    assert.equal(revisionCopies().length, 0)
  })

  await t.test('a reply that wrote files shows them and undoes them: a replaced file goes back, a made one goes away', async () => {
    const { attachFileChanges, undoFileChange } = await import('../src/services/codex-chat/chatFileChanges')
    const folder = FileStoreService.createFolder(me, null, '기획')
    const plan = FileStoreService.writeText(me, folder.id, '기획서.md', '# 1안\n', { create: true, source: { via: 'editor', accountId: null } })
    const threadId = CodexChatStore.createThread(null, '기획 회의', 'llm', rina.id)
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: folder.id, write: true }])
    const write = async (replyId: string, tool: string, args: Record<string, unknown>) => {
      const context: ChatExecutionContext = { threadId, profileId: rina.id, kind: 'direct', replyId }
      const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const bridge = await openChatMcpBridge(requester, [], null, { chatContext: context })
      try { const result = await bridge.call(tool, args); assert.equal(result.isError, undefined, textOf(result)) } finally { close(); await bridge.close() }
    }
    await write('w1', 'linked_edit', { target: '[기획]/기획서.md', append: '## 일정\n열흘\n' })
    await write('w1', 'linked_write', { target: '[기획]/회의록/10-11.md', text: '장소: 등대 광장\n' })
    CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: '고쳤어.', tool_calls: [], status: 'completed', error: null, routing: { replyId: 'w1', replyTo: null, recipients: ['user'] } })
    const reply = attachFileChanges(CodexChatStore.listMessages(threadId)).at(-1)!
    assert.deepEqual(reply.fileChanges?.map((change) => [change.name, change.folder, change.created, change.undone]), [['기획서.md', '/기획', false, false], ['10-11.md', '/기획/회의록', true, false]])

    const minutes = reply.fileChanges![1].fileId
    await write('w2', 'linked_edit', { target: '[기획]/회의록/10-11.md', append: '예산: 120만 원\n' })
    assert.throws(() => undoFileChange({ threadId, accountId: null, replyId: 'w1', fileId: minutes }), /다시 고쳐져서/, 'a made file someone changed since is not removed')

    const undone = undoFileChange({ threadId, accountId: null, replyId: 'w1', fileId: plan.id })
    assert.equal(undone.undone, true)
    assert.equal((await FileStoreService.readText(me, plan.id)).text, '# 1안\n')
    assert.throws(() => undoFileChange({ threadId, accountId: null, replyId: 'w1', fileId: plan.id }), /이미 되돌렸어/)

    undoFileChange({ threadId, accountId: null, replyId: 'w2', fileId: minutes })
    assert.equal((await FileStoreService.readText(me, minutes)).text, '장소: 등대 광장\n', "w2's change undone: back to what w1 wrote")

    await write('w3', 'linked_write', { target: '[기획]/초안.md', text: '초안\n' })
    const draft = FileStoreService.findChild(me, folder.id, '초안.md')!
    undoFileChange({ threadId, accountId: null, replyId: 'w3', fileId: draft.id })
    assert.equal(FileStoreService.findChild(me, folder.id, '초안.md'), null, 'a file the reply made, untouched since, is removed')
  })

  await t.test("a lorebook's own JSON is rewritten without versions", () => {
    const book = OwnedLorebookStore.create(me, { name: '세계' })
    OwnedLorebookStore.update(book.id, me, { name: '세계관' })
    const json = FileStoreService.findChild(me, book.folderId, 'lorebook.json')
    assert.ok(json)
    assert.equal(FileStoreRevisions.list(me, json!.id).length, 0)
  })

  await t.test('chats sharing an account book or a linked folder find each other; a global book connects nobody', async () => {
    const shared = FileStoreService.createFolder(me, null, '공유 폴더')
    const book = OwnedLorebookStore.create(me, { name: '프로젝트 기록' })
    const plan = CodexChatStore.createThread(null, '기획', 'llm', rina.id)
    const meeting = ChatGroupStore.create(null, '회의', [rina.id, kai.id], rina.id)
    const diary = CodexChatStore.createThread(null, '일기', 'llm', kai.id)
    const other = CodexChatStore.createThread(null, '딴 얘기', 'llm', kai.id)
    linked.LinkedFileStore.setThreadLinks(plan, [{ id: shared.id, write: true }])
    linked.LinkedFileStore.setThreadLinks(meeting, [{ id: shared.id, write: true }])
    OwnedLorebookStore.setThreadLinks(meeting, [book.id])
    OwnedLorebookStore.setThreadLinks(diary, [book.id])
    assert.deepEqual(new Set(connectedThreadIds(plan, null)), new Set([meeting]))
    assert.deepEqual(new Set(connectedThreadIds(meeting, null)), new Set([plan, diary]))
    assert.deepEqual(connectedThreadIds(other, null), [], 'nothing linked, nothing connected')
    const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
    const global = ChatLorebookStore.create({ name: '전역 세계관', entries: [] })
    ChatProfileStore.update(kai.id, { lorebookIds: [global.id] })
    assert.deepEqual(connectedThreadIds(other, null), [], "a global book on Kai's profile does not tie Kai's chats together")
    ChatProfileStore.update(kai.id, { lorebookIds: [] })

    // A setting book shared by separate chats: lore only, no history across them.
    const loreOnly = OwnedLorebookStore.update(book.id, me, { connectsChats: false })
    assert.equal(loreOnly?.connectsChats, false)
    assert.deepEqual(connectedThreadIds(diary, null), [], 'a lore-only book connects nobody')
    assert.deepEqual(new Set(connectedThreadIds(meeting, null)), new Set([plan]), 'the shared folder still connects')
    assert.equal(sharesKnowledge({ id: diary, account_id: null, profile_id: kai.id }), false, 'a direct chat with only a lore-only book gets no history tools')
    assert.throws(() => OwnedLorebookStore.update(book.id, me, { connectsChats: 'no' }), /connectsChats/)
    OwnedLorebookStore.update(book.id, me, { connectsChats: true })
    assert.deepEqual(new Set(connectedThreadIds(meeting, null)), new Set([plan, diary]))

    const say = (threadId: number, role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null })
    say(meeting, 'assistant', '사전 공지는 18일로 당기자. 예산은 120만 원.')
    say(meeting, 'assistant', '공지 문구는 내가 쓸게.')
    say(other, 'assistant', '사전 공지 18일 얘기는 여기도 있어.')
    const hits = searchChatMessages(connectedThreadIds(plan, null), '공지 18일', 10)
    assert.equal(hits.length, 1, 'every word must appear, in connected chats only')
    assert.equal(hits[0].chat_id, meeting)
    assert.match(hits[0].excerpt, /18일/)
  })

  await t.test('direct chats search their own history and connected chats through the room history tools', async () => {
    const shared = FileStoreService.createFolder(me, null, '노트')
    const plan = CodexChatStore.createThread(null, '계획 1:1', 'llm', rina.id)
    const room = ChatGroupStore.create(null, '아이디어 회의', [rina.id, kai.id], rina.id)
    linked.LinkedFileStore.setThreadLinks(plan, [{ id: shared.id, write: false }])
    linked.LinkedFileStore.setThreadLinks(room, [{ id: shared.id, write: false }])
    CodexChatStore.addMessage({ thread_id: room, role: 'assistant', content: '굿즈는 머그컵과 엽서 두 종.', tool_calls: [], status: 'completed', error: null, speaker_profile_id: kai.id })
    const roomMessage = CodexChatStore.listMessages(room).at(-1)!
    CodexChatStore.addMessage({ thread_id: plan, role: 'user', content: '오늘은 굿즈 얘기만 하자', tool_calls: [], status: 'completed', error: null })
    const context: ChatExecutionContext = { threadId: plan, profileId: rina.id, kind: 'direct', replyId: 'hist-1' }
    const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(requester, [], null, { chatContext: context })
    try {
      const own = JSON.parse(textOf(await bridge.call('room_history_search', { query: '굿즈' })))
      assert.equal(own.length, 1, 'its own chat by default')
      const connected = JSON.parse(textOf(await bridge.call('room_history_search', { query: '머그컵', chats: 'connected' })))
      assert.equal(connected[0].chat_id, room)
      assert.equal(connected[0].speaker, '카이')
      const read = JSON.parse(textOf(await bridge.call('room_history_read', { room_id: room, message_id: roomMessage.id })))
      assert.equal(read.at(-1).text, '굿즈는 머그컵과 엽서 두 종.')
      const stranger = CodexChatStore.createThread(null, '남의 방', 'llm', kai.id)
      const refused = await bridge.call('room_history_read', { room_id: stranger, message_id: 1 })
      assert.equal(refused.isError, true)
      assert.match(textOf(refused), /connected/)
    } finally { close(); await bridge.close() }
  })

  await t.test('a direct chat keeps shared history tools on native pages, but never on public pages', async () => {
    const threadId = CodexChatStore.createThread(null, '그냥 수다', 'llm', kai.id)
    const names = async (page?: ChatExecutionContext['page']) => {
      const bridge = await openChatMcpBridge(requester, [], null, { chatContext: { threadId, profileId: kai.id, kind: 'direct', replyId: 'plain', ...(page ? { page } : {}) } })
      try { return bridge.tools.map((tool) => tool.function.name) } finally { await bridge.close() }
    }
    assert.ok(!(await names()).includes('room_history_search'), 'a plain chat keeps its short list')
    const book = OwnedLorebookStore.create(me, { name: '수다 기록' })
    OwnedLorebookStore.setThreadLinks(threadId, [book.id])
    assert.ok((await names()).includes('room_history_search'))
    assert.ok((await names({ path: '/prompts', title: '프롬프트' } as ChatExecutionContext['page'])).includes('room_history_search'), 'native page connections preserve already permitted tools')
    assert.ok(!(await names({ path: '/public/workflows/shared', title: '공유 워크플로' } as ChatExecutionContext['page'])).includes('room_history_search'), 'public page content never gains access to chat history')
  })

  await t.test('a profile with only a writable linked folder gets the task tools', async () => {
    const folder = FileStoreService.createFolder(me, null, '문서함')
    const threadId = CodexChatStore.createThread(null, '문서 작업', 'llm', kai.id)
    const names = async () => {
      const bridge = await openChatMcpBridge(requester, [], null, { chatContext: { threadId, profileId: kai.id, kind: 'direct', replyId: 'tasks' } })
      try { return bridge.tools.map((tool) => tool.function.name) } finally { await bridge.close() }
    }
    assert.ok(!(await names()).includes('task_propose'), 'nothing to work with')
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: folder.id, write: false }])
    assert.ok(!(await names()).includes('task_propose'), 'reading alone is no work')
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: folder.id, write: true }])
    assert.ok((await names()).includes('task_propose'))
  })

  await t.test("group rooms: each member keeps its own lore spacing", () => {
    const room = ChatGroupStore.create(null, '로어 회의', [rina.id, kai.id], rina.id)
    const say = (role: 'user' | 'assistant', content: string, speaker?: number, replyId?: string) => CodexChatStore.addMessage({
      thread_id: room, role, content, tool_calls: [], status: 'completed', error: null,
      ...(speaker ? { speaker_profile_id: speaker } : {}), ...(replyId ? { routing: { replyId, replyTo: null, recipients: ['user'] } } : {}),
    })
    say('user', '축제 장소를 정하자.')
    proposeLore({ threadId: room, profileId: rina.id, kind: 'group', replyId: 'g-r1' }, { title: '축제 장소', content: '축제는 등대 광장에서 연다.' })
    say('assistant', '등대 광장이 좋아.', rina.id, 'g-r1')
    const kaiLore = proposeLore({ threadId: room, profileId: kai.id, kind: 'group', replyId: 'g-k1' }, { title: '축제 예산', content: '예산 상한은 120만 원이다.' })
    assert.equal(kaiLore.title, '축제 예산', "Rina's entry does not hold back Kai's")
    say('assistant', '예산은 120만 원.', kai.id, 'g-k1')
    assert.throws(() => proposeLore({ threadId: room, profileId: rina.id, kind: 'group', replyId: 'g-r2' }, { title: '축제 날짜', content: '축제는 10월 18일.' }), /within the last 3 replies/)
  })

  await t.test('group rooms: only the latest wake of each automation stays in view; Codex members get the room summary for a gap', () => {
    const room = ChatGroupStore.create(null, '루틴 회의', [rina.id, kai.id], rina.id)
    const wake = (content: string) => CodexChatStore.addMessage({ thread_id: room, role: 'user', content, tool_calls: [], status: 'completed', error: null, routing: { replyTo: null, recipients: [], routine: { source: 'routine', id: 3, name: '아침 회의' } } })
    const talk = (content: string, speaker: number) => CodexChatStore.addMessage({ thread_id: room, role: 'assistant', content, tool_calls: [], status: 'completed', error: null, speaker_profile_id: speaker })
    wake('[Routine] 회의 이어가')
    talk('어제 정한 장소는 등대 광장.', rina.id)
    wake('[Routine] 회의 이어가 (2)')
    talk('굿즈 시안 나왔어.', kai.id)
    const messages = CodexChatStore.listMessages(room)
    const kept = withoutStaleWakes(messages).map((message) => message.content)
    assert.deepEqual(kept, ['어제 정한 장소는 등대 광장.', '[Routine] 회의 이어가 (2)', '굿즈 시안 나왔어.'])

    const thread = CodexChatStore.findThreadById(room)!
    const members = [ChatProfileStore.find(rina.id)!, ChatProfileStore.find(kai.id)!]
    const input = (summaryOn: boolean, lastSeen: number | null) => buildGroupCodexInput({
      thread: { ...thread, summary_enabled: summaryOn ? 1 : 0, summary: '장소는 등대 광장, 예산은 120만 원.' },
      members, self: members[1], messages, lastSeenMessageId: lastSeen, windowLimit: 30, lore: '', directive: '',
    })
    assert.match(input(true, null), /\[방 요약\]\n장소는 등대 광장/, 'a first turn gets it')
    assert.doesNotMatch(input(false, null), /방 요약/, 'not when the room summary is off')
    assert.doesNotMatch(input(true, messages[1].id), /방 요약/, 'nothing missed beyond the window: its own memory covers it')
    assert.doesNotMatch(input(true, null), /회의 이어가\n/, 'the older wake is not in the transcript')
  })

  await t.test('group rooms: a plan names who does each step; the runner wakes that member, an "all" step each in turn', async (st) => {
    const { ChatTaskStore, ChatTaskRunner } = await import('../src/services/codex-chat/chatTasks')
    const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
    const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
    const mio = ChatProfileStore.create({ name: '미오', engine: 'llm', providerName: 'conn' })
    const folder = FileStoreService.createFolder(me, null, '회의 문서')
    const room = ChatGroupStore.create(null, '기획 회의', [rina.id, kai.id, mio.id], rina.id)
    linked.LinkedFileStore.setThreadLinks(room, [{ id: folder.id, write: true }])
    const context: ChatExecutionContext = { threadId: room, profileId: rina.id, kind: 'group', replyId: 'plan-1' }
    const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(requester, [], null, { chatContext: context })
    let taskId = 0
    try {
      assert.ok(bridge.tools.some((tool) => tool.function.name === 'task_propose'), 'a room with a writable folder plans')
      const unknown = await bridge.call('task_propose', { goal: '기획', steps: [{ title: '정리', assignee: '누구' }] })
      assert.equal(unknown.isError, true)
      assert.match(textOf(unknown), /Members: 리나, 카이, 미오, or "all"/)
      const proposed = JSON.parse(textOf(await bridge.call('task_propose', { goal: '가을 이벤트 기획서 초안', steps: [{ title: '작년 반응 정리', assignee: '미오' }, { title: '3안 평가', assignee: '모두' }, { title: '기획서.md 쓰기' }] })))
      taskId = proposed.taskId
      const card = ChatProposalStore.find(proposed.proposalId)
      assert.deepEqual(card?.kind === 'task_plan' ? card.steps.map((step) => step.assignee) : null, [mio.id, 'all', rina.id], 'an unnamed step is the proposer\'s')
    } finally { close(); await bridge.close() }

    const sent: Array<{ text: string; recipients?: number[]; task?: { assignee?: number } }> = []
    st.mock.method(GroupChatService, 'sendMessage', async (...args: unknown[]) => { sent.push({ text: String(args[2]), ...(args[9] as object) }) })
    const setStep = (index: number, status: 'done') => ChatTaskStore.update(taskId, { steps: ChatTaskStore.find(taskId)!.steps.map((step, at) => at === index ? { ...step, status } : step) })
    ChatTaskStore.update(taskId, { status: 'running' })
    await ChatTaskRunner.continue(room, '사용자가 플랜을 승인했어.')
    assert.deepEqual(sent[0].recipients, [mio.id])
    assert.equal(sent[0].task?.assignee, mio.id)
    assert.match(sent[0].text, /1\. \[ \] 작년 반응 정리 @미오\n2\. \[ \] 3안 평가 @all\n3\. \[ \] 기획서\.md 쓰기 @리나/)
    assert.match(sent[0].text, /This turn is 미오's: step 1 is yours/)

    setStep(0, 'done')
    for (let turn = 0; turn < 3; turn++) await ChatTaskRunner.continue(room, '이전 답변이 끝났어.')
    assert.deepEqual(sent.slice(1).map((entry) => entry.recipients?.[0]), [rina.id, kai.id, mio.id], 'every member once, in room order')
    assert.match(sent[2].text, /this turn is 카이's\. .*Do not mark the step done/)
    assert.match(sent[3].text, /You are the last: once the parts are in, mark step 2 done/)
    await ChatTaskRunner.continue(room, '이전 답변이 끝났어.')
    assert.deepEqual(sent[4].recipients, [rina.id])
    assert.match(sent[4].text, /every member has had their turn on step 2\. Wrap it up/)

    setStep(1, 'done')
    await ChatTaskRunner.continue(room, '이전 답변이 끝났어.')
    assert.deepEqual(sent[5].recipients, [rina.id])
    assert.match(sent[5].text, /step 3 is yours/)

    // Only the newest continuation stays in the members' view.
    for (const step of [1, 2]) CodexChatStore.addMessage({ thread_id: room, role: 'user', content: `[Task continuation] ${step}`, tool_calls: [], status: 'completed', error: null, routing: { replyTo: null, recipients: [rina.id], task: { id: taskId, step, total: 3, title: null, event: '' } } })
    assert.deepEqual(withoutStaleWakes(CodexChatStore.listMessages(room)).map((message) => message.content), ['[Task continuation] 2'])
  })

  await t.test('minutes: each new summary stretch is added to 회의록/<date>.md in a writable linked folder, and stays', async (st) => {
    const { ChatMinutesStore, MINUTES_FOLDER } = await import('../src/services/codex-chat/chatMinutes')
    const { summarizeAll } = await import('../src/services/codex-chat/llmChatContext')
    const { ChatSummaryStore } = await import('../src/services/codex-chat/chatMemory')
    let stretch = 0
    st.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== 'POST') return new Response('', { status: 404 })
      return Response.json({ choices: [{ message: { content: `${++stretch}차 정리: 일정은 열흘.` }, finish_reason: 'stop' }] })
    })
    const folder = FileStoreService.createFolder(me, null, '축제 기획')
    const readOnly = FileStoreService.createFolder(me, null, '참고')
    const threadId = CodexChatStore.createThread(null, '축제 회의', 'llm', rina.id)
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: folder.id, write: true }, { id: readOnly.id, write: false }])
    assert.throws(() => ChatMinutesStore.set(threadId, readOnly.id), /쓰기로 연결한 폴더/)
    assert.throws(() => ChatMinutesStore.set(threadId, FileStoreService.createFolder(me, null, '남의 폴더').id), /쓰기로 연결한 폴더/)
    ChatMinutesStore.set(threadId, folder.id)
    const say = (role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null })
    const minutes = async () => {
      const dir = FileStoreService.findChild(me, folder.id, MINUTES_FOLDER)
      const files = dir ? FileStoreService.list(me, dir.id, 0, 10).entries : []
      return Promise.all(files.map(async (file) => ({ name: file.name, text: (await FileStoreService.readText(me, file.id)).text })))
    }

    say('user', '축제 일정 정하자.'); say('assistant', '열흘 어때?')
    assert.ok(await summarizeAll(threadId, ChatProfileStore.find(rina.id)!))
    say('user', '예산은?'); say('assistant', '120만 원.')
    assert.ok(await summarizeAll(threadId, ChatProfileStore.find(rina.id)!))
    const [file] = await minutes()
    assert.match(file.name, /^\d{4}-\d{2}-\d{2}\.md$/)
    assert.match(file.text, /^## \d\d:\d\d – \d\d:\d\d · 축제 회의\n1차 정리: 일정은 열흘\.\n\n## \d\d:\d\d – \d\d:\d\d · 축제 회의\n2차 정리: 일정은 열흘\.\n$/)

    ChatSummaryStore.replaceAll(threadId, null, null)
    assert.equal((await minutes())[0].text, file.text, 'clearing the summary leaves the minutes')

    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: folder.id, write: false }])
    say('user', '장소는?'); say('assistant', '등대 광장.')
    assert.ok(await summarizeAll(threadId, ChatProfileStore.find(rina.id)!))
    assert.equal((await minutes())[0].text, file.text, 'a folder no longer writable gets nothing')
  })
})
