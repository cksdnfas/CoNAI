import { useCallback, useMemo, useState } from 'react'

export interface WildcardTreeNode {
  id: number
  name: string
  children?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toNodeId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

function toNodeChildren(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
}

export function collectWildcardTreeIds(nodes: unknown): number[] {
  if (!Array.isArray(nodes)) {
    return []
  }

  const result: number[] = []

  const walk = (input: unknown[]): void => {
    for (const item of input) {
      if (!isRecord(item)) {
        continue
      }

      const id = toNodeId(item.id)
      if (id !== null) {
        result.push(id)
      }

      const children = toNodeChildren(item.children)
      if (children.length > 0) {
        walk(children)
      }
    }
  }

  walk(nodes)
  return result
}

export function sortWildcardNodesByHierarchy<T extends { name: string; children?: unknown }>(a: T, b: T): number {
  const aHasChildren = Array.isArray(a.children) && a.children.length > 0
  const bHasChildren = Array.isArray(b.children) && b.children.length > 0

  if (aHasChildren && !bHasChildren) {
    return -1
  }

  if (!aHasChildren && bHasChildren) {
    return 1
  }

  return a.name.localeCompare(b.name)
}

export function useWildcardTree<TNode extends WildcardTreeNode>(initialData: TNode[] = []) {
  const [selectedNode, setSelectedNode] = useState<TNode | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const handleSelect = useCallback((node: TNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleToggle = useCallback((id: number) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    setExpandedIds(new Set(collectWildcardTreeIds(initialData)))
  }, [initialData])

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set())
  }, [])

  const selectFirstNode = useCallback(() => {
    if (initialData.length > 0 && selectedNode === null) {
      setSelectedNode(initialData[0])
    }
  }, [initialData, selectedNode])

  const clearSelection = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const totalCount = useMemo(() => collectWildcardTreeIds(initialData).length, [initialData])

  return {
    selectedNode,
    expandedIds,
    totalCount,
    handleSelect,
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    sortNodesByHierarchy: sortWildcardNodesByHierarchy<TNode>,
    selectFirstNode,
    clearSelection,
    setSelectedNode,
  }
}
