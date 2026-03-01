import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WildcardWithHierarchy } from '@/services/wildcard-api'

interface WildcardTreePanelProps {
  data: WildcardWithHierarchy[]
  selectedId: number | null
  expandedIds: Set<number>
  onSelect: (node: WildcardWithHierarchy) => void
  onToggle: (id: number) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  sortChildren: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number
  emptyMessage: string
}

function nodeMatchesSearch(node: WildcardWithHierarchy, searchTerm: string): boolean {
  const lowerSearch = searchTerm.toLowerCase()
  if (node.name.toLowerCase().includes(lowerSearch)) {
    return true
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return false
  }

  return node.children.some((child) => nodeMatchesSearch(child, searchTerm))
}

function filterTree(nodes: WildcardWithHierarchy[], searchTerm: string): WildcardWithHierarchy[] {
  if (searchTerm.trim().length === 0) {
    return nodes
  }

  return nodes
    .filter((node) => nodeMatchesSearch(node, searchTerm))
    .map((node) => ({
      ...node,
      children: Array.isArray(node.children) ? filterTree(node.children, searchTerm) : [],
    }))
}

function collectMatchingParentIds(nodes: WildcardWithHierarchy[], searchTerm: string, result: Set<number>): void {
  for (const node of nodes) {
    if (!Array.isArray(node.children) || node.children.length === 0) {
      continue
    }

    const hasMatchingChild = node.children.some((child) => nodeMatchesSearch(child, searchTerm))
    if (hasMatchingChild || node.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      result.add(node.id)
    }

    collectMatchingParentIds(node.children, searchTerm, result)
  }
}

interface TreeNodeProps {
  node: WildcardWithHierarchy
  level: number
  selectedId: number | null
  expandedIds: Set<number>
  onSelect: (node: WildcardWithHierarchy) => void
  onToggle: (id: number) => void
  sortChildren: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number
}

function TreeNode({ node, level, selectedId, expandedIds, onSelect, onToggle, sortChildren }: TreeNodeProps) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  const sortedChildren = hasChildren ? [...(node.children ?? [])].sort(sortChildren) : []

  return (
    <li>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => onToggle(node.id)}
          >
            {isExpanded ? '-' : '+'}
          </Button>
        ) : (
          <span className="inline-block h-7 w-7" aria-hidden="true" />
        )}

        <Button
          type="button"
          variant={isSelected ? 'secondary' : 'ghost'}
          className="h-7 justify-start px-2 text-left text-sm"
          style={{ marginLeft: level * 12 }}
          onClick={() => onSelect(node)}
        >
          {node.name}
        </Button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="ml-2 mt-1 space-y-1">
          {sortedChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              sortChildren={sortChildren}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function WildcardTreePanel({
  data,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onExpandAll,
  onCollapseAll,
  sortChildren,
  emptyMessage,
}: WildcardTreePanelProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredData = useMemo(() => {
    return filterTree(data, searchTerm)
  }, [data, searchTerm])

  const effectiveExpandedIds = useMemo(() => {
    if (searchTerm.trim().length === 0) {
      return expandedIds
    }

    const searchExpandedIds = new Set<number>()
    collectMatchingParentIds(data, searchTerm, searchExpandedIds)
    return new Set([...expandedIds, ...searchExpandedIds])
  }, [data, expandedIds, searchTerm])

  const sortedRootNodes = useMemo(() => {
    return [...filteredData].sort(sortChildren)
  }, [filteredData, sortChildren])

  return (
    <section className="flex h-full min-h-0 flex-col rounded-md border">
      <div className="border-b p-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onExpandAll}>
            Expand all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCollapseAll}>
            Collapse all
          </Button>
        </div>
      </div>

      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search..."
            className="pl-8 pr-8"
          />
          {searchTerm.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1"
              aria-label="Clear search"
              onClick={() => setSearchTerm('')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sortedRootNodes.length > 0 ? (
          <ul className="space-y-1" aria-label="Wildcard tree">
            {sortedRootNodes.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedId}
                expandedIds={effectiveExpandedIds}
                onSelect={onSelect}
                onToggle={onToggle}
                sortChildren={sortChildren}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground p-4 text-sm">{searchTerm ? 'No results found' : emptyMessage}</p>
        )}
      </div>
    </section>
  )
}
