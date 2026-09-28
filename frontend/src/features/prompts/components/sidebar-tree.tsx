import { useMemo, useState, type ReactNode } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { SidebarItem, type SidebarItemProps } from '@/components/ui/sidebar'

type SidebarTreeId = number | string

interface SidebarTreeProps<T> {
  items: T[]
  selectedId?: SidebarTreeId | null
  onSelect: (item: T) => void
  getId: (item: T) => SidebarTreeId
  getParentId: (item: T) => SidebarTreeId | null | undefined
  getLabel: (item: T) => ReactNode
  getCount?: (item: T) => ReactNode
  /** Row icon; undefined falls back to a folder (open while the row is expanded). */
  getIcon?: (item: T, state: { open: boolean; hasChildren: boolean }) => SidebarItemProps['icon']
  sortItems?: (left: T, right: T) => number
  defaultExpandedIds?: SidebarTreeId[]
  /** Indent added to every row (e.g. 1 when the tree sits under an "All" row). */
  baseDepth?: number
}

const EMPTY_IDS: SidebarTreeId[] = []

/**
 * Folder tree made of SidebarItem rows. Selecting a collapsed parent opens it; selecting the current parent again
 * folds it. Ancestors of the selected row stay open.
 */
export function SidebarTree<T>({
  items,
  selectedId,
  onSelect,
  getId,
  getParentId,
  getLabel,
  getCount,
  getIcon,
  sortItems,
  defaultExpandedIds = EMPTY_IDS,
  baseDepth = 0,
}: SidebarTreeProps<T>) {
  const { childrenByParent, parentById } = useMemo(() => {
    const ids = new Set(items.map(getId))
    const children = new Map<SidebarTreeId | null, T[]>()
    const parents = new Map<SidebarTreeId, SidebarTreeId | null>()
    for (const item of items) {
      const rawParent = getParentId(item) ?? null
      const parent = rawParent !== null && ids.has(rawParent) ? rawParent : null
      parents.set(getId(item), parent)
      const bucket = children.get(parent) ?? []
      bucket.push(item)
      children.set(parent, bucket)
    }
    if (sortItems) {
      for (const bucket of children.values()) bucket.sort(sortItems)
    }
    return { childrenByParent: children, parentById: parents }
  }, [getId, getParentId, items, sortItems])

  const [expanded, setExpanded] = useState<Set<SidebarTreeId>>(() => new Set(defaultExpandedIds))

  // Ancestors of the selected row are always shown open.
  const openAncestors = useMemo(() => {
    const open = new Set<SidebarTreeId>()
    let current = selectedId != null ? parentById.get(selectedId) ?? null : null
    while (current !== null && !open.has(current)) {
      open.add(current)
      current = parentById.get(current) ?? null
    }
    return open
  }, [parentById, selectedId])

  const isOpen = (id: SidebarTreeId) => expanded.has(id) || openAncestors.has(id)

  const handleSelect = (item: T, hasChildren: boolean) => {
    const id = getId(item)
    if (hasChildren) {
      setExpanded((current) => {
        const next = new Set(current)
        if (selectedId === id && isOpen(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    }
    onSelect(item)
  }

  const renderLevel = (parentId: SidebarTreeId | null, depth: number): ReactNode[] => (childrenByParent.get(parentId) ?? []).flatMap((item) => {
    const id = getId(item)
    const hasChildren = (childrenByParent.get(id)?.length ?? 0) > 0
    const open = hasChildren && isOpen(id)
    const row = (
      <SidebarItem
        key={String(id)}
        icon={getIcon?.(item, { open, hasChildren }) ?? (open ? FolderOpen : Folder)}
        label={getLabel(item)}
        count={getCount?.(item)}
        active={selectedId === id}
        depth={depth}
        aria-expanded={hasChildren ? open : undefined}
        onClick={() => handleSelect(item, hasChildren)}
      />
    )
    return open ? [row, ...renderLevel(id, depth + 1)] : [row]
  })

  return <>{renderLevel(null, baseDepth)}</>
}
