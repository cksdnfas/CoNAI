import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftRecovery } from '../../plugins/hyperframes/draft.mjs'

test('recovery serializes edits and clearing after save cannot race with an earlier autosave', async () => {
  let value = null, revision = null, serial = 0
  const storage = {
    get: async () => ({ value, revision }),
    set: async (_key, next, expected) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(expected, revision)
      value = next; revision = String(++serial)
      return { revision }
    },
    delete: async (_key, expected) => { assert.equal(expected, revision); value = null; revision = null },
  }
  const draft = draftRecovery(storage, () => {})
  await draft.load()
  const early = draft.save({ title: '첫 편집', saved: { revision: 'original' } })
  const late = draft.save({ title: '나중 편집', saved: { revision: 'original' } })
  await Promise.all([early, late])
  assert.equal(value.title, '나중 편집')
  const recovery = draftRecovery(storage, () => {})
  assert.equal((await recovery.load()).saved.revision, 'original')
  await Promise.all([draft.save({ title: '저장 중 편집' }), draft.clear()])
  assert.equal(value, null)
})

test('a second tab cannot overwrite or delete a newer recovery draft', async () => {
  let value = null, revision = null
  const storage = {
    get: async () => ({ value, revision }),
    set: async (_key, next, expected) => {
      if (expected !== revision) throw new Error('revision conflict')
      value = next; revision = 'newer'; return { revision }
    },
    delete: async (_key, expected) => {
      if (expected !== revision) throw new Error('revision conflict')
      value = null; revision = null
    },
  }
  const messages = [], first = draftRecovery(storage, () => {}), second = draftRecovery(storage, text => messages.push(text))
  await first.load(); await second.load()
  await first.save({ title: '첫 창의 최신 초안' })
  assert.equal(await second.save({ title: '다른 창의 오래된 초안' }), false)
  assert.equal(await second.clear(), false)
  assert.equal(value.title, '첫 창의 최신 초안')
  assert.match(messages[0], /임시 보관을 멈췄어/)
})
