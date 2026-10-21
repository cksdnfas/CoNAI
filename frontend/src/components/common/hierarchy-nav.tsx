import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { SidebarItem, type SidebarItemProps } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'

export type HierarchyNodeId = number | string

const EMPTY_EXPANDED_IDS: HierarchyNodeId[] = []

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
  variant?: 'default' | 'sidebar'
  getCount?: (item: T) => ReactNode
  getIcon?: (item: T, state: { open: boolean; hasChildren: boolean }) => SidebarItemProps['icon']
  baseDepth?: number
  sortItems?: (left: T, right: T) => number
  renderIcon?: (item: T, state: HierarchyNavItemState) => ReactNode
  isItemSelectable?: (item: T, hasChildren: boolean) => boolean
  /** Extra `data-*` attributes for a row (e.g. a drop-target id for delegated drag-and-drop). */
  getItemDataAttributes?: (item: T, state: HierarchyNavItemState) => Record<`data-${string}`, string | undefined>
  onItemPointerEnter?: (item: T, state: HierarchyNavItemState, target: HTMLElement, event: PointerEvent<HTMLElement>) => void
  onItemPointerLeave?: (item: T, state: HierarchyNavItemState, target: HTMLElement, event: PointerEvent<HTMLElement>) => void
  onItemFocus?: (item: T, state: HierarchyNavItemState, target: HTMLElement, event: FocusEvent<HTMLElement>) => void
  onItemBlur?: (item: T, state: HierarchyNavItemState, target: HTMLElement, event: FocusEvent<HTMLElement>) => void
  expandable?: boolean
  expandOnSelect?: boolean | ((item: T, state: HierarchyNavItemState) => boolean)
  defaultExpandedIds?: HierarchyNodeId[]
  className?: string
  /** A row's actions, opened by right-click / long-press on the row. */
  getItemMenu?: (item: T, state: HierarchyNavItemState) => ActionMenuEntry[]
}

/** Build a parent-to-children map for hierarchy navigation rendering. */
function buildHierarchyMap<T>(items: T[], getId: (item: T) => HierarchyNodeId, getParentId: (item: T) => HierarchyNodeId | null | undefined, sortItems?: (left: T, right: T) => number, parentsFirst = true) {
  const map = new Map<HierarchyNodeId | null, T[]>()
  const ids = new Set(items.map(getId))

  for (const item of items) {
    const rawParentId = getParentId(item) ?? null
    const parentId = rawParentId !== null && ids.has(rawParentId) ? rawParentId : null
    const siblings = map.get(parentId) ?? []
    siblings.push(item)
    map.set(parentId, siblings)
  }

  for (const siblings of map.values()) {
    siblings.sort((left, right) => {
      const leftHasChildren = (map.get(getId(left)) ?? []).length > 0
      const rightHasChildren = (map.get(getId(right)) ?? []).length > 0

      if (parentsFirst && leftHasChildren !== rightHasChildren) {
        return leftHasChildren ? -1 : 1
      }

      return sortItems?.(left, right) ?? 0
    })
  }

  return map
}

