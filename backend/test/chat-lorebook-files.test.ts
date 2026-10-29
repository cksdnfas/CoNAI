import './support/testTemp'
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
    // Account books live in the shared file store: every account sees and uses them.
    assert.deepEqual(OwnedLorebookStore.list(me).map((entry) => entry.id), [book.id])
    assert.deepEqual(OwnedLorebookStore.list(other).map((entry) => entry.id), [book.id])
    assert.equal(OwnedLorebookStore.find(book.id, other)?.id, book.id)
  })

  await t.test('lorebook.json edited outside the app: the hook and the startup pass bring the cache along', () => {
    const book = OwnedLorebookStore.find(bookId, me)!
    // Through the file store (the file page): the change hook re-reads it.
    FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({ name: '카이', entries: [{ keys: ['집'], content: '항구 근처 2층 집.' }] }))
    assert.deepEqual(cached(bookId).map((entry) => entry.content), ['항구 근처 2층 집.'])
    const hookedJson = child(me, book.folderId, 'lorebook.json')!
    assert.equal(JSON.parse(readBlob(me, hookedJson.id)).entries[0].id, cached(bookId)[0].id, 'file-tool writes persist the assigned ID in the source file')
    // Straight on disk while the app was down: the startup pass re-reads every book.
    const json = child(me, book.folderId, 'lorebook.json')!
    fs.writeFileSync(storedFilePath(me, json.id), JSON.stringify([{ keys: ['수리점'], content: '1층은 수리점.' }, { keys: ['집'], content: '항구 근처 2층 집.' }]))
    const result = reconcileLorebookFolders()
    assert.equal(result.refreshed, 1)
    assert.deepEqual(cached(bookId).map((entry) => entry.content), ['1층은 수리점.', '항구 근처 2층 집.'])
    const stamped = JSON.parse(readBlob(me, json.id)) as Array<{ id: string }>
    assert.deepEqual(stamped.map((entry) => entry.id), cached(bookId).map((entry) => entry.id), 'startup stamps bare-array source files')
    const stable = OwnedLorebookStore.find(bookId, me)!
    const bytes = readBlob(me, json.id)
    for (let n = 0; n < 3; n++) assert.deepEqual(OwnedLorebookStore.find(bookId, me), stable)
    reconcileLorebookFolders()
    assert.equal(OwnedLorebookStore.find(bookId, me)!.revision, stable.revision, 'unchanged reads and startup passes do not write')
    assert.equal(readBlob(me, json.id), bytes)
    FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({
      custom: { keep: true },
      entries: { first: stable.entries[0], second: { ...stable.entries[1], id: stable.entries[0].id, customEntry: 'keep' } },
    }))
    const repaired = JSON.parse(readBlob(me, json.id))
    assert.deepEqual(repaired.custom, { keep: true })
    assert.equal(repaired.entries.second.customEntry, 'keep')
    assert.equal(repaired.entries.first.id, stable.entries[0].id)
    assert.notEqual(repaired.entries.second.id, repaired.entries.first.id)
    assert.deepEqual(cached(bookId).map((entry) => entry.id), [repaired.entries.first.id, repaired.entries.second.id])
    const deletedId = repaired.entries.second.id
    OwnedLorebookStore.update(bookId, me, { entries: [stable.entries[0]] })
    FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({ entries: [stable.entries[0], { content: 'B without ID' }] }))
    assert.notEqual(cached(bookId)[1].id, deletedId)
    assert.equal(JSON.parse(readBlob(me, json.id)).entries[1].id, cached(bookId)[1].id)
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

  await t.test('summary counts preserve stale-file refresh, identities, revisions and malformed-cache behavior', () => {
    const book = OwnedLorebookStore.create(me, { name: 'Summary refresh', entries: [{ title: 'A', content: 'original' }] })
    const json = child(me, book.folderId, 'lorebook.json')!
    fs.writeFileSync(storedFilePath(me, json.id), JSON.stringify({ entries: [{ id: book.entries[0].id, title: 'A', content: 'updated' }, { title: 'B', content: 'new' }] }))
    const summary = OwnedLorebookStore.listSummary(me).find((item) => item.id === book.id)!
    const refreshed = OwnedLorebookStore.requireOwn(book.id, me)
    const { entries, ...rest } = refreshed
    assert.deepEqual(summary, { ...rest, entryCount: entries.length })
    assert.notEqual(summary.revision, book.revision)
    assert.equal(entries[0].id, book.entries[0].id)
    assert.equal(JSON.parse(readBlob(me, json.id)).entries[1].id, entries[1].id)

    const global = ChatLorebookStore.create({ name: 'Summary malformed' })
    for (const raw of ['{ broken', JSON.stringify({ entries: [] }), JSON.stringify([null, [], 1, {}, ...Array.from({ length: 500 }, () => ({}))])]) {
      db.prepare('UPDATE chat_lorebooks SET entries = ? WHERE id = ?').run(raw, global.id)
      const expected = ChatLorebookStore.find(global.id)!
      const { entries: normalized, ...metadata } = expected
      assert.deepEqual(ChatLorebookStore.listSummary().find((item) => item.id === global.id), { ...metadata, entryCount: normalized.length })
    }
    ChatLorebookStore.delete(global.id)
    OwnedLorebookStore.delete(book.id, me)
  })

  await t.test('permanent entry identities survive writes, imports, deletions, duplicate IDs and database migration', async () => {
    const { readLorebookFile } = await import('../src/services/codex-chat/chatCardImport')
    const imported = readLorebookFile(Buffer.from(JSON.stringify({ entries: [{ content: 'A' }, { content: 'B' }] })), 'ids.json')
    const book = ChatLorebookStore.create(imported)
    assert.deepEqual(book.entries.map((entry) => entry.id), imported.entries.map((entry) => entry.id))
    const oldIds = new Set(book.entries.map((entry) => entry.id))
    const afterDelete = ChatLorebookStore.update(book.id, { entries: [book.entries[1]] })!
    assert.equal(afterDelete.entries[0].id, book.entries[1].id)
    const resent = ChatLorebookStore.update(book.id, { entries: [{ content: 'B without its ID' }] })!
    assert.ok(!oldIds.has(resent.entries[0].id), 'id-less replacement cannot inherit a deleted positional identity')
    const duplicate = ChatLorebookStore.update(book.id, { entries: [{ id: 'lore-0-0', content: 'legacy' }, { id: 'lore-0-0', content: 'duplicate' }] })!
    assert.equal(duplicate.entries[0].id, 'lore-0-0')
    assert.notEqual(duplicate.entries[1].id, 'lore-0-0')
    assert.deepEqual(ChatLorebookStore.find(book.id), duplicate)
    const again = ChatLorebookStore.update(book.id, { entries: [{ id: 'lore-0-0', content: 'legacy' }, { id: 'lore-0-0', content: 'new duplicate' }] })!
    assert.notEqual(again.entries[1].id, duplicate.entries[1].id)

    const { migrateLoreEntryIds } = await import('../src/services/codex-chat/chatLorebookIds')
    const broken = ChatLorebookStore.create({ name: 'Malformed stored JSON' })
    db.prepare('UPDATE chat_lorebooks SET entries = ? WHERE id = ?').run('{ not json', broken.id)
    db.prepare('UPDATE chat_lorebooks SET entries = ? WHERE id = ?').run(JSON.stringify([{ id: 'lore-0-0', content: 'old' }, { content: 'missing', custom: 'preserve' }]), book.id)
    db.prepare("DELETE FROM chat_settings_migrations WHERE name = 'permanent_lore_entry_ids_v1'").run()
    assert.doesNotThrow(() => createUserSettingsSchema(db), 'malformed lore JSON must not prevent startup')
    assert.deepEqual(ChatLorebookStore.find(broken.id)!.entries, [])
    assert.equal((db.prepare('SELECT entries FROM chat_lorebooks WHERE id = ?').get(broken.id) as { entries: string }).entries, '{ not json')
    const migrated = ChatLorebookStore.find(book.id)!
    assert.equal(migrated.entries[0].id, 'lore-0-0')
    assert.ok(migrated.entries[1].id)
    const raw = JSON.parse((db.prepare('SELECT entries FROM chat_lorebooks WHERE id = ?').get(book.id) as { entries: string }).entries)
    assert.equal(raw[1].custom, 'preserve')
    assert.equal(raw[1].id, migrated.entries[1].id)
    migrateLoreEntryIds(db)
    assert.deepEqual(ChatLorebookStore.find(book.id), migrated, 'migration is durable and runs once')
  })

  await t.test('missing account/chat JSON blobs preserve the cache and ordinary saves repair them', () => {
    const threadId = CodexChatStore.createThread(1, 'Missing blob', 'llm', profile.id)
    for (const book of [
      OwnedLorebookStore.create(me, { name: 'Missing blob', entries: [{ title: 'A', content: 'cached' }] }),
      OwnedLorebookStore.saveChatBook(threadId, [{ title: 'A', content: 'cached' }])!,
    ]) {
      const json = child(me, book.folderId, 'lorebook.json')!
      fs.unlinkSync(storedFilePath(me, json.id))
      assert.deepEqual(OwnedLorebookStore.find(book.id, me)!.entries, book.entries)
      assert.ok(OwnedLorebookStore.list(me, ['account', 'chat']).some((entry) => entry.id === book.id))
      if (book.kind === 'chat') assert.deepEqual(OwnedLorebookStore.chatBookOf(threadId)!.entries, book.entries)
      const saved = OwnedLorebookStore.update(book.id, me, { entries: book.entries })!
      assert.deepEqual(JSON.parse(readBlob(me, json.id)).entries, saved.entries)
      OwnedLorebookStore.delete(book.id, me)
    }
  })

  await t.test('id-less replacements claim identical entries once, preserve cached legacy IDs, and normalize explicit IDs', async () => {
    const { readLorebookFile } = await import('../src/services/codex-chat/chatCardImport')
    const base = normalizeLorebook([
      { id: 'lore-0-0', title: 'A', content: 'same' },
      { id: 'lore-1-1', title: 'A', content: 'same' },
      { id: 'lore-2-2', title: 'B', content: 'other' },
    ])
    const raw = [{ comment: ' A ', text: ' same ' }, { title: 'A', content: 'same' }, { title: 'B', content: 'other' }]
    const global = ChatLorebookStore.create({ name: 'Replacement identities', entries: base })
    const updated = ChatLorebookStore.update(global.id, { entries: raw })!
    assert.deepEqual(updated.entries.map((entry) => entry.id), base.map((entry) => entry.id))
    const imported = readLorebookFile(Buffer.from(JSON.stringify({ entries: raw })), 'same.json', updated.entries)
    const reimported = ChatLorebookStore.update(global.id, { entries: imported.entries })!
    assert.deepEqual(reimported.entries, updated.entries)
    const mixed = normalizeLorebook([{ title: 'A', content: 'same' }, { ...base[0], id: ' lore-0-0 ' }, { title: 'A', content: 'same' }], base)
    assert.deepEqual(mixed.slice(0, 2).map((entry) => entry.id), ['lore-1-1', 'lore-0-0'])
    assert.ok(!base.some((entry) => entry.id === mixed[2].id), 'each matching ID is claimed at most once')
    const changed = normalizeLorebook([{ title: 'A changed', content: 'same' }, { title: 'A', content: 'changed' }], base)
    assert.ok(changed.every((entry) => !base.some((previous) => previous.id === entry.id)))
    const normalized = normalizeLorebook([{ id: 'kai ', content: 'x' }, { id: 'kai', content: 'y' }, { id: 'x'.repeat(100), content: 'z' }])
    assert.equal(normalized[0].id, 'kai')
    assert.notEqual(normalized[1].id, 'kai')
    assert.equal(normalized[2].id, 'x'.repeat(80))
    const threadId = CodexChatStore.createThread(1, 'Legacy cached IDs', 'llm', profile.id)
    for (const book of [
      OwnedLorebookStore.create(me, { name: 'Legacy cached IDs', entries: base }),
      OwnedLorebookStore.saveChatBook(threadId, base)!,
    ]) {
      const json = child(me, book.folderId, 'lorebook.json')!
      fs.writeFileSync(storedFilePath(me, json.id), JSON.stringify({ entries: raw }))
      const refreshed = OwnedLorebookStore.find(book.id, me)!
      assert.deepEqual(refreshed.entries.map((entry) => entry.id), base.map((entry) => entry.id))
      assert.deepEqual(JSON.parse(readBlob(me, json.id)).entries.map((entry: { id: string }) => entry.id), base.map((entry) => entry.id))
      const saved = book.kind === 'chat' ? OwnedLorebookStore.saveChatBook(threadId, raw)! : OwnedLorebookStore.update(book.id, me, { entries: raw })!
      assert.deepEqual(saved.entries.map((entry) => entry.id), base.map((entry) => entry.id))
      FileStoreService.writeText(me, book.folderId, 'lorebook.json', JSON.stringify({ entries: [{ id: 'kai ', content: 'x' }, { id: 'x'.repeat(100), content: 'y' }] }))
      assert.deepEqual(JSON.parse(readBlob(me, json.id)).entries.map((entry: { id: string }) => entry.id), ['kai', 'x'.repeat(80)], 'normalized IDs are persisted to source files')
      OwnedLorebookStore.delete(book.id, me)
    }
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
    const existingChatRoot = child(me, lorebookRoot.id, CHAT_LOREBOOK_FOLDER)!
    assert.equal(child(me, existingChatRoot.id, '바다 약속 2 3'), null, 'no entries, no folder for this chat (other tests already created the shared chat root)')
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

  await t.test('links: a profile or a chat takes any account\'s account books, never a chat book', () => {
    const mine = OwnedLorebookStore.find(bookId, me)!
    const theirs = OwnedLorebookStore.create(other, { name: '남의 책' })
    assert.deepEqual(OwnedLorebookStore.linkProfile(profile.id, mine.id, me), [mine.id])
    assert.deepEqual(OwnedLorebookStore.linkProfile(profile.id, theirs.id, me), [mine.id, theirs.id])
    assert.deepEqual(ChatProfileStore.find(profile.id)!.lorebookIds, [mine.id, theirs.id])
    assert.deepEqual(ChatLorebookStore.existing([mine.id, theirs.id, 9999]), [mine.id, theirs.id])
    // Without a chat (a prompt preview), request building reads global books only.
    assert.deepEqual(ChatLorebookStore.keyedEntriesOf([mine.id]), [])
    const threadId = CodexChatStore.createThread(1, '연결', 'llm', profile.id)
    assert.deepEqual(OwnedLorebookStore.setThreadLinks(threadId, [mine.id, theirs.id]), [mine.id, theirs.id])
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [mine.id, theirs.id])
    // Another account's chat book is not shared: not found, not listed, not linkable.
    const theirChat = CodexChatStore.createThread(2, '남의 채팅', 'llm', profile.id)
    const theirChatBook = OwnedLorebookStore.saveChatBook(theirChat, [{ keys: ['비밀'], content: '남의 채팅 기록' }])!
    assert.equal(OwnedLorebookStore.find(theirChatBook.id, me), null)
    assert.equal(OwnedLorebookStore.list(me, ['chat']).some((book) => book.id === theirChatBook.id), false)
    assert.throws(() => OwnedLorebookStore.setThreadLinks(threadId, [theirChatBook.id]), /계정 로어북만/)
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [mine.id, theirs.id])
    // Deleting the book takes its folder and every link with it; any account may delete a shared book.
    assert.equal(OwnedLorebookStore.delete(mine.id, me), true)
    assert.equal(child(me, child(me, null, LOREBOOK_ROOT_FOLDER)!.id, '카이'), null)
    assert.deepEqual(ChatProfileStore.find(profile.id)!.lorebookIds, [theirs.id])
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [theirs.id])
    assert.equal(OwnedLorebookStore.delete(theirs.id, me), true)
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [])
  })

  await t.test('reading text from an offset inside a character starts on the next one and ends on a whole one', async () => {
    const file = FileStoreService.writeText(me, null, '한글.md', '가나다라마바')
    const inside = await FileStoreService.readText(me, file.id, 1, 8)
    assert.deepEqual([inside.offset, inside.text, inside.nextOffset, inside.size], [3, '나다', 9, 18])
    const next = await FileStoreService.readText(me, file.id, 9, 4)
    assert.deepEqual([next.offset, next.text, next.nextOffset], [9, '라', 12])
    // Too narrow for a character after the skip: no text, but the next offset still moves to a boundary.
    const narrow = await FileStoreService.readText(me, file.id, 1, 4)
    assert.deepEqual([narrow.offset, narrow.text, narrow.nextOffset], [3, '', 3])
    const tail = await FileStoreService.readText(me, file.id, 17, 100)
    assert.deepEqual([tail.offset, tail.text, tail.nextOffset], [18, '', null])
    await assert.rejects(FileStoreService.readText(me, file.id, 19, 100), /잘못된 읽기 범위야 \(파일 크기 18바이트\)/)
  })
  await t.test('a shared folder adopted by another writer survives startup reconciliation', () => {
    const root = FileStoreService.ensureFolder(me, null, LOREBOOK_ROOT_FOLDER)
    const folder = FileStoreService.createFolder(me, root.id, '공용 폴더 등록')
    FileStoreService.writeText(other, folder.id, 'lorebook.json', JSON.stringify({ name: '공용 폴더 등록', entries: [{ keys: ['공유'], content: '유지할 내용' }] }))
    const book = OwnedLorebookStore.list(other).find(item => item.folderId === folder.id)
    assert.ok(book, 'the account that writes the lorebook manages its registration')
    reconcileLorebookFolders()
    assert.ok(OwnedLorebookStore.find(book.id, other), 'an existing shared folder must not be mistaken for a deleted one')
    assert.ok(OwnedLorebookStore.find(book.id, me), 'account books are shared like the folder they live in')
  })

  await t.test('startup discovers another creator under the shared lorebook root', () => {
    const root = FileStoreService.ensureFolder(me, null, LOREBOOK_ROOT_FOLDER)
    const folder = FileStoreService.createFolder(other, root.id, '재시작 때 등록')
    FileStoreService.writeText(other, folder.id, 'lorebook.json', JSON.stringify({ entries: [] }), { silent: true })
    assert.equal(OwnedLorebookStore.list(other).some(item => item.folderId === folder.id), false)
    reconcileLorebookFolders()
    assert.ok(OwnedLorebookStore.list(other).some(item => item.folderId === folder.id))
    assert.ok(OwnedLorebookStore.list(me).some(item => item.folderId === folder.id))
  })

})
