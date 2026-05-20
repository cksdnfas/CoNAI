import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(process.cwd(), 'src/features/module-graph/components/nai-reusable-assets-input.tsx'),
  'utf8',
)

match(
  source,
  /function buildAssetOrderIndex\(ids: string\[\]\)[\s\S]*?new Map\(ids\.map\(\(id, index\) => \[id, index\] as const\)\)/,
  'NAI reusable asset picker should index saved asset order arrays once',
)
match(
  source,
  /function getAssetOrder\(orderIndex: ReadonlyMap<string, number>, assetId: string\)[\s\S]*?orderIndex\.get\(assetId\) \?\? Number\.MAX_SAFE_INTEGER/,
  'NAI reusable asset picker should resolve missing order entries without array scans',
)
match(
  source,
  /const pinnedIdOrder = buildAssetOrderIndex\(pinnedIds\)[\s\S]*?const recentIdOrder = buildAssetOrderIndex\(recentIds\)[\s\S]*?getAssetOrder\(pinnedIdOrder, left\.id\)[\s\S]*?getAssetOrder\(recentIdOrder, left\.id\)/,
  'pinned sort should reuse pinned and recent order indexes inside the comparator',
)
match(
  source,
  /if \(sort === 'recent'\) \{[\s\S]*?const recentIdOrder = buildAssetOrderIndex\(recentIds\)[\s\S]*?getAssetOrder\(recentIdOrder, left\.id\)/,
  'recent sort should reuse one recent order index inside the comparator',
)
match(
  source,
  /const pinnedVibeIdSet = useMemo\(\(\) => new Set\(pinnedVibeIds\), \[pinnedVibeIds\]\)[\s\S]*?pinnedVibeIdSet\.has\(asset\.id\)/,
  'saved vibe card render should use one memoized pinned-id Set for badge and button state',
)
match(
  source,
  /const pinnedCharacterReferenceIdSet = useMemo\(\(\) => new Set\(pinnedCharacterReferenceIds\), \[pinnedCharacterReferenceIds\]\)[\s\S]*?pinnedCharacterReferenceIdSet\.has\(asset\.id\)/,
  'saved character-reference card render should use one memoized pinned-id Set for badge and button state',
)
doesNotMatch(
  source,
  /(?:pinnedIds|recentIds)\.indexOf\((?:left|right)\.id\)/,
  'saved asset sort comparators must not scan preference arrays for every comparison',
)
doesNotMatch(
  source,
  /pinned(?:Vibe|CharacterReference)Ids\.includes\(asset\.id\)/,
  'saved asset card render must not rescan pinned-id arrays for every badge/button state',
)

console.log('NAI reusable asset contracts verified.')