/** Collect the ancestor ids that should stay expanded for the selected item. */
function collectAncestorIds(parentById: Map<HierarchyNodeId, HierarchyNodeId | null>, selectedId?: HierarchyNodeId | null) {
  if (selectedId == null) {
    return []
  }

  const ancestors: HierarchyNodeId[] = []
  const visited = new Set<HierarchyNodeId>()
  let currentParentId = parentById.get(selectedId) ?? null

  while (currentParentId != null && !visited.has(currentParentId)) {
    visited.add(currentParentId)
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
  variant = 'default',
  getCount,
  getIcon,
  baseDepth = 0,
  sortItems,
  renderIcon,
  isItemSelectable,
  getItemDataAttributes,
  onItemPointerEnter,
  onItemPointerLeave,
  onItemFocus,
  onItemBlur,
  expandable = false,
  expandOnSelect,
  defaultExpandedIds = EMPTY_EXPANDED_IDS,
  className,
  getItemMenu,
}: HierarchyNavProps<T>) {
  const { t } = useI18n()
  const itemsByParentId = useMemo(() => buildHierarchyMap(items, getId, getParentId, sortItems, variant !== 'sidebar'), [items, getId, getParentId, sortItems, variant])
  const parentById = useMemo(
    () => new Map(items.map((item) => [getId(item), getParentId(item) ?? null] as const)),
    [items, getId, getParentId],
  )
  const [expandedIds, setExpandedIds] = useState<Set<HierarchyNodeId>>(() => new Set([...defaultExpandedIds, ...(variant === 'sidebar' ? [] : collectAncestorIds(parentById, selectedId))]))
  const selectedAncestors = new Set(collectAncestorIds(parentById, selectedId))

  useEffect(() => {
    if (!expandable) {
      return
    }

    const idsToExpand = [...defaultExpandedIds, ...collectAncestorIds(parentById, selectedId)]
    if (idsToExpand.length === 0) {
      return
    }

    setExpandedIds((current) => {
      if (idsToExpand.every((id) => current.has(id))) {
        return current
      }
      const next = new Set(current)
      for (const id of idsToExpand) {
        next.add(id)
      }
      return next
    })
  }, [defaultExpandedIds, expandable, parentById, selectedId])

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

    const Row = variant === 'sidebar' ? Fragment : 'div'
    const rows = nodes.map((item) => {
          const itemId = getId(item)
          const hasChildren = (itemsByParentId.get(itemId) ?? []).length > 0
          const isSelected = selectedId === itemId
          const isExpanded = variant === 'sidebar'
            ? expandedIds.has(itemId) || selectedAncestors.has(itemId)
            : !expandable || expandedIds.has(itemId)
          const selectable = isItemSelectable ? isItemSelectable(item, hasChildren) : true
          const state: HierarchyNavItemState = {
            depth: depth + baseDepth,
            hasChildren,
            isExpanded,
            isSelected,
            isSelectable: selectable,
          }
          const shouldExpandOnSelect = typeof expandOnSelect === 'function' ? expandOnSelect(item, state) : expandOnSelect ?? expandable
          const content = (
            <>
              {renderIcon ? (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {renderIcon(item, state)}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">{getLabel(item)}</div>
            </>
          )
          const itemEventHandlers = {
            ...getItemDataAttributes?.(item, state),
            onPointerEnter: (event: PointerEvent<HTMLElement>) => onItemPointerEnter?.(item, state, event.currentTarget, event),
            onPointerLeave: (event: PointerEvent<HTMLElement>) => onItemPointerLeave?.(item, state, event.currentTarget, event),
            onFocus: (event: FocusEvent<HTMLElement>) => onItemFocus?.(item, state, event.currentTarget, event),
            onBlur: (event: FocusEvent<HTMLElement>) => onItemBlur?.(item, state, event.currentTarget, event),
          }

          return (
            <Row key={String(itemId)}>
              <ActionContextMenu entries={getItemMenu?.(item, state) ?? []}>
                {variant === 'sidebar' ? (
                  <SidebarItem
                    {...itemEventHandlers}
                    icon={getIcon?.(item, { open: hasChildren && isExpanded, hasChildren }) ?? (hasChildren && isExpanded ? FolderOpen : Folder)}
                    label={getLabel(item)}
                    count={getCount?.(item)}
                    active={isSelected}
                    depth={depth + baseDepth}
                    aria-expanded={hasChildren ? isExpanded : undefined}
                    onClick={() => {
                      if (hasChildren) {
                        if (isSelected && isExpanded) toggleExpanded(itemId)
                        else expandItem(itemId)
                      }
                      if (selectable) onSelect(item)
                    }}
                  />
                ) : expandable ? (
                  <div className="flex min-w-0 items-center gap-1 [-webkit-touch-callout:none]" style={{ paddingLeft: `${depth * 14}px` }}>
                    {hasChildren ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        // eslint-disable-next-line shadcn/no-restyle -- a tree chevron folds rows in place; without this every expanded node keeps ghost's open-popup fill
                        className="aria-expanded:bg-transparent aria-expanded:hover:bg-fill"
                        onClick={() => toggleExpanded(itemId)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}
                      >
                        <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                      </Button>
                    ) : (
                      <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                    )}

                    {selectable || hasChildren ? (
                      <Button
                        type="button"
                        variant="nav"
                        size="sm"
                        {...itemEventHandlers}
                        onClick={() => {
                          if (hasChildren && shouldExpandOnSelect) {
                            expandItem(itemId)
                          }
                          if (selectable) {
                            onSelect(item)
                          }
                        }}
                        data-active={isSelected ? 'true' : undefined}
                        aria-current={isSelected ? 'true' : undefined}
                        className="min-w-0 flex-1"
                      >
                        {content}
                      </Button>
                    ) : (
                      <div
                        {...itemEventHandlers}
                        className="inline-flex h-8 min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-sm px-2 text-sm text-muted-foreground/45"
                      >
                        {content}
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="nav"
                    {...itemEventHandlers}
                    onClick={() => onSelect(item)}
                    data-active={isSelected ? 'true' : undefined}
                    aria-current={isSelected ? 'true' : undefined}
                    className="min-w-0"
                    style={{ paddingLeft: `${12 + depth * 14}px` }}
                  >
                    {content}
                  </Button>
                )}
              </ActionContextMenu>

              {hasChildren && isExpanded ? renderNodes(itemId, depth + 1) : null}
            </Row>
          )
        })
    return variant === 'sidebar' ? <>{rows}</> : <div className={depth === 0 ? className : undefined}>{rows}</div>
  }

  return <>{renderNodes(null, 0)}</>
}
