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
  /return state\.compositeHash \? \(state\.compositeHashIndexByHash\.get\(state\.compositeHash\) \?\? -1\) : -1/,
  'modal active-index lookup should read from the cached composite-hash index map',
)

assert.doesNotMatch(
  imageViewModalProviderSource,
  /compositeHashes\.indexOf\(/,
  'modal previous/next navigation must not scan the composite-hash sequence for every arrow-key step',
)

console.log('Image list modal contracts verified.')
