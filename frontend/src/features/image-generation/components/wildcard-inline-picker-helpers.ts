import type { WildcardItemRecord, WildcardRecord, WildcardTool } from '@/lib/api'

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

export type ActiveWildcardQuery = {
  start: number
  end: number
  query: string
}

export type WildcardInsertionRange = {
  start: number
  end: number
}

export type WildcardFilterMode = 'available-only' | 'all'

const RECENT_WILDCARD_KEY_PREFIX = 'conai.wildcards.recent.'
const FILTER_MODE_KEY_PREFIX = 'conai.wildcards.filter-mode.'
export const MAX_RECENT_WILDCARDS = 8

/** Read the persisted inline picker filter mode for one wildcard tool. */
export function readStoredWildcardFilterMode(tool: WildcardTool): WildcardFilterMode {
  if (typeof window === 'undefined') {
    return 'available-only'
  }

  const value = window.localStorage.getItem(`${FILTER_MODE_KEY_PREFIX}${tool}`)
  return value === 'all' ? 'all' : 'available-only'
}

/** Persist the inline picker filter mode for one wildcard tool. */
export function writeStoredWildcardFilterMode(tool: WildcardTool, mode: WildcardFilterMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(`${FILTER_MODE_KEY_PREFIX}${tool}`, mode)
}

/** Read the recent wildcard names for one tool from local storage. */
export function readStoredRecentWildcards(tool: WildcardTool): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(`${RECENT_WILDCARD_KEY_PREFIX}${tool}`)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/** Persist the bounded recent wildcard list for one tool. */
export function writeStoredRecentWildcards(tool: WildcardTool, names: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(`${RECENT_WILDCARD_KEY_PREFIX}${tool}`, JSON.stringify(names.slice(0, MAX_RECENT_WILDCARDS)))
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

/** Resolve the active ++ wildcard token around the current caret position. */
export function resolveActiveWildcardQuery(value: string, caretPosition: number): ActiveWildcardQuery | null {
  const prefix = value.slice(0, Math.max(0, caretPosition))
  const tokenStart = prefix.lastIndexOf('++')

  if (tokenStart < 0) {
    return null
  }

  if (tokenStart > 0) {
    const previousCharacter = prefix[tokenStart - 1]
    if (!/[\s,(]/.test(previousCharacter)) {
      return null
    }
  }

  const query = prefix.slice(tokenStart + 2)
  if (query.includes('++')) {
    return null
  }

  if (/[\s,()]/.test(query)) {
    return null
  }

  return {
    start: tokenStart,
    end: caretPosition,
    query,
  }
}

/** Count wildcard items available for one tool. */
export function countWildcardItemsForTool(items: WildcardItemRecord[], tool: WildcardTool) {
  return items.filter((item) => item.tool === tool).length
}

/** Build the next prompt value for inline wildcard/preprocess insertion, auto-adding comma separators when chaining entries. */
export function buildWildcardInsertion(value: string, insertionText: string, range: WildcardInsertionRange) {
  const before = value.slice(0, range.start)
  const after = value.slice(range.end)
  const needsLeadingSeparator = before.trim().length > 0 && !/[\s,(]$/.test(before)
  const insertedText = `${needsLeadingSeparator ? ', ' : ''}${insertionText}`

  return {
    nextValue: `${before}${insertedText}${after}`,
    nextCaretPosition: before.length + insertedText.length,
  }
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
