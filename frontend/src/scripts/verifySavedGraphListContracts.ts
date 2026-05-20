import { equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const savedGraphListSource = readFileSync(
  fileURLToPath(new URL('../features/module-graph/components/saved-graph-list.tsx', import.meta.url)),
  'utf8',
)

ok(
  savedGraphListSource.includes('const collapsedFolderIdSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds])'),
  'saved graph explorer should memoize collapsed folder ids once per render state',
)
ok(
  savedGraphListSource.includes('const isExpanded = !collapsedFolderIdSet.has(folder.id)'),
  'saved graph explorer folder rows should use Set.has for expanded-state lookup',
)
equal(
  savedGraphListSource.includes('const isExpanded = !collapsedFolderIds.includes(folder.id)'),
  false,
  'saved graph explorer must not scan collapsedFolderIds for each visible folder render',
)

console.log('Saved graph list contracts verified')
