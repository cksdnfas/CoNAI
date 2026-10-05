import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

// The store writes under the runtime save directory; the first import points it at a scratch folder.
import './scratchSaveDir'
import { CHAT_APPEARANCE_LIMITS, ChatAppearanceError, ChatAppearanceStore } from '../src/services/codex-chat/chatAppearance'

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

test('the file on disk is what a fresh read sees, and a broken file starts empty', () => {
  const dir = path.join(process.env.RUNTIME_SAVE_DIR as string, 'chat-appearance')
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '1.json'), 'utf8'))
  assert.equal(onDisk.defaultSlotId, 1)
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false)
  fs.writeFileSync(path.join(dir, 'guest.json'), '{not json')
  assert.deepEqual(ChatAppearanceStore.read(null), { defaultSlotId: null, slots: [], threads: {} })
})

test('limits: slot count and value size', () => {
  const many = Array.from({ length: CHAT_APPEARANCE_LIMITS.slots + 1 }, (_, index) => ({ name: `s${index}`, appearance: {} }))
  assert.throws(() => ChatAppearanceStore.saveSlots(2, { defaultSlotId: null, slots: many }), ChatAppearanceError)
  assert.throws(() => ChatAppearanceStore.setThread(2, 1, { big: 'x'.repeat(CHAT_APPEARANCE_LIMITS.bytes) }), ChatAppearanceError)
})
