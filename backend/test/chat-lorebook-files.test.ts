import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('lorebook files: account and chat books as file store folders, cache sync, memory migration', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-lorebook-files-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-lorebook-files-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { createUserSettingsSchema } = await import('../src/database/userSettingsSchema')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { storedFilePath } = await import('../src/services/fileStorePaths')
  const { ChatLorebookStore, normalizeLorebook, loreEntryTitle } = await import('../src/services/codex-chat/chatLorebook')
  const files = await import('../src/services/codex-chat/chatLorebookFiles')
  const { OwnedLorebookStore, reconcileLorebookFolders, LOREBOOK_ROOT_FOLDER, CHAT_LOREBOOK_FOLDER } = files

  const me = fileOwnerKey(1)
  const other = fileOwnerKey(2)
  const child = (owner: string, parentId: string | null, name: string) => FileStoreService.findChild(owner, parentId, name)
  const readBlob = (owner: string, id: string) => fs.readFileSync(storedFilePath(owner, id), 'utf8')
  const cached = (id: number) => normalizeLorebook((db.prepare('SELECT entries FROM chat_lorebooks WHERE id = ?').get(id) as { entries: string }).entries)

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })

  await t.test('entries keep title, file and fileId; books without them still import', () => {
    const [plain] = normalizeLorebook([{ key: ['카이'], content: '카이는 수리공이다.', comment: '카이 소개' }])
    assert.equal(plain.title, '카이 소개', 'a SillyTavern comment is the title')
    assert.equal(plain.file, null)
    assert.equal(plain.fileId, null)
    const [linked] = normalizeLorebook([{ keys: ['먹물'], content: 'x', title: '  먹물  실종 ', file: '.\\자료\\전단지.md', fileId: 'a'.repeat(32) }])
    assert.deepEqual([linked.title, linked.file, linked.fileId], ['먹물 실종', '자료/전단지.md', 'a'.repeat(32)])
    assert.equal(loreEntryTitle({ title: '', keys: ['바다'], content: '...' }), '바다')
    assert.equal(loreEntryTitle({ title: '', keys: [], content: '가'.repeat(30) }), '가'.repeat(20))
    // A global book links no files.
    const global = ChatLorebookStore.create({ name: '항구 도시', entries: [{ keys: ['항구'], content: '항구 도시', file: '자료/x.md' }] })
    assert.equal(global.kind, 'global')
    assert.equal(global.entries[0].file, null)
  })

  let bookId = 0
  await t.test('an account book is a folder under 로어북/ with lorebook.json, lorebook.md and 자료/', () => {
    const book = OwnedLorebookStore.create(me, { name: '카이', entries: [{ keys: ['왼손'], content: '카이는 왼손잡이다.' }] })
    bookId = book.id
    assert.equal(book.kind, 'account')
    const lorebookRoot = child(me, null, LOREBOOK_ROOT_FOLDER)!
    const folder = child(me, lorebookRoot.id, '카이')!
    assert.equal(folder.id, book.folderId)
    assert.equal(child(me, folder.id, '자료')?.kind, 'folder')
    const json = child(me, folder.id, 'lorebook.json')!
    assert.deepEqual(JSON.parse(readBlob(me, json.id)).entries.map((entry: { content: string }) => entry.content), ['카이는 왼손잡이다.'])
    assert.match(readBlob(me, child(me, folder.id, 'lorebook.md')!.id), /^# 카이\n[\s\S]*## 왼손\n\n- 키워드: 왼손\n\n카이는 왼손잡이다\./)
    assert.deepEqual(cached(book.id).map((entry) => entry.content), ['카이는 왼손잡이다.'])
    assert.throws(() => OwnedLorebookStore.create(me, { name: '카이' }), /같은 이름의 로어북/)
    assert.throws(() => OwnedLorebookStore.create(me, { name: '채팅' }), /채팅 로어북 자리/)
    assert.throws(() => OwnedLorebookStore.create(me, { name: '  ' }), /이름을 입력/)
    // Account books stay out of the admin's global list and its edits.
    assert.ok(!ChatLorebookStore.list().some((entry) => entry.id === book.id))
    assert.equal(ChatLorebookStore.update(book.id, { name: 'x' }), null)
    assert.equal(ChatLorebookStore.delete(book.id), false)
    assert.deepEqual(OwnedLorebookStore.list(me).map((entry) => entry.id), [book.id])
    assert.deepEqual(OwnedLorebookStore.list(other), [])
    assert.equal(OwnedLorebookStore.find(book.id, other), null, 'another account cannot see it')
  })

  await t.test('lorebook.json edited outside the app: the hook and the startup pass bring the cache along', () => {
    const book = OwnedLorebookStore.find(bookId, me)!
    // Through the file store (the file page): the change hook re-reads it.
    FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({ name: '카이', entries: [{ keys: ['집'], content: '항구 근처 2층 집.' }] }))
    assert.deepEqual(cached(bookId).map((entry) => entry.content), ['항구 근처 2층 집.'])
    // Straight on disk while the app was down: the startup pass re-reads every book.
    const json = child(me, book.folderId, 'lorebook.json')!
    fs.writeFileSync(storedFilePath(me, json.id), JSON.stringify([{ keys: ['수리점'], content: '1층은 수리점.' }, { keys: ['집'], content: '항구 근처 2층 집.' }]))
    const result = reconcileLorebookFolders()
    assert.equal(result.refreshed, 1)
    assert.deepEqual(cached(bookId).map((entry) => entry.content), ['1층은 수리점.', '항구 근처 2층 집.'])
    // A broken file keeps the cache.
    fs.writeFileSync(storedFilePath(me, json.id), '{ not json')
    reconcileLorebookFolders()
    assert.equal(cached(bookId).length, 2)
    // A folder with a lorebook.json and no book yet becomes one.
    const lorebookRoot = child(me, null, LOREBOOK_ROOT_FOLDER)!
    const added = FileStoreService.createFolder(me, lorebookRoot.id, '세계관')
    FileStoreService.writeText(me, added.id, 'lorebook.json', JSON.stringify({ entries: [{ keys: ['항구'], content: '바다 냄새.' }] }))
    const adopted = OwnedLorebookStore.list(me).find((entry) => entry.folderId === added.id)
    assert.equal(adopted?.name, '세계관')
    assert.deepEqual(adopted?.entries.map((entry) => entry.content), ['바다 냄새.'])
    // Renaming the folder renames the book.
    FileStoreService.rename(me, added.id, '세계관 보강')
    assert.equal(OwnedLorebookStore.find(adopted!.id, me)?.name, '세계관 보강')
  })

  await t.test('a file link stays inside the book folder, is text only, and follows the file', () => {
    const book = OwnedLorebookStore.find(bookId, me)!
    const entry = { keys: ['어린 시절'], content: '바닷가 마을에서 자랐다.' }
    for (const file of ['../밖.md', '/etc/passwd.md', 'C:/x.md', '자료/../../밖.md', '..\\밖.md']) {
      assert.throws(() => OwnedLorebookStore.update(bookId, me, { entries: [{ ...entry, file }] }), /폴더 밖/, file)
    }
    assert.throws(() => OwnedLorebookStore.update(bookId, me, { entries: [{ ...entry, file: '자료/사진.png' }] }), /텍스트/)
    const materials = child(me, book.folderId, '자료')!
    const note = FileStoreService.writeText(me, materials.id, '어린시절.md', '# 어린 시절\n바닷가.')
    const saved = OwnedLorebookStore.update(bookId, me, { entries: [{ ...entry, file: '자료/어린시절.md' }] })!
    assert.equal(saved.entries[0].fileId, note.id, 'the path found the file')
    // Renamed and moved in the file page: the link follows by id, and lorebook.json is rewritten.
    FileStoreService.rename(me, note.id, '어린-시절.md')
    assert.equal(cached(bookId)[0].file, '자료/어린-시절.md')
    const deeper = FileStoreService.createFolder(me, materials.id, '과거')
    FileStoreService.move(me, [note.id], deeper.id)
    assert.equal(cached(bookId)[0].file, '자료/과거/어린-시절.md')
    const json = child(me, book.folderId, 'lorebook.json')!
    assert.equal(JSON.parse(readBlob(me, json.id)).entries[0].file, '자료/과거/어린-시절.md')
    // Moved out of the book: the id is let go, the path stays as it was.
    FileStoreService.move(me, [note.id], null)
    assert.deepEqual([cached(bookId)[0].file, cached(bookId)[0].fileId], ['자료/과거/어린-시절.md', null])
    // An unsafe path written into lorebook.json by hand is dropped, not followed.
    FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({ entries: [{ ...entry, file: '../../account-2/x.md' }] }))
    assert.equal(cached(bookId)[0].file, null)
  })

  await t.test('a chat book appears with its first entry and goes with its last', () => {
    const threadId = CodexChatStore.createThread(1, '바다 약속: 2/3', 'llm', profile.id)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId), null)
    assert.equal(OwnedLorebookStore.saveChatBook(threadId, []), null)
    const lorebookRoot = child(me, null, LOREBOOK_ROOT_FOLDER)!
    assert.equal(child(me, lorebookRoot.id, CHAT_LOREBOOK_FOLDER), null, 'no entries, no folder')
    const book = OwnedLorebookStore.addChatBookEntries(threadId, [{ id: 'ring', keys: ['반지'], content: '내일 저녁 반지를 준다.', constant: true }])!
    assert.equal(book.kind, 'chat')
    assert.equal(book.threadId, threadId)
    const chatRoot = child(me, lorebookRoot.id, CHAT_LOREBOOK_FOLDER)!
    assert.equal(child(me, chatRoot.id, '바다 약속 2 3')?.id, book.folderId, 'the title, made a usable folder name')
    assert.equal(OwnedLorebookStore.addChatBookEntries(threadId, [{ id: 'ring', keys: ['반지'], content: '다른 글' }])!.entries.length, 1, 'same id is not added twice')
    assert.ok(!OwnedLorebookStore.list(me).some((entry) => entry.id === book.id), 'chat books are not listed as account books')
    assert.deepEqual(OwnedLorebookStore.list(me, ['chat']).map((entry) => entry.id), [book.id])
    // Emptied: the book and its folder go.
    assert.equal(OwnedLorebookStore.update(book.id, me, { entries: [] }), null)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId), null)
    assert.equal(child(me, chatRoot.id, '바다 약속 2 3'), null)
  })

  await t.test('pinned memories move into the chat book once', () => {
    const memoriesOf = (id: number) => (db.prepare('SELECT memories FROM codex_chat_threads WHERE id = ?').get(id) as { memories: string | null }).memories
    const threadId = CodexChatStore.createThread(1, '이관', 'llm', profile.id)
    const emptyId = CodexChatStore.createThread(1, '빈 기억', 'llm', profile.id)
    db.prepare('UPDATE codex_chat_threads SET memories = ? WHERE id = ?').run(JSON.stringify([{ id: 'm1', text: '카이는 왼손잡이' }, { id: 'm2', text: '내일 저녁 바다에서 반지를 주기로 했다. 카이는 아직 모른다.' }]), threadId)
    db.prepare("UPDATE codex_chat_threads SET memories = '[]' WHERE id = ?").run(emptyId)
    createUserSettingsSchema(db)
    createUserSettingsSchema(db)
    const book = OwnedLorebookStore.chatBookOf(threadId)!
    assert.deepEqual(book.entries.map((entry) => [entry.id, entry.title, entry.content, entry.constant, entry.keys.length]), [
      ['memory-m1', '카이는 왼손잡이', '카이는 왼손잡이', true, 0],
      ['memory-m2', '내일 저녁 바다에서 반지를 주기로 했', '내일 저녁 바다에서 반지를 주기로 했다. 카이는 아직 모른다.', true, 0],
    ])
    assert.equal(memoriesOf(threadId), null)
    assert.equal(memoriesOf(emptyId), null)
    assert.equal(OwnedLorebookStore.chatBookOf(emptyId), null, 'nothing to move, no book')
    // Cut short after the book was written but before the column was cleared: nothing is added twice.
    db.prepare('UPDATE codex_chat_threads SET memories = ? WHERE id = ?').run(JSON.stringify([{ id: 'm1', text: '카이는 왼손잡이' }]), threadId)
    createUserSettingsSchema(db)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId)!.entries.length, 2)
    assert.equal(memoriesOf(threadId), null)
  })

  await t.test('links: a profile or a chat takes only its owner\'s account books', () => {
    const mine = OwnedLorebookStore.find(bookId, me)!
    const theirs = OwnedLorebookStore.create(other, { name: '남의 책' })
    assert.throws(() => OwnedLorebookStore.linkProfile(profile.id, theirs.id, me), /찾을 수 없어/)
    assert.deepEqual(OwnedLorebookStore.linkProfile(profile.id, mine.id, me), [mine.id])
    assert.deepEqual(ChatProfileStore.find(profile.id)!.lorebookIds, [mine.id])
    // Saving a profile (admin REST): a new account book must be the saver's own; links already there stay.
    assert.throws(() => ChatLorebookStore.assertProfileLinks([mine.id, theirs.id], me, [mine.id]), /다른 계정의 로어북/)
    assert.doesNotThrow(() => ChatLorebookStore.assertProfileLinks([mine.id, theirs.id], other, [mine.id]))
    assert.deepEqual(ChatLorebookStore.existing([mine.id, theirs.id, 9999]), [mine.id, theirs.id])
    // Request building still reads global books only: a shared profile must not carry one account's book to another.
    assert.deepEqual(ChatLorebookStore.keyedEntriesOf([mine.id]), [])
    const threadId = CodexChatStore.createThread(1, '연결', 'llm', profile.id)
    assert.deepEqual(OwnedLorebookStore.setThreadLinks(threadId, [mine.id]), [mine.id])
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [mine.id])
    assert.throws(() => OwnedLorebookStore.setThreadLinks(threadId, [theirs.id]), /내 계정 로어북만/)
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [mine.id])
    // Deleting the book takes its folder and every link with it.
    assert.equal(OwnedLorebookStore.delete(mine.id, me), true)
    assert.equal(child(me, child(me, null, LOREBOOK_ROOT_FOLDER)!.id, '카이'), null)
    assert.deepEqual(ChatProfileStore.find(profile.id)!.lorebookIds, [])
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [])
    assert.throws(() => OwnedLorebookStore.delete(theirs.id, me), /찾을 수 없어/)
  })
})
