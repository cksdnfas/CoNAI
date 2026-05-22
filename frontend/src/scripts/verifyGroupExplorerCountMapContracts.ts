import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const groupPageSource = source('features/groups/group-page.tsx')
const sidebarSource = source('features/groups/components/group-explorer-sidebar-panel.tsx')
const treeSource = source('features/groups/components/group-tree.tsx')
const rootGridSource = source('features/groups/components/group-root-grid-section.tsx')
const navigationGridSource = source('features/groups/components/group-navigation-grid-section.tsx')

assert.match(
  groupPageSource,
  /const groupCountMaps = useMemo\(\(\) => buildGroupCountMaps\(allGroups\), \[allGroups\]\)/,
  'Group page should build one memoized group count map snapshot for the loaded hierarchy',
)
assert.match(
  groupPageSource,
  /<GroupExplorerSidebarPanel[\s\S]*?countMaps=\{groupCountMaps\}/,
  'Group explorer sidebar should receive the shared count maps',
)
assert.match(
  groupPageSource,
  /<GroupRootGridSection[\s\S]*?countMaps=\{groupCountMaps\}/,
  'Root group grid should receive the shared count maps',
)
assert.match(
  groupPageSource,
  /<GroupNavigationGridSection[\s\S]*?countMaps=\{groupCountMaps\}/,
  'Child navigation grid should receive the shared count maps',
)

assert.match(
  sidebarSource,
  /countMaps: GroupCountMaps/,
  'Group explorer sidebar contract should require precomputed count maps',
)
assert.match(
  sidebarSource,
  /<GroupTree[\s\S]*?countMaps=\{countMaps\}/,
  'Group explorer sidebar should pass the shared count maps to the tree',
)

for (const [name, componentSource] of [
  ['GroupTree', treeSource],
  ['GroupRootGridSection', rootGridSource],
  ['GroupNavigationGridSection', navigationGridSource],
] as const) {
  assert.match(
    componentSource,
    /countMaps: GroupCountMaps/,
    `${name} should accept shared count maps instead of rebuilding hierarchy totals`,
  )
  assert.doesNotMatch(
    componentSource,
    /buildGroupCountMaps/,
    `${name} must not rebuild group hierarchy count maps during render`,
  )
  assert.match(
    componentSource,
    /getGroupHierarchyCountLabel\(group, countMaps, formatNumber\)/,
    `${name} should use shared maps for visible group count labels`,
  )
}

assert.match(
  treeSource,
  /getGroupHierarchyTotalCount\(group, countMaps\) > 0/,
  'Group tree selectability should use shared count maps for descendant totals',
)
assert.match(
  rootGridSource,
  /totalImageCount=\{getGroupHierarchyTotalCount\(group, countMaps\)\}/,
  'Root group grid should use shared maps for preview image totals',
)
assert.match(
  navigationGridSource,
  /totalImageCount=\{getGroupHierarchyTotalCount\(group, countMaps\)\}/,
  'Navigation group grid should use shared maps for preview image totals',
)

console.log('Group explorer count map contracts verified.')
