import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const imageListSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/image-list/image-list.tsx'),
  'utf8',
)
const imageViewModalProviderSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/detail/image-view-modal-provider.tsx'),
  'utf8',
)
const imageListGridSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/image-list/image-list-grid.tsx'),
  'utf8',
)
const imageListMasonrySource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/image-list/image-list-masonry.tsx'),
  'utf8',
)
const imageListItemSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/image-list/image-list-item.tsx'),
  'utf8',
)
const imageDetailViewSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/image-detail-view.tsx'),
  'utf8',
)

assert.match(
  imageListSource,
  /const itemCompositeHashIndex = useMemo\([\s\S]*?new Map\(itemCompositeHashes\.map\(\(compositeHash, index\) => \[compositeHash, index\] as const\)\)[\s\S]*?\[itemCompositeHashes\]/,
  'ImageList should build one memoized composite-hash index map per visible media list snapshot',
)

assert.match(
  imageListSource,
  /return itemCompositeHashIndex\.get\(activeCompositeHash\) \?\? -1/,
  'modal active-image lookup should use the memoized composite-hash index map',
)

assert.doesNotMatch(
  imageListSource,
  /itemCompositeHashes\.indexOf\(activeCompositeHash\)/,
  'modal active-image lookup must not scan the visible composite-hash list on every active image change',
)

assert.match(
  imageViewModalProviderSource,
  /compositeHashIndexByHash: Map<string, number>/,
  'ImageViewModalProvider should keep an index map beside the modal navigation sequence',
)

assert.match(
  imageViewModalProviderSource,
  /function buildCompositeHashIndexByHash\(compositeHashes: string\[\]\)[\s\S]*?new Map/,
  'modal navigation should build the active-index map when the ordered sequence changes',
)

assert.match(
  imageViewModalProviderSource,
  /function buildUniqueCompositeHashes\(compositeHashes: readonly string\[\] \| undefined\)[\s\S]*?seenCompositeHashes\.has\(compositeHash\)[\s\S]*?uniqueCompositeHashes\.push\(compositeHash\)/,
  'modal navigation should sanitize and dedupe incoming sequence snapshots in one ordered pass',
)

assert.match(
  imageViewModalProviderSource,
  /const compositeHashes = buildUniqueCompositeHashes\(input\.compositeHashes\)[\s\S]*?const nextCompositeHashes = hasInputCompositeHash[\s\S]*?const nextCompositeHashes = buildUniqueCompositeHashes\(input\.compositeHashes\)/,
  'modal open and sequence sync should share the ordered unique composite-hash snapshot builder',
)

assert.doesNotMatch(
  imageViewModalProviderSource,
  /Array\.from\(new Set\(input\.compositeHashes/,
  'modal sequence sync must not allocate a filtered array before deduping incoming composite hashes',
)

assert.match(
  imageViewModalProviderSource,
  /return state\.compositeHash \? \(state\.compositeHashIndexByHash\.get\(state\.compositeHash\) \?\? -1\) : -1/,
  'modal active-index lookup should read from the cached composite-hash index map',
)

assert.doesNotMatch(
  imageViewModalProviderSource,
  /compositeHashes\.indexOf\(/,
  'modal previous/next navigation must not scan the composite-hash sequence for every arrow-key step',
)

assert.match(
  imageListSource,
  /const queryClient = useQueryClient\(\)/,
  'ImageList should own a query client for pre-opening detail warmup',
)

assert.match(
  imageListSource,
  /const handlePreviewIntent = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?if \(activationMode === 'none' \|\| selectionMode \|\| isDraggingSelection\) \{[\s\S]*?queryClient\.prefetchQuery\(\{[\s\S]*?queryKey: \['image-detail', compositeHash\][\s\S]*?queryFn: \(\{ signal \}\) => getImage\(compositeHash, \{ signal \}\)[\s\S]*?staleTime: 30_000/,
  'ImageList should prefetch image detail on hover/focus while avoiding selection-drag paths',
)

assert.match(
  imageListSource,
  /<ImageListGridLazy[\s\S]*?onPreviewIntent=\{handlePreviewIntent\}/,
  'grid image lists should receive the shared preview-intent warmup callback',
)

assert.match(
  imageListSource,
  /<ImageListMasonryLazy[\s\S]*?onPreviewIntent=\{handlePreviewIntent\}/,
  'masonry image lists should receive the shared preview-intent warmup callback',
)

assert.match(
  imageListGridSource,
  /onPreviewIntent\?: \(image: ImageRecord\) => void[\s\S]*?onPreviewIntent=\{context\.onPreviewIntent\}/,
  'grid image-list items should forward preview intent from the virtualized context',
)

assert.match(
  imageListMasonrySource,
  /onPreviewIntent\?: \(image: ImageRecord\) => void[\s\S]*?onPreviewIntent=\{context\.onPreviewIntent\}/,
  'masonry image-list items should forward preview intent from the virtualized context',
)

assert.match(
  imageListItemSource,
  /onPointerEnter=\{interactive \? \(\(\) => onPreviewIntent\?\.\(image\)\) : undefined\}[\s\S]*?onFocus=\{interactive \? \(\(\) => onPreviewIntent\?\.\(image\)\) : undefined\}/,
  'image list cards should warm detail data from pointer and keyboard preview intent',
)

assert.match(
  imageDetailViewSource,
  /const prefetchedImage = queryClient\.getQueryData<ImageRecord>\(\['image-detail', compositeHash\]\)[\s\S]*?if \(prefetchedImage\?\.composite_hash === compositeHash\) \{[\s\S]*?return prefetchedImage/,
  'image detail views should consume prefetched detail records before scanning broader feed caches',
)

console.log('Image list modal contracts verified.')
