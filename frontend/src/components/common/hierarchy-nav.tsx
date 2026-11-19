import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { SidebarItem, type SidebarItemProps } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'

export type HierarchyNodeId = number | string

const EMPTY_EXPANDED_IDS: HierarchyNodeId[] = []

/** How long a drag must rest on a collapsed row before `expandOnDragHover` opens it (about Explorer's delay). */
export const DRAG_HOVER_EXPAND_MS = 700

/** Set on every focusable row: the tree it belongs to (arrow keys move over these) and the item id (to find a parent). */
const NAV_TREE_ATTRIBUTE = 'data-hierarchy-nav'
const NAV_ROW_ATTRIBUTE = 'data-hierarchy-row'

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
  /** A drag resting on a collapsed row with children opens it after `DRAG_HOVER_EXPAND_MS`; leaving the row cancels. */
  expandOnDragHover?: boolean
  /** Controlled expansion: the ids of the open rows. Omit it and the tree keeps its own state (`defaultExpandedIds` seeds that). */
  expandedIds?: HierarchyNodeId[]
  /**
   * With `expandedIds`: rows to open (`expanded` true) or fold. Called for the chevron, Left/Right, a row click, a drag
   * resting on a row and the ancestors of a revealed selection. Deltas, so a stale call cannot undo another change.
   */
  onExpandedChange?: (ids: HierarchyNodeId[], expanded: boolean) => void
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

/**
 * Whether a `variant="sidebar"` tree over these items reserves the chevron column (it does as soon as one item has a
 * parent among the items). Sibling `SidebarItem` rows next to such a tree pass `depth={reserves ? 1 : 0}` to line up.
 * Use the same `getId` / `getParentId` the tree gets.
 */
export function hierarchyReservesToggleColumn<T>(items: T[], getId: (item: T) => HierarchyNodeId, getParentId: (item: T) => HierarchyNodeId | null | undefined) {
  const ids = new Set(items.map(getId))
  return items.some((item) => {
    const parentId = getParentId(item)
    return parentId != null && ids.has(parentId)
  })
}

/** The chevron that folds a row in place without selecting it; `compact` is the one laid over a sidebar row. */
function ExpandToggle({ expanded, onToggle, compact = false, className, style }: {
  expanded: boolean
  onToggle: () => void
  compact?: boolean
  className?: string
  style?: CSSProperties
}) {
  const { t } = useI18n()

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon-xs' : 'icon-sm'}
      // eslint-disable-next-line shadcn/no-restyle -- a tree chevron folds rows in place; without this every expanded node keeps ghost's open-popup fill
      className={cn('aria-expanded:bg-transparent aria-expanded:hover:bg-fill', className)}
      style={style}
      // The sidebar chevron is for pointer and touch; keyboard users fold with Left/Right on the row.
      tabIndex={compact ? -1 : undefined}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}
    >
      <ChevronRight className={cn(compact ? 'size-3.5' : 'size-4', 'transition-transform', expanded && 'rotate-90')} />
    </Button>
  )
}

