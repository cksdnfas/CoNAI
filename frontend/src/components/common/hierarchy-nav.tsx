import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HierarchyNodeId = number | string

interface HierarchyNavProps<T> {
  items: T[]
  selectedId?: HierarchyNodeId | null
  onSelect: (item: T) => void
  getId: (item: T) => HierarchyNodeId
  getParentId: (item: T) => HierarchyNodeId | null | undefined
  getLabel: (item: T) => ReactNode
  sortItems?: (left: T, right: T) => number
  renderIcon?: (item: T, hasChildren: boolean, isSelected: boolean) => ReactNode
  className?: string
}

/** Build a parent-to-children map for hierarchy navigation rendering. */
function buildHierarchyMap<T>(items: T[], getParentId: (item: T) => HierarchyNodeId | null | undefined, sortItems?: (left: T, right: T) => number) {
  const map = new Map<HierarchyNodeId | null, T[]>()

  for (const item of items) {
    const parentId = getParentId(item) ?? null
    const siblings = map.get(parentId) ?? []
    siblings.push(item)
    map.set(parentId, siblings)
  }

  if (sortItems) {
    for (const siblings of map.values()) {
      siblings.sort(sortItems)
    }
  }

  return map
}

/** Render a reusable recursive navigation tree with selection styling. */
export function HierarchyNav<T>({
  items,
  selectedId,
  onSelect,
  getId,
  getParentId,
  getLabel,
  sortItems,
  renderIcon,
  className,
}: HierarchyNavProps<T>) {
  const itemsByParentId = useMemo(() => buildHierarchyMap(items, getParentId, sortItems), [items, getParentId, sortItems])

  const renderNodes = (parentId: HierarchyNodeId | null, depth: number): ReactNode => {
    const nodes = itemsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className={cn('space-y-1', depth === 0 && className)}>
        {nodes.map((item) => {
          const itemId = getId(item)
          const hasChildren = (itemsByParentId.get(itemId) ?? []).length > 0
          const isSelected = selectedId === itemId

          return (
            <div key={String(itemId)}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-surface-container text-primary'
                    : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                )}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
              >
                {renderIcon ? renderIcon(item, hasChildren, isSelected) : null}
                <span className="truncate">{getLabel(item)}</span>
              </button>
              {renderNodes(itemId, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return <>{renderNodes(null, 0)}</>
}
