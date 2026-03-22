import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

export function GroupTree({ groups, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  const groupsByParentId = useMemo(() => {
    const map = new Map<number | null, GroupWithHierarchy[]>()

    for (const group of groups) {
      const parentId = group.parent_id ?? null
      const siblings = map.get(parentId) ?? []
      siblings.push(group)
      map.set(parentId, siblings)
    }

    for (const siblings of map.values()) {
      siblings.sort((left, right) => left.name.localeCompare(right.name))
    }

    return map
  }, [groups])

  const renderNodes = (parentId: number | null, depth: number) => {
    const nodes = groupsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className="space-y-1">
        {nodes.map((group) => {
          const isSelected = group.id === selectedGroupId
          const hasChildren = (groupsByParentId.get(group.id) ?? []).length > 0

          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-surface-container text-primary'
                    : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                )}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
              >
                {hasChildren ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                <span className="truncate">{group.name}</span>
              </button>
              {renderNodes(group.id, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return renderNodes(null, 0)
}
