import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('file store text documents: create refuses taken names, update keeps the id and follows the file', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-file-text-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-file-text-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const me = fileOwnerKey(1)
  const read = async (id: string) => (await FileStoreService.readText(me, id, 0, 32000)).text

  const note = FileStoreService.writeText(me, null, '메모.md', '# 처음', { create: true })
  assert.equal(note.mimeType, 'text/markdown')
  assert.equal(await read(note.id), '# 처음')

  await t.test('create refuses a taken name (case-insensitive) and non-text extensions', () => {
    assert.throws(() => FileStoreService.writeText(me, null, '메모.MD', 'x', { create: true }), /같은 이름/)
    assert.throws(() => FileStoreService.writeText(me, null, '그림.png', 'x', { create: true }), /텍스트 파일만/)
  })

  await t.test('update replaces the text in place', async () => {
    const saved = FileStoreService.updateText(me, note.id, '# 고침\n\n한글 본문')
    assert.equal(saved.id, note.id)
    assert.equal(saved.size, Buffer.byteLength('# 고침\n\n한글 본문'))
    assert.equal(await read(note.id), '# 고침\n\n한글 본문')
  })

  await t.test('update follows a renamed or moved file', async () => {
    const folder = FileStoreService.createFolder(me, null, '보관')
    FileStoreService.rename(me, note.id, '노트.txt')
    FileStoreService.move(me, [note.id], folder.id)
    const saved = FileStoreService.updateText(me, note.id, '옮긴 뒤')
    assert.equal(saved.id, note.id)
    assert.equal(saved.parentId, folder.id)
    assert.equal(saved.mimeType, 'text/plain')
    assert.equal(FileStoreService.list(me, null).entries.filter((entry) => entry.kind === 'file').length, 0)
    assert.equal(await read(note.id), '옮긴 뒤')
  })

  await t.test('update refuses folders and other owners', () => {
    const folder = FileStoreService.ensureFolder(me, null, '보관')
    assert.throws(() => FileStoreService.updateText(me, folder.id, 'x'), /파일을 선택/)
    assert.throws(() => FileStoreService.updateText(fileOwnerKey(2), note.id, 'x'), /찾을 수 없어/)
  })
})
