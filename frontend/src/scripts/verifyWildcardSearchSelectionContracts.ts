import { deepEqual, equal } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { WildcardRecord } from '../lib/api-wildcards'
import { resolveWildcardWorkspaceSelection } from '../features/image-generation/components/use-wildcard-workspace-browser'
import type { WildcardTreeEntry } from '../features/image-generation/components/wildcard-generation-panel-helpers'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function makeWildcard(id: number, name: string): WildcardRecord {
  return {
    id,
    name,
    description: null,
    parent_id: null,
    include_children: 0,
    only_children: 0,
    type: 'wildcard',
    chain_option: 'replace',
    created_date: '2026-05-16T00:00:00.000Z',
    updated_date: '2026-05-16T00:00:00.000Z',
    items: [],
  }
}

function makeEntry(id: number, name: string): WildcardTreeEntry {
  const wildcard = makeWildcard(id, name)
  return {
    wildcard,
    depth: 0,
    path: [name],
  }
}

const alpha = makeEntry(1, 'alpha')
const beta = makeEntry(2, 'beta')
const gamma = makeEntry(3, 'gamma')
const allEntries = [alpha, beta, gamma]

const visibleSelected = resolveWildcardWorkspaceSelection({
  entries: allEntries,
  filteredEntries: [beta, gamma],
  selectedWildcardId: 2,
  hasSearch: true,
})
deepEqual(visibleSelected, { nextSelectedWildcardId: 2, selectedEntry: beta })

const hiddenSelected = resolveWildcardWorkspaceSelection({
  entries: allEntries,
  filteredEntries: [gamma],
  selectedWildcardId: 1,
  hasSearch: true,
})
deepEqual(hiddenSelected, { nextSelectedWildcardId: 3, selectedEntry: gamma })

const noSearchFallback = resolveWildcardWorkspaceSelection({
  entries: allEntries,
  filteredEntries: [],
  selectedWildcardId: 99,
  hasSearch: false,
})
deepEqual(noSearchFallback, { nextSelectedWildcardId: 1, selectedEntry: alpha })

const noSearchResults = resolveWildcardWorkspaceSelection({
  entries: allEntries,
  filteredEntries: [],
  selectedWildcardId: 1,
  hasSearch: true,
})
deepEqual(noSearchResults, { nextSelectedWildcardId: null, selectedEntry: null })

const emptyWorkspace = resolveWildcardWorkspaceSelection({
  entries: [],
  filteredEntries: [],
  selectedWildcardId: 1,
  hasSearch: false,
})
equal(emptyWorkspace.nextSelectedWildcardId, null)
equal(emptyWorkspace.selectedEntry, null)

const inlineExplorerSource = source('features/image-generation/components/wildcard-inline-picker-explorer.tsx')
equal(
  inlineExplorerSource.includes('const expandedWildcardIdSet = useMemo(() => new Set(expandedWildcardIds), [expandedWildcardIds])'),
  true,
  'inline wildcard tree should memoize expanded ids once per expanded id snapshot',
)
equal(
  inlineExplorerSource.includes('expandedWildcardIdSet.has(node.id)'),
  true,
  'inline wildcard tree rendering should use Set.has for per-node expanded state',
)
equal(
  inlineExplorerSource.includes('expandedWildcardIds.includes(node.id)'),
  false,
  'inline wildcard tree rendering must not scan expandedWildcardIds for every visible node',
)

const inlinePickerFieldSource = source('features/image-generation/components/wildcard-inline-picker-field.tsx')
equal(
  inlinePickerFieldSource.includes('const explorerEntryIdSet = useMemo(() => new Set(explorerEntries.map((entry) => entry.wildcard.id)), [explorerEntries])'),
  true,
  'inline wildcard picker should memoize explorer entry ids once per explorer entry snapshot',
)
equal(
  inlinePickerFieldSource.includes('const rootExplorerEntryIds = useMemo('),
  true,
  'inline wildcard picker should memoize root explorer ids for default expansion',
)
equal(
  inlinePickerFieldSource.includes('!explorerEntryIdSet.has(selectedExplorerId)'),
  true,
  'inline wildcard picker selection recovery should use Set.has for selected explorer membership',
)
equal(
  inlinePickerFieldSource.includes('!explorerEntries.some((entry) => entry.wildcard.id === selectedExplorerId)'),
  false,
  'inline wildcard picker selection recovery must not scan explorer entries on every effect pass',
)

console.log('Wildcard search selection contracts verified')
