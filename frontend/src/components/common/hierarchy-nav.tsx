import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getNavigationItemClassName } from './navigation-item'

export type HierarchyNodeId = number | string

export interface HierarchyNavItemState {
  depth: number
  hasChildren: boolean
  isExpanded: boolean
  isSelected: boolean
  isSelectable: boolean
}

interface HierarchyNavProps<T> {
  items: T[]
  selectedId?: HierarchyNodeId | null
  onSelect: (item: T) => void
  getId: (item: T) => HierarchyNodeId
  getParentId: (item: T) => HierarchyNodeId | null | undefined
  getLabel: (item: T) => ReactNode
  sortItems?: (left: T, right: T) => number
  renderIcon?: (item: T, state: HierarchyNavItemState) => ReactNode
  isItemSelectable?: (item: T, hasChildren: boolean) => boolean
  getItemClassName?: (item: T, state: HierarchyNavItemState) => string | undefined
  expandable?: boolean
  expandOnSelect?: boolean | ((item: T, state: HierarchyNavItemState) => boolean)
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

/** Collect the ancestor ids that should stay expanded for the selected item. */
function collectAncestorIds(parentById: Map<HierarchyNodeId, HierarchyNodeId | null>, selectedId?: HierarchyNodeId | null) {
  if (selectedId == null) {
    return []
  }

  const ancestors: HierarchyNodeId[] = []
  let currentParentId = parentById.get(selectedId) ?? null

  while (currentParentId != null) {
    ancestors.unshift(currentParentId)
    currentParentId = parentById.get(currentParentId) ?? null
  }

  return ancestors
}

/** Render a reusable recursive navigation tree with optional expand/collapse behavior. */
export function HierarchyNav<T>({
  items,
  selectedId,
  onSelect,
  getId,
  getParentId,
  getLabel,
  sortItems,
  renderIcon,
  isItemSelectable,
  getItemClassName,
  expandable = false,
  expandOnSelect,
  className,
}: HierarchyNavProps<T>) {
  const itemsByParentId = useMemo(() => buildHierarchyMap(items, getParentId, sortItems), [items, getParentId, sortItems])
  const parentById = useMemo(
    () => new Map(items.map((item) => [getId(item), getParentId(item) ?? null] as const)),
    [items, getId, getParentId],
  )
  const [expandedIds, setExpandedIds] = useState<Set<HierarchyNodeId>>(() => new Set(collectAncestorIds(parentById, selectedId)))

  useEffect(() => {
    if (!expandable) {
      return
    }

    const ancestorIds = collectAncestorIds(parentById, selectedId)
    if (ancestorIds.length === 0) {
      return
    }

    setExpandedIds((current) => {
      const next = new Set(current)
      for (const ancestorId of ancestorIds) {
        next.add(ancestorId)
      }
      return next
    })
  }, [expandable, parentById, selectedId])

  const toggleExpanded = (itemId: HierarchyNodeId) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const expandItem = (itemId: HierarchyNodeId) => {
    setExpandedIds((current) => {
      if (current.has(itemId)) {
        return current
      }
      const next = new Set(current)
      next.add(itemId)
      return next
    })
  }

  const renderNodes = (parentId: HierarchyNodeId | null, depth: number): ReactNode => {
    const nodes = itemsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className={cn('space-y-1', depth === 0 && className)}>
        {nodes.map((item) => {
          const itemId = getId(item)
          const hasChildren = (itemsByParentId.get(itemId) ?? []).length > 0
          const isSelected = selectedId === itemId
          const isExpanded = !expandable || expandedIds.has(itemId)
          const selectable = isItemSelectable ? isItemSelectable(item, hasChildren) : true
          const state: HierarchyNavItemState = {
            depth,
            hasChildren,
            isExpanded,
            isSelected,
            isSelectable: selectable,
          }
          const shouldExpandOnSelect = typeof expandOnSelect === 'function' ? expandOnSelect(item, state) : expandOnSelect ?? expandable
          const itemClassName = getItemClassName?.(item, state)
          const content = (
            <>
              {renderIcon ? renderIcon(item, state) : null}
              <div className="min-w-0 flex-1">{getLabel(item)}</div>
            </>
          )

          return (
            <div key={String(itemId)}>
              {expandable ? (
                <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(itemId)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
                      aria-label={isExpanded ? '접기' : '펼치기'}
                      title={isExpanded ? '접기' : '펼치기'}
                    >
                      <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                    </button>
                  ) : (
                    <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                  )}

                  {selectable || hasChildren ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (hasChildren && shouldExpandOnSelect) {
                          expandItem(itemId)
                        }
                        if (selectable) {
                          onSelect(item)
                        }
                      }}
                      className={getNavigationItemClassName({
                        active: isSelected,
                        density: 'sm',
                        fullWidth: false,
                        className: cn('inline-flex max-w-full flex-1 items-center gap-2', itemClassName),
                      })}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={cn('inline-flex max-w-full flex-1 items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground/45', itemClassName)}>
                      {content}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={getNavigationItemClassName({
                    active: isSelected,
                    className: cn('flex items-center gap-2', itemClassName),
                  })}
                  style={{ paddingLeft: `${12 + depth * 14}px` }}
                >
                  {content}
                </button>
              )}

              {hasChildren && isExpanded ? renderNodes(itemId, depth + 1) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return <>{renderNodes(null, 0)}</>
}