/**
 * Render a reusable recursive navigation tree with optional expand/collapse behavior.
 * Arrow keys move over the visible rows (Up/Down, Home/End, Right opens or enters, Left closes or leaves).
 */
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
  expandOnDragHover = false,
  expandedIds: controlledIds,
  onExpandedChange,
  defaultExpandedIds = EMPTY_EXPANDED_IDS,
  className,
  getItemMenu,
}: HierarchyNavProps<T>) {
  const treeId = useId()
  const itemsByParentId = useMemo(() => buildHierarchyMap(items, getId, getParentId, sortItems, variant !== 'sidebar'), [items, getId, getParentId, sortItems, variant])
  const parentById = useMemo(
    () => new Map(items.map((item) => [getId(item), getParentId(item) ?? null] as const)),
    [items, getId, getParentId],
  )
  // The sidebar variant always folds; the default one only when `expandable`.
  const collapsible = variant === 'sidebar' || expandable
  // Room for the chevron column, only in a tree that has something to fold (so a flat list keeps its look).
  const reserveToggle = variant === 'sidebar' && hierarchyReservesToggleColumn(items, getId, getParentId)
  const [ownExpandedIds, setOwnExpandedIds] = useState<Set<HierarchyNodeId>>(() => new Set([...defaultExpandedIds, ...collectAncestorIds(parentById, selectedId)]))
  const controlled = controlledIds !== undefined
  const expandedIds = controlledIds === undefined ? ownExpandedIds : new Set(controlledIds)

  // A selection (picked, routed, or an item that loads later or moves) opens its ancestors once; folding them is then the user's call.
  const revealId = selectedId != null && parentById.has(selectedId) ? selectedId : null
  const revealParentId = revealId === null ? null : parentById.get(revealId) ?? null
  const [revealed, setRevealed] = useState({ id: revealId, parentId: revealParentId })
  if (revealed.id !== revealId || revealed.parentId !== revealParentId) {
    setRevealed({ id: revealId, parentId: revealParentId })
    const ancestors = collectAncestorIds(parentById, revealId)
    if (!controlled && ancestors.some((id) => !expandedIds.has(id))) {
      setOwnExpandedIds(new Set([...expandedIds, ...ancestors]))
    }
  }

  // The owner's state cannot change while this renders: a controlled tree opens a revealed selection's ancestors after the commit.
  useEffect(() => {
    if (!controlled) {
      return
    }

    const closed = collectAncestorIds(parentById, revealed.id).filter((id) => !expandedIds.has(id))
    if (closed.length > 0) {
      onExpandedChange?.(closed, true)
    }
  // Once per reveal: an ancestor the user folds afterwards stays folded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed])

  useEffect(() => {
    if (controlled || !expandable || defaultExpandedIds.length === 0) {
      return
    }

    setOwnExpandedIds((current) => {
      if (defaultExpandedIds.every((id) => current.has(id))) {
        return current
      }
      const next = new Set(current)
      for (const id of defaultExpandedIds) {
        next.add(id)
      }
      return next
    })
  }, [defaultExpandedIds, expandable, controlled])

  const toggleExpanded = (itemId: HierarchyNodeId) => {
    if (controlled) {
      onExpandedChange?.([itemId], !expandedIds.has(itemId))
      return
    }

    setOwnExpandedIds((current) => {
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
    if (controlled) {
      if (!expandedIds.has(itemId)) {
        onExpandedChange?.([itemId], true)
      }
      return
    }

    setOwnExpandedIds((current) => {
      if (current.has(itemId)) {
        return current
      }
      const next = new Set(current)
      next.add(itemId)
      return next
    })
  }

  const dragExpandRef = useRef<{ id: HierarchyNodeId; timer: number } | null>(null)

  useEffect(() => () => window.clearTimeout(dragExpandRef.current?.timer), [])

  const cancelDragExpand = () => {
    window.clearTimeout(dragExpandRef.current?.timer)
    dragExpandRef.current = null
  }

  const startDragExpand = (itemId: HierarchyNodeId) => {
    if (dragExpandRef.current?.id === itemId) {
      return
    }

    cancelDragExpand()
    dragExpandRef.current = {
      id: itemId,
      timer: window.setTimeout(() => {
        dragExpandRef.current = null
        expandItem(itemId)
      }, DRAG_HOVER_EXPAND_MS),
    }
  }

  const isDescendantRow = (row: HTMLElement | undefined, ancestorId: HierarchyNodeId) => {
    const rowId = row?.getAttribute(NAV_ROW_ATTRIBUTE)
    let current = Array.from(parentById.keys()).find((id) => String(id) === rowId)
    for (let steps = 0; current != null && steps < parentById.size; steps += 1) {
      current = parentById.get(current) ?? undefined
      if (current === ancestorId) {
        return true
      }
    }
    return false
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, itemId: HierarchyNodeId, parentId: HierarchyNodeId | null, hasChildren: boolean, isExpanded: boolean) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) {
      return
    }

    // The rendered rows are the visible ones, in tree order.
    const rows = Array.from(event.currentTarget.ownerDocument.querySelectorAll<HTMLElement>(`[${NAV_TREE_ATTRIBUTE}="${treeId}"]`))
    const index = rows.findIndex((row) => event.currentTarget.contains(row))
    let target: HTMLElement | undefined

    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1]
        break
      case 'ArrowUp':
        target = rows[index - 1]
        break
      case 'Home':
        target = rows[0]
        break
      case 'End':
        target = rows[rows.length - 1]
        break
      case 'ArrowRight':
        if (!hasChildren) {
          return
        }
        if (collapsible && !isExpanded) {
          event.preventDefault()
          expandItem(itemId)
          return
        }
        // Only enter the subtree: the next focusable row may belong to a later sibling when the children are not focusable.
        if (isDescendantRow(rows[index + 1], itemId)) {
          target = rows[index + 1]
        }
        break
      case 'ArrowLeft':
        if (hasChildren && isExpanded && collapsible) {
          event.preventDefault()
          toggleExpanded(itemId)
          return
        }
        if (parentId === null) {
          return
        }
        target = rows.find((row) => row.getAttribute(NAV_ROW_ATTRIBUTE) === String(parentId))
        break
      default:
        return
    }

    event.preventDefault()
    target?.focus()
  }

  const renderNodes = (parentId: HierarchyNodeId | null, depth: number): ReactNode => {
    const nodes = itemsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    const Row = variant === 'sidebar' ? Fragment : 'div'
    const rows = nodes.map((item) => {
          const itemId = getId(item)
          const hasChildren = (itemsByParentId.get(itemId) ?? []).length > 0
          const isSelected = selectedId === itemId
          const isExpanded = !collapsible || expandedIds.has(itemId)
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
          // The row's own attributes also sit on the element that holds its chevron, so a delegated drop finds the row over the chevron too.
          const rowAttributes = getItemDataAttributes?.(item, state)
          const navAttributes = { [NAV_TREE_ATTRIBUTE]: treeId, [NAV_ROW_ATTRIBUTE]: String(itemId) }
          const rowInteraction = {
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleRowKeyDown(event, itemId, parentId, hasChildren, isExpanded),
            ...(expandOnDragHover && hasChildren && collapsible && !isExpanded
              ? {
                onDragOver: () => startDragExpand(itemId),
                onDragLeave: (event: DragEvent<HTMLElement>) => {
                  if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) cancelDragExpand()
                },
                onDrop: cancelDragExpand,
              }
              : null),
          }
          const itemEventHandlers = {
            ...rowAttributes,
            onPointerEnter: (event: PointerEvent<HTMLElement>) => onItemPointerEnter?.(item, state, event.currentTarget, event),
            onPointerLeave: (event: PointerEvent<HTMLElement>) => onItemPointerLeave?.(item, state, event.currentTarget, event),
            onFocus: (event: FocusEvent<HTMLElement>) => onItemFocus?.(item, state, event.currentTarget, event),
            onBlur: (event: FocusEvent<HTMLElement>) => onItemBlur?.(item, state, event.currentTarget, event),
          }

          return (
            <Row key={String(itemId)}>
              <ActionContextMenu entries={getItemMenu?.(item, state) ?? []}>
                {variant === 'sidebar' ? (
                  // The chevron cannot live inside the row button, so it overlays it from a sibling; the row reserves its column.
                  <div {...rowAttributes} {...rowInteraction} className="group/row relative">
                    <SidebarItem
                      {...itemEventHandlers}
                      {...navAttributes}
                      // eslint-disable-next-line shadcn/no-restyle -- keeps SidebarItem's own hover look while the pointer is on the overlaid chevron
                      className="group-hover/row:bg-fill group-hover/row:text-foreground"
                      icon={getIcon?.(item, { open: hasChildren && isExpanded, hasChildren }) ?? (hasChildren && isExpanded ? FolderOpen : Folder)}
                      label={getLabel(item)}
                      count={getCount?.(item)}
                      active={isSelected}
                      depth={depth + baseDepth + (reserveToggle ? 1 : 0)}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      onClick={() => {
                        if (hasChildren) {
                          if (isSelected && isExpanded) toggleExpanded(itemId)
                          else expandItem(itemId)
                        }
                        if (selectable) onSelect(item)
                      }}
                    />
                    {hasChildren ? (
                      <ExpandToggle
                        compact
                        expanded={isExpanded}
                        onToggle={() => toggleExpanded(itemId)}
                        className="absolute top-1.5"
                        style={{ left: `calc(0.125rem + ${depth + baseDepth} * 1rem)` }}
                      />
                    ) : null}
                  </div>
                ) : expandable ? (
                  <div {...rowAttributes} {...rowInteraction} className="flex min-w-0 items-center gap-1 [-webkit-touch-callout:none]" style={{ paddingLeft: `${depth * 14}px` }}>
                    {hasChildren ? (
                      <ExpandToggle expanded={isExpanded} onToggle={() => toggleExpanded(itemId)} />
                    ) : (
                      <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                    )}

                    {selectable || hasChildren ? (
                      <Button
                        type="button"
                        variant="nav"
                        size="sm"
                        {...itemEventHandlers}
                        {...navAttributes}
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
                    {...navAttributes}
                    {...rowInteraction}
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
