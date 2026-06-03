import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWildcards } from '@/lib/api-wildcards'
import type { WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import { flattenWildcardRecords } from './wildcard-inline-picker-helpers'
import { useWildcardWorkspaceBrowser } from './use-wildcard-workspace-browser'

interface UseWildcardInlinePickerDataOptions {
  activeTab: WildcardWorkspaceTab
  enabled: boolean
}

export function useWildcardInlinePickerData({ activeTab, enabled }: UseWildcardInlinePickerDataOptions) {
  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'inline-picker'],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
    enabled,
    staleTime: 60_000,
  })

  const wildcards = useMemo(() => wildcardsQuery.data ?? [], [wildcardsQuery.data])
  const flattenedWildcards = useMemo(() => flattenWildcardRecords(wildcards), [wildcards])
  const {
    treeNodes: explorerTreeNodes,
    entries: explorerEntries,
    selectedWildcardId: selectedExplorerId,
    setSelectedWildcardId: setSelectedExplorerId,
  } = useWildcardWorkspaceBrowser({
    records: wildcards,
    activeTab,
  })
  const explorerEntryIdSet = useMemo(() => new Set(explorerEntries.map((entry) => entry.wildcard.id)), [explorerEntries])
  const rootExplorerEntryIds = useMemo(
    () => explorerEntries.filter((entry) => entry.depth === 0).map((entry) => entry.wildcard.id),
    [explorerEntries],
  )

  return {
    wildcardsQuery,
    wildcards,
    flattenedWildcards,
    explorerTreeNodes,
    explorerEntries,
    selectedExplorerId,
    setSelectedExplorerId,
    explorerEntryIdSet,
    rootExplorerEntryIds,
  }
}
