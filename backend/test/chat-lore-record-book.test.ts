import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

/**
 * A chat's record book: an account lorebook made empty from the chat (linked to it and recorded into), where save_lore
 * saves and edit_lore_file grows the entries' files. The choice lives on the chat, so clearing the conversation keeps it.
 */
test('chat lore record book: create from the chat, save_lore and edit_lore_file write there, clearing keeps it', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-lore-record-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-lore-record-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { proposeLore, undoLoreProposal } = await import('../src/services/codex-chat/chatLoreProposals')
  const { booksForRequest, buildLoreIndex, threadLorebooks } = await import('../src/services/codex-chat/chatLoreContext')
  const { editLoreFile } = await import('../src/mcp/tools/chatLoreTools')

  updateChatSettings({ enabled: true, loreAutoSave: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn' })
  // No accounts configured: the bootstrap owner (session without an account) owns these chats and books.
  const me = fileOwnerKey(null)
  const threadId = CodexChatStore.createThread(null, '기억 실험', 'llm', profile.id)
  const context = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
  const chat = { threadId, profileId: profile.id, accountId: null }
  const say = (role: 'user' | 'assistant', content: string, replyId?: string) => CodexChatStore.addMessage({
    thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null,
    ...(replyId ? { routing: { replyId, replyTo: null, recipients: ['user'] } } : {}),
  })
  const index = () => buildLoreIndex(booksForRequest({ thread: CodexChatStore.findThreadById(threadId)!, profile: ChatProfileStore.find(profile.id)! }), () => 1, (text) => text, false)

  const book = OwnedLorebookStore.createForThread(threadId, '리나 기억')

  await t.test('a book made from the chat is empty, linked, recorded into, and shown in the index while empty', () => {
    assert.equal(book.kind, 'account')
    assert.deepEqual(book.entries, [])
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [book.id])
    assert.equal(OwnedLorebookStore.recordBookId(threadId), book.id)
    assert.equal(threadLorebooks(CodexChatStore.findThreadById(threadId)!, [ChatProfileStore.find(profile.id)!]).recordBookId, book.id)
    assert.match(index(), /\[리나 기억\]\(기록\) 비어 있음/)
    assert.throws(() => OwnedLorebookStore.createForThread(threadId, '리나 기억'), /같은 이름/)
  })

  let savedId = 0
  await t.test('save_lore saves into the record book, not the chat\'s own book', () => {
    say('user', '이건 꼭 기억해줘: 나는 고양이 알레르기가 있어.')
    const proposal = proposeLore(context('r1'), { title: '고양이 알레르기', keys: ['cat', '고양이'], content: '사용자는 고양이 알레르기가 있다.', file: { name: '건강.md', text: '# 건강\n' } })
    assert.equal(proposal.kind, 'lore')
    assert.equal(proposal.bookId, book.id)
    assert.equal(proposal.bookName, '리나 기억')
    assert.equal(proposal.savedId, book.id)
    savedId = proposal.id
    say('assistant', '알았어.', 'r1')
    assert.equal(OwnedLorebookStore.chatBookOf(threadId), null, 'the chat book stays unmade')
    const [entry] = OwnedLorebookStore.find(book.id, me)!.entries
    assert.equal(entry.title, '고양이 알레르기')
    assert.equal(entry.file, '자료/건강.md')
    assert.match(index(), /\[리나 기억\]\(기록\) 고양이 알레르기\(자료\)/)
  })

  await t.test('edit_lore_file appends to and edits the entry\'s file in the record book', async () => {
    const appended = editLoreFile(chat, { title: '고양이 알레르기', append: '- 10월: 재채기\n' })
    assert.equal(appended.book, '리나 기억')
    const read = async () => (await FileStoreService.readText(me, OwnedLorebookStore.find(book.id, me)!.entries[0].fileId!, 0, 32000)).text
    assert.equal(await read(), '# 건강\n- 10월: 재채기\n')
    const edited = editLoreFile(chat, { title: '고양이 알레르기', edits: [{ old_text: '재채기', new_text: '재채기, 눈 가려움' }] })
    assert.equal(edited.replaced, 1)
    assert.equal(await read(), '# 건강\n- 10월: 재채기, 눈 가려움\n')
    assert.throws(() => editLoreFile(chat, { title: '고양이 알레르기', edits: [{ old_text: '없는 말', new_text: 'x' }] }), /찾지 못했어/)
    assert.throws(() => editLoreFile(chat, { title: '없는 항목', append: 'x' }), /not found/)
    assert.throws(() => editLoreFile(chat, { title: '고양이 알레르기' }), /either append or edits/)
    assert.throws(() => editLoreFile(chat, { title: '고양이 알레르기', append: 'x'.repeat(300 * 1024) }), /256 KB/)
    assert.equal(await read(), '# 건강\n- 10월: 재채기, 눈 가려움\n', 'refused edits save nothing')

    CodexChatStore.updateThreadContext(threadId, { loreAutoSave: false })
    assert.throws(() => editLoreFile(chat, { title: '고양이 알레르기', append: 'x' }), /auto-save is off/)
    CodexChatStore.updateThreadContext(threadId, { loreAutoSave: null })
  })

  await t.test('clearing the conversation keeps the links and the record book', () => {
    CodexChatStore.clearThread(threadId, '')
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [book.id])
    assert.equal(OwnedLorebookStore.recordBookId(threadId), book.id)
    assert.equal(OwnedLorebookStore.find(book.id, me)!.entries.length, 1)
  })

  await t.test('undo takes the entry and the file it brought out of the book it went into', () => {
    const fileId = OwnedLorebookStore.find(book.id, me)!.entries[0].fileId!
    const undone = undoLoreProposal(savedId)
    assert.equal(undone.changed, undefined, JSON.stringify(undone))
    assert.equal(undone.book?.id, book.id)
    assert.deepEqual(OwnedLorebookStore.find(book.id, me)!.entries, [])
    assert.throws(() => FileStoreService.get(me, fileId), /찾을 수 없어/)
  })

  await t.test('the record book must be linked; unlinking or deleting it goes back to the chat book', () => {
    const other = OwnedLorebookStore.create(me, { name: '다른 책' })
    assert.throws(() => OwnedLorebookStore.setRecordBook(threadId, other.id), /연결한 계정 로어북만/)
    OwnedLorebookStore.setThreadLinks(threadId, [book.id, other.id])
    OwnedLorebookStore.setRecordBook(threadId, other.id)
    assert.equal(OwnedLorebookStore.recordBookId(threadId), other.id)
    OwnedLorebookStore.setThreadLinks(threadId, [book.id])
    assert.equal(OwnedLorebookStore.recordBookId(threadId), null, 'unlinked: back to the chat book')
    OwnedLorebookStore.setThreadLinks(threadId, [book.id, other.id])
    assert.equal(OwnedLorebookStore.recordBookId(threadId), null, 'relinking does not bring the choice back')

    OwnedLorebookStore.setRecordBook(threadId, book.id)
    OwnedLorebookStore.delete(book.id, me)
    assert.equal(OwnedLorebookStore.recordBookId(threadId), null)
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [other.id])
  })

  await t.test('save_lore asks for keywords in the lore key language of the chat settings; edit_lore_file comes with it', async () => {
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const offered = async () => {
      const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: context('desc') })
      try {
        return {
          save: bridge.tools.find((tool) => tool.function.name === 'save_lore')!.function.description ?? '',
          edit: bridge.tools.some((tool) => tool.function.name === 'edit_lore_file'),
        }
      } finally { await bridge.close() }
    }
    updateChatSettings({ loreKeyLanguage: 'ko' })
    const plain = await offered()
    assert.match(plain.save, /in English and also in 한국어/)
    assert.match(plain.save, /this chat's own lorebook/)
    assert.doesNotMatch(plain.save, /long-term memory/, 'the wider rule only for a record book')
    assert.equal(plain.edit, false, 'no file to change: no edit_lore_file')
    updateChatSettings({ loreKeyLanguage: null })
    assert.match((await offered()).save, /in English only/)

    const journal = OwnedLorebookStore.createForThread(threadId, '일지')
    const materials = FileStoreService.ensureFolder(me, journal.folderId, '자료')
    FileStoreService.writeText(me, materials.id, '10월.md', '# 10월\n')
    OwnedLorebookStore.update(journal.id, me, { entries: [{ id: 'j', title: '10월 일지', keys: ['diary'], content: '10월의 일.', file: '자료/10월.md' }] })
    const recorded = await offered()
    assert.match(recorded.save, /"일지", this chat's record book/)
    assert.match(recorded.save, /long-term memory/)
    assert.equal(recorded.edit, true)
  })

  await t.test('keeping the chat book while it is the record book makes the kept book the record book', () => {
    const keepId = CodexChatStore.createThread(null, '보관 실험', 'llm', profile.id)
    OwnedLorebookStore.saveChatBook(keepId, [{ id: 'a', title: '등대', keys: ['등대'], content: '등대는 오래됐다.' }])
    const kept = OwnedLorebookStore.keepChatBook(keepId, { link: true })
    assert.equal(OwnedLorebookStore.recordBookId(keepId), kept.id)
  })
})
