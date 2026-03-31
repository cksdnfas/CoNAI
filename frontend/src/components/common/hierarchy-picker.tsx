import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getNavigationItemClassName } from './navigation-item'
import { HierarchyNav, type HierarchyNodeId, type HierarchyNavItemState } from './hierarchy-nav'

interface HierarchyPickerProps<T> {
  items: T[]
  selectedId?: HierarchyNodeId | null
  onSelectRoot?: () => void
  onSelect: (item: T) => void
  getId: (item: T) => HierarchyNodeId
  getParentId: (item: T) => HierarchyNodeId | null | undefined
  getLabel: (item: T) => ReactNode
  sortItems?: (left: T, right: T) => number
  renderIcon?: (item: T, state: HierarchyNavItemState) => ReactNode
  className?: string
  bodyClassName?: string
  rootLabel?: ReactNode
  showRootOption?: boolean
}

/** Render a shared tree picker used for hierarchy-based parent selection. */
export function HierarchyPicker<T>({
  items,
  selectedId,
  onSelectRoot,
  onSelect,
  getId,
  getParentId,
  getLabel,
  sortItems,
  renderIcon,
  className,
  bodyClassName,
  rootLabel = '루트 그룹',
  showRootOption = true,
}: HierarchyPickerProps<T>) {
  return (
    <div className={cn('rounded-sm border border-border/70 bg-surface-lowest p-2', className)}>
      {showRootOption ? (
        <button
          type="button"
          onClick={onSelectRoot}
          className={getNavigationItemClassName({
            active: selectedId == null,
            className: 'flex items-center justify-between',
          })}
        >
          <span>{rootLabel}</span>
        </button>
      ) : null}

      <div className={cn(showRootOption ? 'mt-2 max-h-72 overflow-y-auto pr-1' : 'max-h-72 overflow-y-auto pr-1', bodyClassName)}>
        <HierarchyNav
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          getId={getId}
          getParentId={getParentId}
          getLabel={getLabel}
          sortItems={sortItems}
          renderIcon={renderIcon}
          expandable
        />
      </div>
    </div>
  )
}
