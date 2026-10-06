import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('chat flags: admin flags shared, each account keeps its own copy', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-flags-'))
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
    assert.ok(path.basename(root).startsWith('conai-chat-flags-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatFlagStore } = await import('../src/services/codex-chat/chatFlags')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const admin = { accountId: 1, accountType: 'admin' as const }
  const guest = { accountId: 2, accountType: 'guest' as const }
  const other = { accountId: 3, accountType: 'guest' as const }
  const names = (viewer: typeof admin | typeof guest, options?: { includeHidden?: boolean }) => ChatFlagStore.list(viewer, options).map((flag) => flag.name)

  await t.test('an admin flag reaches every account; a guest flag stays its own', () => {
    const scene = ChatFlagStore.create(admin, { icon: '', name: '장면', content: '장면을 그려줘.' })
    assert.equal(scene.shared, true)
    const mine = ChatFlagStore.create(guest, { icon: '', name: '짧게', content: '짧게 말해.' })
    assert.equal(mine.shared, false)
    assert.deepEqual(names(guest), ['장면', '짧게'])
    assert.deepEqual(names(other), ['장면'])
    assert.deepEqual(names(admin), ['장면'], 'an admin does not see other accounts’ own flags')
    assert.throws(() => ChatFlagStore.update(other, mine.id, { icon: '', name: 'x', content: 'x' }), /찾을 수 없어/)
  })

  await t.test('a guest edit is a private copy; the admin’s later edits reach everyone else', () => {
    const scene = ChatFlagStore.list(admin)[0]
    const edited = ChatFlagStore.update(guest, scene.id, { icon: '', name: '장면', content: '내 방식으로 그려줘.' })
    assert.equal(edited.edited, true)
    assert.equal(edited.content, '내 방식으로 그려줘.')
    ChatFlagStore.update(admin, scene.id, { icon: '', name: '장면', content: '장면을 크게 그려줘.' })
    assert.equal(ChatFlagStore.list(other)[0].content, '장면을 크게 그려줘.')
    assert.equal(ChatFlagStore.list(guest)[0].content, '내 방식으로 그려줘.', 'the copy is kept')
    assert.deepEqual(ChatFlagStore.resolve(guest, [scene.id]).map((flag) => flag.content), ['내 방식으로 그려줘.'], 'messages carry the copy')
    const reset = ChatFlagStore.reset(guest, scene.id)
    assert.equal(reset.edited, false)
    assert.equal(reset.content, '장면을 크게 그려줘.')
  })

  await t.test('a guest delete only hides the shared flag for them, until restored', () => {
    const scene = ChatFlagStore.list(admin)[0]
    ChatFlagStore.delete(guest, scene.id)
    assert.deepEqual(names(guest), ['짧게'])
    assert.deepEqual(names(guest, { includeHidden: true }), ['장면', '짧게'])
    assert.deepEqual(ChatFlagStore.resolve(guest, [scene.id]), [], 'a hidden flag is not sent')
    assert.deepEqual(names(other), ['장면'])
    assert.equal(ChatFlagStore.restore(guest, scene.id).hidden, false)
    assert.deepEqual(names(guest), ['장면', '짧게'])
  })

  await t.test('order is per account; an admin delete removes the flag and every copy', () => {
    const [scene, mine] = ChatFlagStore.list(guest)
    assert.deepEqual(ChatFlagStore.reorder(guest, [mine.id, scene.id]).map((flag) => flag.name), ['짧게', '장면'])
    assert.deepEqual(names(other), ['장면'])
    ChatFlagStore.update(other, scene.id, { icon: '', name: '장면', content: '다르게.' })
    ChatFlagStore.delete(admin, scene.id)
    assert.deepEqual(names(guest, { includeHidden: true }), ['짧게'])
    assert.deepEqual(names(other, { includeHidden: true }), [])
  })

  await t.test('flags written before sharing: the admin’s become shared on first read', () => {
    const db = dbModule.getUserSettingsDb()
    const insert = db.prepare('INSERT INTO chat_flags (account_id, icon, name, content, sort_order) VALUES (?, ?, ?, ?, 0)')
    insert.run(null, '', '개인 모드', '개인 모드 플래그.')
    insert.run(7, '', '옛 관리자', '관리자 플래그.')
    insert.run(8, '', '옛 게스트', '게스트 플래그.')
    t.mock.method(AuthAccount, 'findByIds', (ids: number[]) => ids.map((id) => ({ id, account_type: id === 7 ? 'admin' : 'guest' })))
    assert.deepEqual(names(other).sort(), ['개인 모드', '옛 관리자'].sort())
    assert.deepEqual(names({ accountId: 8, accountType: 'guest' }).sort(), ['개인 모드', '옛 게스트', '옛 관리자'].sort())
  })
})
