import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

test('NAI summaries preserve legacy repair, detail, and mutations', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-nai-summaries-'))
  process.env.RUNTIME_BASE_PATH = root
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`
  const vibeDir = path.join(root, 'save', 'vibe_transfer', 'model')
  const referenceDir = path.join(root, 'save', 'character_reference')
  await fs.promises.mkdir(vibeDir, { recursive: true })
  await fs.promises.mkdir(referenceDir, { recursive: true })
  const created_date = '2026-01-01T00:00:00.000Z'
  await fs.promises.writeFile(path.join(vibeDir, 'old.json'), JSON.stringify({
    id: 'old', label: 'old vibe', model: 'model', encoded: 'payload', image_data_url: dataUrl,
    strength: 0.6, information_extracted: 1, created_date,
  }))
  await fs.promises.writeFile(path.join(referenceDir, 'old.json'), JSON.stringify({
    id: 'old', label: 'old reference', type: 'character', image_data_url: dataUrl,
    strength: 0.6, fidelity: 1, has_letterbox: false, created_date,
  }))
  const store = await import('../src/services/naiAssetStore')
  const vibes = await store.listNaiVibeAssets('model')
  const references = await store.listNaiCharacterReferenceAssets()
  assert.ok(vibes[0].image_url && vibes[0].thumbnail_url)
  assert.ok(references[0].image_url && references[0].thumbnail_url)
  assert.ok(!('encoded' in vibes[0]))
  assert.equal((await store.getNaiVibeAsset('old'))?.encoded, 'payload')
  const [, updated] = await Promise.all([
    store.listNaiVibeAssets('model'),
    store.updateNaiVibeAsset('old', { label: 'updated' }),
  ])
  assert.equal(updated?.label, 'updated')
  assert.equal((await store.listNaiVibeAssets('model'))[0].label, 'updated')
  await store.updateNaiCharacterReferenceAsset('old', { label: 'updated reference' })
  assert.equal((await store.listNaiCharacterReferenceAssets())[0].label, 'updated reference')
  assert.equal(await store.deleteNaiVibeAsset('old'), true)
  assert.equal(await store.deleteNaiCharacterReferenceAsset('old'), true)
  assert.deepEqual(await store.listNaiVibeAssets('model'), [])
  assert.deepEqual(await store.listNaiCharacterReferenceAssets(), [])
})
