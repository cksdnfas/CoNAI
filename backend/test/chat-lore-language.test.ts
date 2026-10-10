import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('lorebook key language and recursive scan', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-lore-language-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-lore-language-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { sortLoreKeysByLanguage, normalizeLoreKeyLanguage } = await import('@conai/shared')
  const { ChatLorebookStore, normalizeLorebook, selectLoreEntries, loreEntryKey } = await import('../src/services/codex-chat/chatLorebook')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { storedFilePath } = await import('../src/services/fileStorePaths')

  await t.test('key language: English is the base, a typed name is kept, keys sort by script', () => {
    assert.equal(normalizeLoreKeyLanguage(' ko '), 'ko')
    assert.equal(normalizeLoreKeyLanguage('English'), null)
    assert.equal(normalizeLoreKeyLanguage(''), null)
    assert.equal(normalizeLoreKeyLanguage('Русский'), 'Русский')
    const mixed = { keys: ['alice', '앨리스', '/ali(ce)?/i'], secondaryKeys: ['rabbit', '토끼'], localKeys: ['엘리스'] }
    assert.deepEqual(sortLoreKeysByLanguage(mixed, 'ko'), { keys: ['alice', '/ali(ce)?/i'], secondaryKeys: ['rabbit'], localKeys: ['엘리스', '앨리스'], localSecondaryKeys: ['토끼'] })
    assert.equal(sortLoreKeysByLanguage(mixed, null), mixed, 'no key language leaves the entry as it is')
    assert.deepEqual(sortLoreKeysByLanguage<{ keys: string[]; localKeys?: string[] }>({ keys: ['alice', 'Алиса'] }, 'Русский').localKeys, ['Алиса'])
    assert.deepEqual(sortLoreKeysByLanguage<{ keys: string[]; localKeys?: string[] }>({ keys: ['alice', 'アリス', '愛麗絲'] }, 'ja').localKeys, ['アリス', '愛麗絲'])
  })

  await t.test('normalize: language keys and SillyTavern recursion flags are kept', () => {
    const [own, tavern, card] = normalizeLorebook([
      { keys: ['alice'], localKeys: ['앨리스'], localSecondaryKeys: ['토끼'], content: 'a', excludeRecursion: true },
      { key: ['queen'], content: 'q', preventRecursion: true, selective: false, localSecondaryKeys: ['ignored'] },
      { keys: ['cat'], content: 'c', extensions: { exclude_recursion: true, prevent_recursion: true } },
    ])
    assert.deepEqual([own.localKeys, own.localSecondaryKeys, own.excludeRecursion, own.preventRecursion], [['앨리스'], ['토끼'], true, undefined])
    assert.deepEqual([tavern.localSecondaryKeys, tavern.excludeRecursion, tavern.preventRecursion], [[], undefined, true], 'secondary keys count only on a selective entry')
    assert.deepEqual([card.excludeRecursion, card.preventRecursion], [true, true])
  })

  const pick = (raw: unknown[], text: string, recursion = 0, budget = 1000) => {
    const entries = normalizeLorebook(raw).map((entry) => ({ key: loreEntryKey(7, entry), entry, bookId: 7, bookKind: 'global' as const }))
    return selectLoreEntries({ lorebookIds: [], loreScanDepth: 4, loreTokenBudget: budget, loreRecursionDepth: recursion }, [{ content: text }], (value) => value.length, (value) => value, { entries })
  }
  const chosen = (result: ReturnType<typeof pick>) => result.decisions.filter((decision) => decision.selected).map((decision) => decision.title).sort()

  await t.test('matching: English and language keys both fire, whichever language the chat is in', () => {
    const book = [{ title: 'Alice', keys: ['alice'], localKeys: ['앨리스'], content: 'Alice is curious.' }]
    assert.deepEqual(chosen(pick(book, '앨리스가 웃었다.')), ['Alice'])
    assert.deepEqual(chosen(pick(book, 'Alice smiled.')), ['Alice'])
    const secondary = [{ title: 'Hatter', keys: ['hatter'], localKeys: ['모자 장수'], localSecondaryKeys: ['차'], secondaryLogic: 'andAny', content: 'Tea party.' }]
    assert.deepEqual(chosen(pick(secondary, '모자 장수가 왔다.')), [], 'a language secondary key is a secondary condition too')
    assert.deepEqual(chosen(pick(secondary, '모자 장수가 차를 따랐다.')), ['Hatter'])
  })

  await t.test('recursive scan: chosen entries pull in the entries their text names, level by level', () => {
    const book = [
      { title: 'Alice', keys: ['alice'], content: 'Alice fell down the rabbit hole.', order: 30 },
      { title: 'Rabbit Hole', keys: ['rabbit hole'], content: 'The hole leads to Wonderland.', order: 20 },
      { title: 'Wonderland', keys: ['wonderland'], content: 'A land of nonsense.', order: 10 },
      { title: 'Queen', keys: ['queen'], content: 'Off with their heads.', order: 0 },
    ]
    assert.deepEqual(chosen(pick(book, 'alice waved')), ['Alice'], 'off by default')
    const one = pick(book, 'alice waved', 1)
    assert.deepEqual(chosen(one), ['Alice', 'Rabbit Hole'])
    const hole = one.decisions.find((decision) => decision.title === 'Rabbit Hole')!
    assert.deepEqual([hole.reason, hole.via, hole.matched], ['recursive', 'Alice', ['rabbit hole']])
    assert.equal(one.unmatched, 2, 'an entry found by recursion no longer counts as unmatched')
    assert.deepEqual(chosen(pick(book, 'alice waved', 2)), ['Alice', 'Rabbit Hole', 'Wonderland'])
    assert.deepEqual(chosen(pick(book, 'alice waved', 5)), ['Alice', 'Rabbit Hole', 'Wonderland'], 'stops when a level adds nothing')

    const excluded = book.map((entry) => entry.title === 'Rabbit Hole' ? { ...entry, excludeRecursion: true } : entry)
    assert.deepEqual(chosen(pick(excluded, 'alice waved', 3)), ['Alice'], 'excludeRecursion: only the chat can name it')
    assert.deepEqual(chosen(pick(excluded, 'alice and the rabbit hole', 3)), ['Alice', 'Rabbit Hole', 'Wonderland'])
    const prevented = book.map((entry) => entry.title === 'Alice' ? { ...entry, preventRecursion: true } : entry)
    assert.deepEqual(chosen(pick(prevented, 'alice waved', 3)), ['Alice'], 'preventRecursion: its text pulls in nothing')
    const budget = pick(book, 'alice waved', 2, 'Alice fell down the rabbit hole.'.length + 'The hole leads to Wonderland.'.length)
    assert.deepEqual(chosen(budget), ['Alice', 'Rabbit Hole'], 'recursive entries share the one budget')
    assert.equal(budget.decisions.find((decision) => decision.title === 'Wonderland')?.reason, 'budget')
    assert.deepEqual(chosen(pick([{ ...book[0], localKeys: ['앨리스'], content: '앨리스는 토끼굴에 빠졌다.' }, { ...book[1], localKeys: ['토끼굴'] }], '앨리스', 1)), ['Alice', 'Rabbit Hole'], 'language keys work in recursion too')
  })

  await t.test('global book: settings are saved, keys sort into the key language on every write', () => {
    const book = ChatLorebookStore.create({ name: 'Wonderland', settings: { keyLanguage: 'ko' }, entries: [{ keys: ['alice', '앨리스'], content: 'a' }] })
    assert.deepEqual(book.settings, { keyLanguage: 'ko' })
    assert.deepEqual([book.entries[0].keys, book.entries[0].localKeys], [['alice'], ['앨리스']])
    const english = ChatLorebookStore.update(book.id, { settings: { keyLanguage: null }, entries: [{ keys: ['cat', '고양이'], content: 'c' }] })!
    assert.deepEqual([english.settings.keyLanguage, english.entries[0].keys, english.entries[0].localKeys], [null, ['cat', '고양이'], []], 'no key language: keys stay where they are')
    const again = ChatLorebookStore.update(book.id, { settings: { keyLanguage: 'ko' } })!
    assert.deepEqual([again.entries[0].keys, again.entries[0].localKeys], [['cat'], ['고양이']], 'choosing a language sorts the existing keys')
    assert.deepEqual(ChatLorebookStore.update(book.id, { name: 'renamed' })!.settings, { keyLanguage: 'ko' }, 'an edit without settings keeps them')
  })

  await t.test('account book: settings live in lorebook.json and come back from it', () => {
    const owner = fileOwnerKey(1)
    const book = OwnedLorebookStore.create(owner, { name: '이상한 나라', settings: { keyLanguage: 'ja' }, entries: [{ keys: ['alice', 'アリス'], content: 'a' }] })
    assert.deepEqual([book.settings, book.entries[0].localKeys], [{ keyLanguage: 'ja' }, ['アリス']])
    const file = FileStoreService.findChild(owner, book.folderId, 'lorebook.json')!
    const json = JSON.parse(fs.readFileSync(storedFilePath(owner, file.id), 'utf8'))
    assert.deepEqual(json.settings, { keyLanguage: 'ja' })
    // Someone edits the file by hand: the cache follows it.
    FileStoreService.writeText(owner, book.folderId as string, 'lorebook.json', JSON.stringify({ ...json, settings: { keyLanguage: 'ko' } }))
    assert.deepEqual(OwnedLorebookStore.list(owner).find((item) => item.id === book.id)?.settings, { keyLanguage: 'ko' })
    const updated = OwnedLorebookStore.update(book.id, owner, { entries: [{ keys: ['cat', '고양이'], content: 'c' }] })!
    assert.deepEqual([updated.settings.keyLanguage, updated.entries[0].localKeys], ['ko', ['고양이']])
  })

  await t.test('profile: recursion depth is saved within 0-5', () => {
    ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn', loreRecursionDepth: 9 })
    assert.equal(profile.loreRecursionDepth, 5)
    assert.equal(ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'conn' }).loreRecursionDepth, 0)
  })
})
