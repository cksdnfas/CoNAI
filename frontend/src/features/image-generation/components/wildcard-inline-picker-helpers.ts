import type { WildcardItemRecord, WildcardRecord, WildcardTool } from '@/lib/api-wildcards'

export type PromptWildcardTool = WildcardTool | 'codex'

export type FlattenedWildcardRecord = {
  id: number
  parentId: number | null
  name: string
  path: string[]
  type: WildcardRecord['type']
  isAutoCollected: boolean
  includeChildren: boolean
  onlyChildren: boolean
  items: WildcardItemRecord[]
}

/** Flatten the hierarchical wildcard tree into searchable inline picker records. */
export function flattenWildcardRecords(nodes: WildcardRecord[], parentPath: string[] = []): FlattenedWildcardRecord[] {
  const entries: FlattenedWildcardRecord[] = []

  for (const node of nodes) {
    const path = [...parentPath, node.name]
    entries.push({
      id: node.id,
      parentId: node.parent_id ?? null,
      name: node.name,
      path,
      type: node.type,
      isAutoCollected: node.is_auto_collected === 1,
      includeChildren: node.include_children === 1,
      onlyChildren: node.only_children === 1,
      items: node.items ?? [],
    })

    if (node.children && node.children.length > 0) {
      entries.push(...flattenWildcardRecords(node.children, path))
    }
  }

  return entries
}

export function resolvePreferredWildcardItemTool(items: WildcardItemRecord[], tool: PromptWildcardTool): WildcardTool {
  if (tool === 'codex') {
    return 'general'
  }

  if (tool === 'nai' || tool === 'comfyui') {
    return items.some((item) => item.tool === tool) ? tool : 'general'
  }

  return 'general'
}

/** Count wildcard items stored for one concrete storage tab. */
export function countStoredWildcardItemsForTool(items: WildcardItemRecord[], tool: WildcardTool) {
  return items.filter((item) => item.tool === tool).length
}

/** Count wildcard items available for one runtime tool, including General fallback. */
export function countWildcardItemsForTool(items: WildcardItemRecord[], tool: PromptWildcardTool) {
  const preferredTool = resolvePreferredWildcardItemTool(items, tool)
  return countStoredWildcardItemsForTool(items, preferredTool)
}

/** Score one flattened wildcard record against the normalized inline query. */
export function scoreWildcardMatch(record: FlattenedWildcardRecord, normalizedQuery: string) {
  if (!normalizedQuery) {
    return 0
  }

  const name = record.name.toLowerCase()
  const path = record.path.join(' / ').toLowerCase()

  if (name === normalizedQuery) {
    return 100
  }

  if (name.startsWith(normalizedQuery)) {
    return 80
  }

  if (name.includes(normalizedQuery)) {
    return 60
  }

  if (path.includes(normalizedQuery)) {
    return 40
  }

  return -1
}
