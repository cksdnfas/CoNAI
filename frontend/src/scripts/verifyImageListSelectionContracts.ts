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
const selectionHookSource = source('features/images/components/image-list/use-image-list-selection.ts')
const imageFeedSafetySource = source('features/images/components/image-list/use-image-feed-safety.tsx')
const homePageDataSource = source('features/home/use-home-page-data.ts')
const groupPageQueriesSource = source('features/groups/use-group-page-queries.ts')
const imageAttachmentPickerSource = source('features/image-generation/components/image-attachment-picker.tsx')
const mediaReviewPageSource = source('features/media-review/media-review-page.tsx')
const mediaReviewUtilsSource = source('features/media-review/media-review-utils.ts')
const apiImagesSource = source('lib/api-images.ts')

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
  /selected=\{context\.selectedIdSet\.has\(itemId\)\}/,
  'grid item selected state should use Set.has from the Virtuoso context for virtualized row rendering',
)
assert.match(
  gridSource,
  /const gridContext = useMemo<ImageListGridContext>\(\(\) => \(\{/,
  'grid layout should memoize the Virtuoso context object between unrelated image-list renders',
)
assert.match(
  gridSource,
  /context=\{gridContext\}/,
  'grid layout should pass the memoized context object to VirtuosoGrid',
)
assert.doesNotMatch(
  gridSource,
  /context=\{\{/,
  'grid layout must not allocate a fresh Virtuoso context object inline on every render',
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
assert.match(
  masonrySource,
  /const masonryContext = useMemo<ImageListMasonryContext>\(\(\) => \(\{/,
  'masonry layout should memoize the Virtuoso context object between unrelated image-list renders',
)
assert.match(
  masonrySource,
  /context=\{masonryContext\}/,
  'masonry layout should pass the memoized context object to VirtuosoMasonry',
)
assert.doesNotMatch(
  masonrySource,
  /context=\{\{/,
  'masonry layout must not allocate a fresh Virtuoso context object inline on every render',
)
assert.doesNotMatch(
  masonrySource,
  /selectedIds\.includes\(itemId\)/,
  'masonry rendering must not scan the selectedIds array per rendered card',
)

assert.match(
  selectionHookSource,
  /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/,
  'DOM selection sync should memoize selected ids instead of rebuilding the Set for every mutation observer pass',
)
assert.match(
  selectionHookSource,
  /const isSelected = selectedIdSet\.has\(imageId\)/,
  'DOM selection sync should use the memoized Set for item selection state',
)
assert.doesNotMatch(
  selectionHookSource,
  /const selectedIdSet = new Set\(selectedIds\)/,
  'DOM selection sync must not rebuild the selected-id Set inside each sync pass',
)

assert.match(
  imageFeedSafetySource,
  /const renderItemPersistentOverlay = useCallback\(\(image: ImageRecord\) => \{/,
  'Image feed safety overlay renderer should be stable between unrelated image-list renders',
)
assert.match(
  imageFeedSafetySource,
  /const shouldBlurItemPreview = useCallback\(\(image: ImageRecord\) => visibilityMode === 'badge-only'/,
  'Image feed safety blur resolver should be stable between unrelated image-list renders',
)
assert.match(
  imageFeedSafetySource,
  /return \{[\s\S]*renderItemPersistentOverlay,[\s\S]*shouldBlurItemPreview,/,
  'Image feed safety should return the memoized overlay and blur callbacks',
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
assert.match(
  imageAttachmentPickerSource,
  /function toSearchableImageAttachmentRecord\(image: ImageRecord\): SearchableImageAttachmentRecord[\s\S]*?searchLabel: getImageListDisplayName\(image\)\.toLowerCase\(\)/,
  'Image attachment picker should cache lowercase display labels once per image snapshot',
)
assert.match(
  imageAttachmentPickerSource,
  /const systemImageSearchEntries = useMemo\(\(\) => systemImages\.map\(toSearchableImageAttachmentRecord\), \[systemImages\]\)/,
  'System image search should build cached searchable entries only when loaded images change',
)
assert.match(
  imageAttachmentPickerSource,
  /const saveImageSearchEntries = useMemo\(\(\) => saveImageRecords\.map\(toSearchableImageAttachmentRecord\), \[saveImageRecords\]\)/,
  'Save image search should build cached searchable entries only when save records change',
)
assert.doesNotMatch(
  imageAttachmentPickerSource,
  /getImageListDisplayName\(image\)\.toLowerCase\(\)\.includes\(search\)/,
  'Image attachment picker search must not rebuild display names while filtering each keystroke',
)

assert.match(
  mediaReviewPageSource,
  /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/,
  'Media review should memoize selected ids before deriving batch actions',
)
assert.match(
  mediaReviewPageSource,
  /const reviewedIdSet = useMemo\(\(\) => new Set\(reviewedIds\), \[reviewedIds\]\)/,
  'Media review should memoize reviewed ids before filtering review queues',
)
assert.match(
  mediaReviewPageSource,
  /filterMediaReviewImages\(loadedImages, activeQueue, similarHashSet, reviewedIdSet\)/,
  'Media review queues should include session review state without schema changes',
)
assert.match(
  mediaReviewPageSource,
  /<BatchReviewPreview[\s\S]*selectedCompositeCount=\{selectedCompositeHashes\.length\}/,
  'Media review batch actions should render a selection preview before mutation actions',
)
assert.match(
  mediaReviewPageSource,
  /const selectedActionableImages = useMemo\([\s\S]*?image\.file_status !== 'missing' && image\.file_status !== 'deleted'/,
  'Media review batch mutations should filter missing/deleted records out of active actions',
)
assert.match(
  mediaReviewPageSource,
  /data-media-review-cleanup-guardrail="true"/,
  'Media review should render an explicit non-destructive cleanup guardrail',
)
assert.match(
  mediaReviewPageSource,
  /<ImageSelectionBar[\s\S]*showDownloadAction=\{false\}[\s\S]*삭제\/정리 없음[\s\S]*handleOpenAssignModal[\s\S]*handleBatchTagSelected[\s\S]*handleMarkReviewed/,
  'Media review selection bar should expose non-destructive group, tag/rating, and reviewed-state batch actions',
)
assert.doesNotMatch(
  mediaReviewPageSource,
  /deleteImagesBulk|Trash2|\/api\/images\/bulk/,
  'Media review selection actions must not wire destructive image deletion',
)
assert.match(
  mediaReviewUtilsSource,
  /export type MediaReviewQueueKey = [^\n]*'recoverable'/,
  'Media review queues should include a recoverable review lane',
)
assert.match(
  mediaReviewUtilsSource,
  /recoverableCount: number/,
  'Media review summaries should count missing/deleted records separately',
)
assert.match(
  mediaReviewUtilsSource,
  /if \(queue === 'recoverable'\) \{[\s\S]*?signals\.recoverabilityState !== 'active'/,
  'Media review recoverable queue should be derived from file recoverability state',
)
assert.match(
  apiImagesSource,
  /export async function batchTagImages\(compositeHashes: string\[\]\)[\s\S]*\/api\/images\/batch-tag[\s\S]*image_ids: compositeHashes/,
  'Media review tag/rating batch action should reuse the existing batch-tag API',
)

console.log('Image list selection contracts verified.')
