import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

/**
 * Linked files: folders and text files of the owner's file store linked to a chat or a profile. Requests carry only
 * a name index; the linked_* tools search, read and (where allowed) write inside the linked places and nowhere else.
 */
test('chat linked files: links, index, tools stay inside the linked places, writing only where allowed', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-linked-files-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-linked-files-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const linked = await import('../src/services/codex-chat/chatLinkedFiles')
  const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')

  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn' })
  // No accounts configured: the bootstrap owner (session without an account) owns these chats and files.
  const me = fileOwnerKey(null)
  const threadId = CodexChatStore.createThread(null, '연결 실험', 'llm', profile.id)

  // 캐릭터/리나 일지 (writable), 세계관 (read-only), 비밀 (not linked), a single file, and a lorebook.
  const characters = FileStoreService.createFolder(me, null, '캐릭터')
  const journal = FileStoreService.createFolder(me, characters.id, '리나 일지')
  FileStoreService.writeText(me, journal.id, '2026-10-09.md', '# 10월 9일\n바다에 갔다.\n', { create: true })
  FileStoreService.writeText(me, journal.id, '2026-10-10.md', '# 10월 10일\n한강 자전거.\n', { create: true })
  const world = FileStoreService.createFolder(me, null, '세계관')
  const people = FileStoreService.createFolder(me, world.id, '인물')
  FileStoreService.writeText(me, people.id, '카이.md', '카이는 등대지기다. 은반지를 낀다.\n', { create: true })
  FileStoreService.writeText(me, world.id, '연표.md', '1년: 항구가 열렸다.\n', { create: true })
  const secret = FileStoreService.createFolder(me, null, '비밀')
  FileStoreService.writeText(me, secret.id, '일기.md', '은반지는 사실 가짜다.\n', { create: true })
  const memo = FileStoreService.writeText(me, null, '장기기억 정리.md', '사용자는 고양이 알레르기.\n', { create: true })
  const book = OwnedLorebookStore.create(me, { name: '세계 로어' })

  await t.test('links: own folders and text files only, never the lorebooks; kept links pass', () => {
    assert.throws(() => linked.LinkedFileStore.setThreadLinks(threadId, [{ id: book.folderId, write: true }]), /로어북 폴더/)
    assert.throws(() => linked.LinkedFileStore.setThreadLinks(threadId, [{ id: 'f'.repeat(32), write: false }]), /찾을 수 없어/)
    const links = linked.LinkedFileStore.setThreadLinks(threadId, [{ id: journal.id, write: true }, { id: world.id }, journal.id])
    assert.deepEqual(links, [{ id: journal.id, write: true }, { id: world.id, write: false }], 'normalized and deduplicated')
    ChatProfileStore.update(profile.id, { linkedFiles: [{ id: memo.id, write: false }] })
    assert.deepEqual(ChatProfileStore.find(profile.id)!.linkedFiles, [{ id: memo.id, write: false }])
  })

  const places = () => linked.placesForRequest({ thread: CodexChatStore.findThreadById(threadId)!, profile: ChatProfileStore.find(profile.id) })

  await t.test('the index names folders and files, never contents, newest dated note first', () => {
    const index = linked.buildLinkedIndex(places(), () => 1)
    assert.match(index, /^## 연결 파일\n\[리나 일지\] 쓰기 · 2026-10-10\.md · 2026-10-09\.md\n\[세계관\] 읽기 · 인물\/\(1\) · 연표\.md\n\[장기기억 정리\.md\] 읽기 · 파일\n/)
    assert.doesNotMatch(index, /바다|등대지기|알레르기/, 'no contents')
    assert.match(index, /linked_write·linked_edit/)
    const short = linked.buildLinkedIndex(places(), () => 100_000)
    assert.match(short, /\[리나 일지\] 쓰기 · 2개 항목/, 'over budget: counts only')
  })

  await t.test('the index travels with the lore index of an API request only beside the tools', () => {
    const thread = CodexChatStore.findThreadById(threadId)!
    const current = ChatProfileStore.find(profile.id)!
    const request = (names: string[]) => buildChatMessages({ profile: current, thread, messages: [], config: resolveContextConfig(thread, current), tools: names.map((name) => ({ type: 'function', function: { name, description: '', parameters: {} } })) as never })
    const system = (names: string[]) => request(names).filter((message) => message.role === 'system').map((message) => String(message.content)).join('\n')
    assert.match(system(['linked_read']), /## 연결 파일/)
    assert.doesNotMatch(system([]), /## 연결 파일/)
  })

  await t.test('paths stay inside the places; reading, listing and searching see only linked files', async () => {
    const list = linked.listLinked(places())
    assert.match(list, /\[리나 일지\] 쓰기 · 폴더 · 2개 항목/)
    assert.match(linked.listLinked(places(), '[세계관]'), /인물\/ \(1\)\n연표\.md/)
    assert.match(await linked.readLinked(places(), '[세계관]/인물/카이.md'), /^\[파일 \[세계관\]\/인물\/카이\.md\]\n카이는 등대지기다/)
    assert.match(await linked.readLinked(places(), '세계관/연표.md'), /항구가 열렸다/, 'brackets are optional')
    assert.match(await linked.readLinked(places(), '[장기기억 정리.md]'), /고양이 알레르기/, 'a profile link')
    await assert.rejects(linked.readLinked(places(), '[세계관]/../비밀/일기.md'), /above a linked place/)
    await assert.rejects(linked.readLinked(places(), '[비밀]/일기.md'), /not found/)
    const found = await linked.searchLinked(places(), '은반지')
    assert.match(found, /\[세계관\]\/인물\/카이\.md/)
    assert.doesNotMatch(found, /비밀|가짜/, 'the unlinked folder never shows')
  })

  await t.test('writing only where the link allows it; edits are exact or nothing', async () => {
    assert.match(linked.writeLinked(places(), '[리나 일지]/2026-10/2026-10-11.md', '# 10월 11일\n공포영화.\n'), /썼어/)
    assert.ok(FileStoreService.findChild(me, journal.id, '2026-10'), 'the folder on the way is made')
    assert.throws(() => linked.writeLinked(places(), '[리나 일지]/2026-10-09.md', 'x'), /already exists/)
    assert.throws(() => linked.writeLinked(places(), '[세계관]/새.md', 'x'), /read-only/)
    assert.throws(() => linked.editLinked(places(), '[세계관]/연표.md', { append: 'x' }), /read-only/)
    linked.editLinked(places(), '[리나 일지]/2026-10-09.md', { append: '노을이 예뻤다.\n' })
    assert.match(await linked.readLinked(places(), '[리나 일지]/2026-10-09.md'), /바다에 갔다\.\n노을이 예뻤다\./)
    assert.throws(() => linked.editLinked(places(), '[리나 일지]/2026-10-09.md', { edits: [{ old_text: '없는 말', new_text: 'x' }] }), /찾지 못했어/)
    assert.match(linked.editLinked(places(), '[리나 일지]/2026-10-09.md', { edits: [{ old_text: '바다', new_text: '동해 바다' }] }), /1군데 바꿈/)
  })

  await t.test('the tools: offered with links (write only with a writable link), withheld on a connected page, refused once unlinked', async () => {
    const context = (replyId: string, extra: Partial<ChatExecutionContext> = {}): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId, ...extra })
    const open = async (chatContext: ChatExecutionContext) => openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext })
    const names = (bridge: Awaited<ReturnType<typeof open>>) => bridge.tools.map((tool) => tool.function.name).filter((name) => name.startsWith('linked_')).sort()

    const controller = new AbortController()
    const close = registerChatReply(context('t1'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await open(context('t1'))
    try {
      assert.deepEqual(names(bridge), ['linked_edit', 'linked_list', 'linked_read', 'linked_search', 'linked_write'])
      const read = await bridge.call('linked_read', { target: '[세계관]/연표.md' })
      assert.match(JSON.stringify(read), /항구가 열렸다/)
      linked.LinkedFileStore.setThreadLinks(threadId, [{ id: journal.id, write: true }])
      const gone = await bridge.call('linked_read', { target: '[세계관]/연표.md' })
      assert.equal(gone.isError, true, 'unlinked mid-reply: refused at once')
    } finally { close(); await bridge.close() }

    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: world.id, write: false }])
    const readOnly = await open(context('t2'))
    try { assert.deepEqual(names(readOnly), ['linked_list', 'linked_read', 'linked_search']) } finally { await readOnly.close() }

    const page = await open(context('t3', { page: { path: '/files', title: '파일', fields: [], actions: [] } as never }))
    try { assert.deepEqual(names(page), [], 'a connected page carries no linked files') } finally { await page.close() }
  })

  await t.test('clearing the conversation keeps the links', () => {
    linked.LinkedFileStore.setThreadLinks(threadId, [{ id: journal.id, write: true }])
    CodexChatStore.clearThread(threadId, '')
    assert.deepEqual(linked.LinkedFileStore.threadLinks(threadId), [{ id: journal.id, write: true }])
  })

  await t.test('the context tab lists the chat links and the profile links, a missing one marked', () => {
    const views = linked.threadLinkedFiles(CodexChatStore.findThreadById(threadId)!, [{ id: profile.id, name: '리나', linkedFiles: ChatProfileStore.find(profile.id)!.linkedFiles }])
    assert.deepEqual(views.map((view) => [view.name, view.via, view.write, view.kind, view.path]), [['리나 일지', 'thread', true, 'folder', '/캐릭터'], ['장기기억 정리.md', 'profile', false, 'file', '/']])
    assert.deepEqual(views[1].profiles, [{ id: profile.id, name: '리나' }])
    FileStoreService.deleteTree(me, journal.id)
    assert.equal(linked.threadLinkedFiles(CodexChatStore.findThreadById(threadId)!, [])[0].missing, true)
  })
})
