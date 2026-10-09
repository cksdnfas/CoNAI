import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('file store search: names and text, phrases, HTML text, cache refresh, owner isolation', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-file-search-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  // A broken search.db (derived data) is recreated instead of failing startup.
  fs.mkdirSync(path.join(root, 'database'), { recursive: true })
  fs.writeFileSync(path.join(root, 'database', 'search.db'), 'not a database'.repeat(100))
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-file-search-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { searchStoredFiles, parseSearchTerms, htmlToText } = await import('../src/services/fileStoreSearch')

  const me = fileOwnerKey(1)
  const other = fileOwnerKey(2)
  const docs = FileStoreService.createFolder(me, null, '설정 문서')
  const world = FileStoreService.writeText(me, docs.id, '세계관.md', '# 세계관\n\n주인공의 캐릭터 설정은 다음과 같다.\n항구 도시에 산다.')
  const notes = FileStoreService.writeText(me, null, 'notes.html', '<html><head><style>.캐릭터 { color: red }</style><script>var 비밀 = 1</script></head><body><p>캐릭터&nbsp;설정 &amp; 초안</p><!-- 숨김 --></body></html>')
  FileStoreService.writeText(me, null, 'Readme.TXT', 'Hello World')
  FileStoreService.writeText(other, null, '남의 파일.md', '캐릭터 설정 비밀')
  const names = async (query: string, owner = me) => (await searchStoredFiles(owner, query)).hits.map((hit) => hit.entry.name).sort()

  await t.test('terms: words are all required, quotes keep a phrase, Latin letters fold', () => {
    assert.deepEqual(parseSearchTerms(' 캐릭터  "설정 초안" Hello '), ['캐릭터', '설정 초안', 'hello'])
    assert.throws(() => parseSearchTerms('   '), /검색어/)
    assert.throws(() => parseSearchTerms('a b c d e f g h i'), /8개/)
  })

  await t.test('HTML is searched as its visible text', () => {
    assert.equal(htmlToText('<p>A&lt;B</p><script>x()</script><style>p{}</style>&#54620;&#xAE00;'), 'A<B 한글')
  })

  await t.test('finds documents by words in their text, with path and excerpt', async () => {
    assert.deepEqual(await names('캐릭터 설정'), ['notes.html', '세계관.md'])
    const result = await searchStoredFiles(me, '항구')
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0].path, '/설정 문서')
    assert.match(result.hits[0].snippet ?? '', /항구 도시에 산다/)
    assert.equal(result.truncated, false)
  })

  await t.test('a quoted phrase must appear as written; scripts, styles and comments are not text', async () => {
    assert.deepEqual(await names('"설정 & 초안"'), ['notes.html'])
    assert.deepEqual(await names('"초안 & 설정"'), [])
    assert.deepEqual(await names('비밀'), [])
    assert.deepEqual(await names('숨김'), [])
  })

  await t.test('names match too, case-insensitively, and folders are found by name', async () => {
    assert.deepEqual(await names('readme'), ['Readme.TXT'])
    assert.deepEqual(await names('WORLD'), ['Readme.TXT'])
    const hit = (await searchStoredFiles(me, '설정 문서')).hits.find((entry) => entry.entry.kind === 'folder')
    assert.equal(hit?.entry.id, docs.id)
    assert.equal(hit?.snippet, null)
  })

  await t.test("another account's files never show up", async () => {
    assert.deepEqual(await names('남의'), [])
    assert.deepEqual(await names('비밀', other), ['남의 파일.md'])
  })

  await t.test('rewrites, renames and deletes refresh the cache', async () => {
    FileStoreService.writeText(me, docs.id, '세계관.md', '# 세계관\n\n등대지기가 산다.')
    assert.deepEqual(await names('항구'), [])
    assert.deepEqual(await names('등대지기'), ['세계관.md'])
    // Renamed to a non-text extension: the text is no longer searchable.
    FileStoreService.rename(me, notes.id, 'notes.bin', true)
    assert.deepEqual(await names('초안'), [])
    FileStoreService.delete(me, [world.id])
    assert.deepEqual(await names('등대지기'), [])
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM search_db.search_documents WHERE source = 'file' AND source_id = ?").get(world.id) as { count: number }).count, 0)
  })
})
