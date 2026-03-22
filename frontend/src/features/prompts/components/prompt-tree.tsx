import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  onSelectGroup: (groupId?: number | null) => void
}

export function PromptTree({ groups, selectedGroupId, onSelectGroup }: PromptTreeProps) {
  const groupsByParentId = useMemo(() => {
    const map = new Map<number | null, PromptGroupRecord[]>()

    for (const group of groups) {
      const parentId = group.parent_id ?? null
      const siblings = map.get(parentId) ?? []
      siblings.push(group)
      map.set(parentId, siblings)
    }

    for (const siblings of map.values()) {
      siblings.sort((left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name))
    }

    return map
  }, [groups])

  const renderNodes = (parentId: number | null, depth: number) => {
    const nodes = groupsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className="space-y-1">
        {nodes.map((group) => {
          const hasChildren = (groupsByParentId.get(group.id) ?? []).length > 0
          const isSelected = selectedGroupId === group.id

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
                <span className="truncate">{group.group_name}</span>
              </button>
              {renderNodes(group.id, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelectGroup(undefined)}
        className={cn(
          'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors',
          selectedGroupId == null
            ? 'bg-surface-container text-primary'
            : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
        )}
      >
        <span>All prompts</span>
      </button>
      {renderNodes(null, 0)}
    </div>
  )
}
