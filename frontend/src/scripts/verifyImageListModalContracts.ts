import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const imageListSource = readFileSync(
  resolve(process.cwd(), 'src/features/images/components/image-list/image-list.tsx'),
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

console.log('Image list modal contracts verified.')
