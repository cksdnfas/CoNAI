import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAPREF_SIMPLE_UNUSED, snapRefSimpleReferenceKey } from '@conai/shared'
import { appendSnapRefSimplePictures } from '../src/features/image-generation/components/snapref-simple-utils'
import { placeNaiCharacterReference } from '../src/features/image-generation/components/use-nai-form-controller'

const image = (fileName: string) => ({ dataUrl: `data:image/png;base64,${fileName}`, fileName, mimeType: 'image/png' })

test('SnapRef: loaded pictures fill an empty picture 1 first, then follow the used ones up to the limit', () => {
  const first = appendSnapRefSimplePictures({ [snapRefSimpleReferenceKey(1)]: '' }, ['a', 'b'])
  assert.equal(first.added, 2)
  assert.equal(first.value[snapRefSimpleReferenceKey(1)], 'a')
  assert.equal(first.value[snapRefSimpleReferenceKey(2)], 'b')
  assert.equal(first.value[snapRefSimpleReferenceKey(3)], SNAPREF_SIMPLE_UNUSED)

  const full = appendSnapRefSimplePictures(first.value, Array.from({ length: 10 }, (_, index) => `p${index}`))
  assert.equal(full.added, 6)
  assert.equal(full.value[snapRefSimpleReferenceKey(8)], 'p5')
})

test('NAI: a style image goes in as a style reference; a character image keeps the row type', () => {
  const added = placeNaiCharacterReference([], null, image('style.png'), 'style')
  assert.equal(added[0].type, 'style')
  const replaced = placeNaiCharacterReference([{ type: 'character', strength: '0.6', fidelity: '1' }], 0, image('char.png'))
  assert.equal(replaced[0].type, 'character')
  assert.equal(replaced[0].image?.fileName, 'char.png')
})
