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
  savedGraphListSource.includes('const workflowSearchTextById = useMemo(() => {'),
  'saved graph explorer should memoize workflow search text once per graph list update',
)
ok(
  savedGraphListSource.includes('nextMap.set(graph.id, buildWorkflowSearchText(graph))'),
  'saved graph explorer should build workflow search text through the shared cache builder',
)
ok(
  savedGraphListSource.includes('const folderSearchTextById = useMemo(() => {'),
  'saved graph explorer should memoize folder search text once per folder list update',
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
equal(
  savedGraphListSource.includes("[workflow.name, workflow.description ?? ''].join(' ').toLowerCase().includes(query)"),
  false,
  'saved graph explorer must not rebuild workflow search text during each search pass',
)

console.log('Saved graph list contracts verified')
