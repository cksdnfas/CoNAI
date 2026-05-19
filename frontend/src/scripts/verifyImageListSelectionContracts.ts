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
const homePageDataSource = source('features/home/use-home-page-data.ts')
const groupPageQueriesSource = source('features/groups/use-group-page-queries.ts')
const imageAttachmentPickerSource = source('features/image-generation/components/image-attachment-picker.tsx')

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

assert.match(
  homePageDataSource,
  /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/,
  'Home page should build one memoized selected-id Set for selected action lookups',
)
assert.match(
  homePageDataSource,
  /selectedIdSet\.has\(String\(image\.composite_hash \?\? image\.id\)\)/,
  'Home page selected action hashes should reuse the selected-id Set',
)
assert.doesNotMatch(
  homePageDataSource,
  /selectedIds\.includes\(String\(image\.composite_hash \?\? image\.id\)\)/,
  'Home page selected action hash derivation must not scan selectedIds per visible image',
)

assert.match(
  groupPageQueriesSource,
  /const selectedGroupImageIdSet = useMemo\(\(\) => new Set\(selectedGroupImageIds\), \[selectedGroupImageIds\]\)/,
  'Group page should build one memoized selected image-id Set for selected download lookups',
)
assert.match(
  groupPageQueriesSource,
  /selectedGroupImageIdSet\.has\(String\(image\.composite_hash \?\? image\.id\)\)/,
  'Group page selected image derivation should reuse the selected-id Set',
)
assert.doesNotMatch(
  groupPageQueriesSource,
  /selectedGroupImageIds\.includes\(String\(image\.composite_hash \?\? image\.id\)\)/,
  'Group page selected image derivation must not scan selectedGroupImageIds per group image',
)

assert.match(
  imageAttachmentPickerSource,
  /const selectedImageAttachmentIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/,
  'Image attachment picker should build one memoized selected-id Set for overlay lookups',
)
assert.match(
  imageAttachmentPickerSource,
  /selectedImageAttachmentIdSet\.has\(getImageListItemId\(image\)\)/,
  'Image attachment picker selected overlay should reuse Set.has per rendered image',
)
assert.doesNotMatch(
  imageAttachmentPickerSource,
  /selectedIds\.includes\(getImageListItemId\(image\)\)/,
  'Image attachment picker overlay must not scan selectedIds per rendered image',
)

console.log('Image list selection contracts verified.')
