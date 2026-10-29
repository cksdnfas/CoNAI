import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codexReferenceSlots, codexReferencePayload, codexAttachmentUsage, canEnableCodexStrict, applyCodexDraftPatch, codexReferenceCapacity, shouldConfirmCodexHistoryLoad } from '../src/features/image-generation/codex-reference-draft'
import type { CodexFormDraft } from '../src/features/image-generation/components/codex-generation-panel'

const t = ({ ko }: { ko: string; en: string }) => ko
const missingReferenceMessage = '참조 이미지를 다시 첨부해줘.'

test('history and persisted reference slots preserve roles, labels and order but never bytes or image selections', () => {
  const references = [
    { role: 'item', label: 'first', image: { fileName: 'private.png', dataUrl: 'data:image/png;base64,AQ==' }, data_url: 'private' },
    { role: 'style', label: 'second', image: { fileName: 'unrelated.png', dataUrl: 'private' } },
  ]
  assert.deepEqual(codexReferenceSlots(references), [{ role: 'item', label: 'first' }, { role: 'style', label: 'second' }])
  assert.throws(() => codexReferencePayload(codexReferenceSlots(references), missingReferenceMessage), /참조 이미지를 다시 첨부/)
  assert.deepEqual(codexReferenceSlots(undefined), [])
})

test('submission keeps advisory references ordered and counts bytes rather than base64 characters', () => {
  const image = { fileName: 'one.png', dataUrl: 'data:image/png;base64,AQ==' }
  const refs = [{ role: 'item' as const, label: 'first', image }, { role: 'scale' as const, label: '', image }]
  assert.deepEqual(codexReferencePayload(refs, missingReferenceMessage), [
    { role: 'item', label: 'first', data_url: image.dataUrl }, { role: 'scale', label: undefined, data_url: image.dataUrl },
  ])
  assert.deepEqual(codexAttachmentUsage([image, undefined, image]), { count: 2, bytes: 2, oversized: false })
})

const blank: CodexFormDraft = { model: '', prompt: '', negativePrompt: '', count: '1', aspectRatio: '1:1', resolution: '1024', imageMode: 'reference', strictPreservation: false, references: [] }
const image = { fileName: 'image.png', dataUrl: 'data:image/png;base64,AQ==' }

test('UI and assistant strict gating require infill and clear hidden strict state on mode changes', () => {
  assert.equal(canEnableCodexStrict(blank), false)
  assert.throws(() => applyCodexDraftPatch(blank, { strictPreservation: true }, t), /엄격 보존에는 편집 모드와 원본, 마스크가 필요해/)
  const edit = { ...blank, imageMode: 'edit' as const, referenceImage: image, maskImage: image }
  assert.equal(canEnableCodexStrict(edit), true)
  const strict = applyCodexDraftPatch(edit, { strictPreservation: true }, t)
  assert.equal(strict.strictPreservation, true)
  const reference = applyCodexDraftPatch(strict, { imageMode: 'reference' }, t)
  assert.equal(reference.strictPreservation, false)
  assert.equal(reference.maskImage, undefined)
  assert.throws(() => applyCodexDraftPatch(edit, { imageMode: 'reference', strictPreservation: true }, t), /엄격 보존에는 편집 모드/)
  assert.equal(applyCodexDraftPatch({ ...blank, strictPreservation: true }, { prompt: 'repair stale state' }, t).strictPreservation, false)
})

test('assistant reference counts include source/mask and edits retain role, label and ordering', () => {
  const edit = { ...blank, imageMode: 'edit' as const, referenceImage: image, maskImage: image }
  assert.equal(codexReferenceCapacity(edit), 3)
  const slots = applyCodexDraftPatch(edit, { referenceCount: 5 }, t)
  assert.equal(slots.references.length, 3)
  const changed = applyCodexDraftPatch(slots, { reference0Role: 'item', reference0Label: 'boots', reference0Order: 3 }, t)
  assert.deepEqual(changed.references[2], { role: 'item', label: 'boots' })
  assert.deepEqual(slots.references[0], { role: 'reference', label: '' })
})

test('history replacement confirms masks and advisory attachments even with unchanged or empty prompts', () => {
  assert.equal(shouldConfirmCodexHistoryLoad(blank, blank), false)
  assert.equal(shouldConfirmCodexHistoryLoad({ ...blank, maskImage: image }, blank), true)
  assert.equal(shouldConfirmCodexHistoryLoad({ ...blank, references: [{ role: 'item', label: 'boots', image }] }, blank), true)
})
