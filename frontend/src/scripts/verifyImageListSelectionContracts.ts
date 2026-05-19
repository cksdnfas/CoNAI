import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const imageListSource = source('features/images/components/image-list/image-list.tsx')
const gridSource = source('features/images/components/image-list/image-list-grid.tsx')
const masonrySource = source('features/images/components/image-list/image-list-masonry.tsx')

assert.match(
  imageListSource,
  /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/,
  'ImageList should build one memoized selected-id Set per selectedIds snapshot',
)
assert.match(
  imageListSource,
  /selectedIdSet\.has\(imageId\)[\s\S]*?\? selectedIds\.filter/,
  'click toggles should reuse the selected-id Set instead of scanning before every toggle',
)
assert.match(
  imageListSource,
  /<ImageListGridLazy[\s\S]*?selectedIdSet=\{selectedIdSet\}/,
  'grid layout should receive the memoized selected-id Set',
)
assert.match(
  imageListSource,
  /<ImageListMasonryLazy[\s\S]*?selectedIdSet=\{selectedIdSet\}/,
  'masonry layout should receive the memoized selected-id Set',
)

assert.match(
  gridSource,
  /selectedIdSet: ReadonlySet<string>/,
  'grid layout contract should accept a readonly selected-id Set',
)
assert.match(
  gridSource,
  /selected=\{selectedIdSet\.has\(itemId\)\}/,
  'grid item selected state should use Set.has for virtualized row rendering',
)
assert.doesNotMatch(
  gridSource,
  /selectedIds\.includes\(itemId\)/,
  'grid rendering must not scan the selectedIds array per rendered card',
)

assert.match(
  masonrySource,
  /selectedIdSet: ReadonlySet<string>/,
  'masonry layout contract should accept a readonly selected-id Set',
)
assert.match(
  masonrySource,
  /selected=\{context\.selectedIdSet\.has\(itemId\)\}/,
  'masonry item selected state should use Set.has for virtualized card rendering',
)
assert.doesNotMatch(
  masonrySource,
  /selectedIds\.includes\(itemId\)/,
  'masonry rendering must not scan the selectedIds array per rendered card',
)

console.log('Image list selection contracts verified.')
