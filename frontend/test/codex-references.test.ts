import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codexReferenceSlots, codexReferencePayload, codexAttachmentUsage } from '../src/features/image-generation/codex-reference-draft'

test('history and persisted reference slots preserve roles, labels and order but never bytes or image selections', () => {
  const references = [
    { role: 'item', label: 'first', image: { fileName: 'private.png', dataUrl: 'data:image/png;base64,AQ==' }, data_url: 'private' },
    { role: 'style', label: 'second', image: { fileName: 'unrelated.png', dataUrl: 'private' } },
  ]
  assert.deepEqual(codexReferenceSlots(references), [{ role: 'item', label: 'first' }, { role: 'style', label: 'second' }])
  assert.throws(() => codexReferencePayload(codexReferenceSlots(references)), /Reattach/)
  assert.deepEqual(codexReferenceSlots(undefined), [])
})

test('submission keeps advisory references ordered and counts bytes rather than base64 characters', () => {
  const image = { fileName: 'one.png', dataUrl: 'data:image/png;base64,AQ==' }
  const refs = [{ role: 'item' as const, label: 'first', image }, { role: 'scale' as const, label: '', image }]
  assert.deepEqual(codexReferencePayload(refs), [
    { role: 'item', label: 'first', data_url: image.dataUrl }, { role: 'scale', label: undefined, data_url: image.dataUrl },
  ])
  assert.deepEqual(codexAttachmentUsage([image, undefined, image]), { count: 2, bytes: 2, oversized: false })
})
