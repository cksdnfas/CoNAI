import type { WildcardRecord } from '@/lib/api'

export type WildcardWorkspaceTab = 'wildcards' | 'preprocess' | 'lora'

export type WildcardTreeEntry = {
  wildcard: WildcardRecord
  depth: number
  path: string[]
}

/** Flatten the hierarchical wildcard tree into entries with depth and breadcrumb path. */
export function flattenWildcardTree(nodes: WildcardRecord[], depth = 0, parentPath: string[] = []): WildcardTreeEntry[] {
  const entries: WildcardTreeEntry[] = []

  for (const node of nodes) {
    const path = [...parentPath, node.name]
    entries.push({ wildcard: node, depth, path })

    if (node.children && node.children.length > 0) {
      entries.push(...flattenWildcardTree(node.children, depth + 1, path))
    }
  }

  return entries
}

/** Filter the wildcard tree while preserving matching descendants and parent structure. */
export function filterWildcardTree(nodes: WildcardRecord[], predicate: (node: WildcardRecord) => boolean): WildcardRecord[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterWildcardTree(node.children ?? [], predicate)
    if (!predicate(node) && filteredChildren.length === 0) {
      return []
    }

    return [{
      ...node,
      children: filteredChildren.length > 0 ? filteredChildren : undefined,
    }]
  })
}

/** Check whether one wildcard record belongs to the active workspace tab. */
export function matchesWorkspaceTab(node: WildcardRecord, tab: WildcardWorkspaceTab) {
  if (tab === 'preprocess') {
    return node.type === 'chain' && node.is_auto_collected !== 1
  }

  if (tab === 'lora') {
    return node.is_auto_collected === 1
  }

  return node.type !== 'chain' && node.is_auto_collected !== 1
}

/** Return the persistence type that should be used for each workspace tab. */
export function getWorkspaceTabRecordType(tab: WildcardWorkspaceTab) {
  return tab === 'preprocess' ? 'chain' : 'wildcard'
}

/** Guard create actions for tabs backed by auto-collected data. */
export function canCreateWorkspaceTabItem(tab: WildcardWorkspaceTab) {
  return tab !== 'lora'
}

/** Mark workspace tabs backed by read-only auto-collected records. */
export function isReadonlyWorkspaceTab(tab: WildcardWorkspaceTab) {
  return tab === 'lora'
}

/** Format one timestamp for the wildcard workspace cards and logs. */
export function formatWildcardDateTime(value?: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Copy text into the clipboard for wildcard syntax and preview samples. */
export async function copyWildcardText(text: string) {
  await navigator.clipboard.writeText(text)
}
