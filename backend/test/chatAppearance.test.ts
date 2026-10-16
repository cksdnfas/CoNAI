import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-appearance-'))
process.env.RUNTIME_BASE_PATH = root
process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
let ChatAppearanceStore: typeof import('../src/services/codex-chat/chatAppearance').ChatAppearanceStore
let ChatAppearanceError: typeof import('../src/services/codex-chat/chatAppearance').ChatAppearanceError
let CHAT_APPEARANCE_LIMITS: typeof import('../src/services/codex-chat/chatAppearance').CHAT_APPEARANCE_LIMITS
let dbModule: typeof import('../src/database/userSettingsDb')
before(async () => {
  dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;({ ChatAppearanceStore, ChatAppearanceError, CHAT_APPEARANCE_LIMITS } = await import('../src/services/codex-chat/chatAppearance'))
})
after(async () => {
  dbModule.closeUserSettingsDb()
  await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('an account without a file starts empty', () => {
  assert.deepEqual(ChatAppearanceStore.read(1), { defaultSlotId: null, slots: [], threads: {} })
})

test('slots are saved whole; new ones get the next free id; the default must exist', () => {
  const saved = ChatAppearanceStore.saveSlots(1, { defaultSlotId: null, slots: [{ id: 0, name: '저장1', appearance: { fontSize: 'lg', showBackground: false } }, { name: '저장2', appearance: { fontSize: 'sm' } }] })
  assert.deepEqual(saved.slots.map((slot) => slot.id), [1, 2])
  assert.deepEqual(saved.slots[0].appearance, { fontSize: 'lg', showBackground: false })
  assert.throws(() => ChatAppearanceStore.saveSlots(1, { defaultSlotId: 9, slots: saved.slots }), ChatAppearanceError)
  const withDefault = ChatAppearanceStore.saveSlots(1, { defaultSlotId: 1, slots: saved.slots })
  assert.equal(withDefault.defaultSlotId, 1)
  assert.equal(ChatAppearanceStore.read(1).defaultSlotId, 1)
})

test('a new chat copies the default slot; the slot can change later without touching the chat', () => {
  ChatAppearanceStore.threadCreated(1, 42)
  assert.deepEqual(ChatAppearanceStore.threadAppearance(1, 42), { fontSize: 'lg', showBackground: false })
  const file = ChatAppearanceStore.read(1)
  ChatAppearanceStore.saveSlots(1, { defaultSlotId: 1, slots: file.slots.map((slot) => (slot.id === 1 ? { ...slot, appearance: { fontSize: 'xl' } } : slot)) })
  assert.deepEqual(ChatAppearanceStore.threadAppearance(1, 42), { fontSize: 'lg', showBackground: false })
})

test('a chat keeps only flat scalars; null clears it; deleting the chat drops its entry', () => {
  ChatAppearanceStore.setThread(1, 43, { avatarSize: 'sm', nested: { a: 1 }, list: [1], slotId: null })
  assert.deepEqual(ChatAppearanceStore.threadAppearance(1, 43), { avatarSize: 'sm', slotId: null })
  assert.throws(() => ChatAppearanceStore.setThread(1, 43, 'nope'), ChatAppearanceError)
  ChatAppearanceStore.setThread(1, 43, null)
  assert.equal(ChatAppearanceStore.threadAppearance(1, 43), null)
  ChatAppearanceStore.threadDeleted(1, 42)
  assert.equal(ChatAppearanceStore.threadAppearance(1, 42), null)
})

test('reading with the live chat ids prunes entries of chats that are gone', () => {
  ChatAppearanceStore.setThread(1, 50, { fontSize: 'sm' })
  ChatAppearanceStore.setThread(1, 51, { fontSize: 'md' })
  const pruned = ChatAppearanceStore.read(1, [51])
  assert.deepEqual(Object.keys(pruned.threads), ['51'])
})

test('legacy files migrate once without overwriting newer values or altering their source', () => {
  const dir = path.join(process.env.RUNTIME_SAVE_DIR as string, 'chat-appearance')
  fs.mkdirSync(dir, { recursive: true })
  const legacy = { defaultSlotId: 1, slots: [{ id: 1, name: '이전 설정', appearance: { fontSize: 'sm' } }], threads: { '42': { fontSize: 'xl' } } }
  const source = JSON.stringify(legacy)
  fs.writeFileSync(path.join(dir, 'guest.json'), source)
  assert.deepEqual(ChatAppearanceStore.read(null), legacy)
  ChatAppearanceStore.setThread(null, 42, { fontSize: 'md' })
  assert.deepEqual(ChatAppearanceStore.threadAppearance(null, 42), { fontSize: 'md' })
  assert.deepEqual(ChatAppearanceStore.threadAppearance(1, 42), null, 'accounts do not share appearance rows')
  assert.equal(fs.readFileSync(path.join(dir, 'guest.json'), 'utf8'), source, 'the original file is preserved')
  assert.equal(fs.existsSync(path.join(dir, '1.json')), false, 'new edits do not create account files')
  dbModule.closeUserSettingsDb()
  dbModule.initializeUserSettingsDb()
  assert.deepEqual(ChatAppearanceStore.threadAppearance(null, 42), { fontSize: 'md' }, 'reopening the database never reimports the old file')
})

test('an unreadable legacy file never commits an empty migration marker', () => {
  const file = path.join(process.env.RUNTIME_SAVE_DIR as string, 'chat-appearance', '3.json')
  fs.writeFileSync(file, '{not json')
  assert.throws(() => ChatAppearanceStore.setThread(3, 42, {}), ChatAppearanceError)
  assert.equal(dbModule.getUserSettingsDb().prepare('SELECT 1 FROM user_preferences WHERE key = ?').get('chat_appearance:3:slots'), undefined)
  fs.writeFileSync(file, JSON.stringify({ slots: [], threads: { '42': { fontSize: 'lg' } } }))
  assert.deepEqual(ChatAppearanceStore.threadAppearance(3, 42), { fontSize: 'lg' }, 'repair can retry the complete migration')
})

test('a failed legacy import rolls back the marker and every thread before retrying', () => {
  const file = path.join(process.env.RUNTIME_SAVE_DIR as string, 'chat-appearance', '5.json')
  const legacy = { defaultSlotId: null, slots: [], threads: { '1': { fontSize: 'sm' }, '2': { fontSize: 'lg' } } }
  fs.writeFileSync(file, JSON.stringify(legacy))
  const db = dbModule.getUserSettingsDb()
  db.exec(`CREATE TEMP TRIGGER fail_appearance_import BEFORE INSERT ON user_preferences
    WHEN NEW.key = 'chat_appearance:5:thread:2' BEGIN SELECT RAISE(ABORT, 'test import failure'); END`)
  try {
    assert.throws(() => ChatAppearanceStore.read(5), /test import failure/)
    assert.deepEqual(db.prepare("SELECT key FROM user_preferences WHERE key GLOB 'chat_appearance:5:*'").all(), [])
  } finally { db.exec('DROP TRIGGER fail_appearance_import') }
  assert.deepEqual(ChatAppearanceStore.read(5), legacy)
})

test('editing a chat writes one row and preserves changes from another database connection', (t) => {
  const db = dbModule.getUserSettingsDb()
  ChatAppearanceStore.read(4)
  db.transaction(() => {
    for (let id = 1; id <= 1000; id += 1) ChatAppearanceStore.setThread(4, id, { fontSize: 'sm' })
  })()
  const other = new Database(db.name)
  try {
    other.prepare('UPDATE user_preferences SET value = ? WHERE key = ?').run(JSON.stringify({ fontSize: 'xl' }), 'chat_appearance:4:thread:999')
    const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const before = changes()
    ChatAppearanceStore.setThread(4, 42, { fontSize: 'lg' })
    assert.equal(changes() - before, 1)
    assert.deepEqual(ChatAppearanceStore.threadAppearance(4, 999), { fontSize: 'xl' })
    assert.deepEqual(ChatAppearanceStore.threadAppearance(4, 42), { fontSize: 'lg' })
    assert.deepEqual(ChatAppearanceStore.threadAppearance(null, 42), { fontSize: 'md' })
    t.diagnostic('1,000 chat appearance rows: changing one chat writes exactly one row; other-connection updates remain visible')
  } finally {
    other.close()
  }
})

test('limits: slot count and value size', () => {
  const many = Array.from({ length: CHAT_APPEARANCE_LIMITS.slots + 1 }, (_, index) => ({ name: `s${index}`, appearance: {} }))
  assert.throws(() => ChatAppearanceStore.saveSlots(2, { defaultSlotId: null, slots: many }), ChatAppearanceError)
  assert.throws(() => ChatAppearanceStore.setThread(2, 1, { big: 'x'.repeat(CHAT_APPEARANCE_LIMITS.bytes) }), ChatAppearanceError)
})
