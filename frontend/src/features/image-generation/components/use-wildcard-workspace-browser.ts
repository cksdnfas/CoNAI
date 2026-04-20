import { useEffect, useMemo, useState } from 'react'
import type { WildcardRecord } from '@/lib/api'
import {
  filterWildcardTree,
  flattenWildcardTree,
  matchesWorkspaceTab,
  type WildcardTreeEntry,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'

type UseWildcardWorkspaceBrowserOptions = {
  records: WildcardRecord[]
  activeTab: WildcardWorkspaceTab
  searchQuery?: string
}

type UseWildcardWorkspaceBrowserResult = {
  treeNodes: WildcardRecord[]
  entries: WildcardTreeEntry[]
  filteredEntries: WildcardTreeEntry[]
  selectedWildcardId: number | null
  selectedEntry: WildcardTreeEntry | null
  setSelectedWildcardId: (wildcardId: number | null) => void
}

/** Share wildcard workspace tree filtering, optional search, and resilient default selection across browser surfaces. */
export function useWildcardWorkspaceBrowser({
  records,
  activeTab,
  searchQuery = '',
}: UseWildcardWorkspaceBrowserOptions): UseWildcardWorkspaceBrowserResult {
  const [selectedWildcardId, setSelectedWildcardId] = useState<number | null>(null)

  const treeNodes = useMemo(
    () => filterWildcardTree(records, (node) => matchesWorkspaceTab(node, activeTab)),
    [activeTab, records],
  )
  const entries = useMemo(() => flattenWildcardTree(treeNodes), [treeNodes])

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    if (!normalizedSearch) {
      return entries
    }

    return entries.filter((entry) => {
      const pathText = entry.path.join(' / ').toLowerCase()
      return entry.wildcard.name.toLowerCase().includes(normalizedSearch) || pathText.includes(normalizedSearch)
    })
  }, [entries, searchQuery])

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.wildcard.id === selectedWildcardId) ?? null,
    [entries, selectedWildcardId],
  )

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedWildcardId(null)
      return
    }

    if (selectedWildcardId === null || !entries.some((entry) => entry.wildcard.id === selectedWildcardId)) {
      setSelectedWildcardId(entries[0].wildcard.id)
    }
  }, [entries, selectedWildcardId])

  return {
    treeNodes,
    entries,
    filteredEntries,
    selectedWildcardId,
    selectedEntry,
    setSelectedWildcardId,
  }
}
