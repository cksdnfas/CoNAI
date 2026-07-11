import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'src')
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8')

const groupPageSource = source('features/groups/group-page.tsx')
const groupImageSectionSource = source('features/groups/components/group-image-section.tsx')
const groupQueriesSource = source('features/groups/use-group-page-queries.ts')

assert.doesNotMatch(
  groupPageSource,
  /GroupDetailHeaderCard/,
  'Group page must not render a second standalone identity toolbar above image controls',
)
assert.match(
  groupPageSource,
  /toolbarActions=\{\([\s\S]*?<GroupOptionsMenu/,
  'Group options should be composed into the image toolbar',
)
assert.match(
  groupImageSectionSource,
  /\{toolbarActions\}/,
  'Image toolbar should expose its secondary action slot',
)
assert.match(
  groupQueriesSource,
  /enabled: Number\.isFinite\(selectedGroupId\) && downloadScope === 'group'/,
  'Expensive filesystem download counts should load only after the group download dialog opens',
)

console.log('Group toolbar contracts verified.')
