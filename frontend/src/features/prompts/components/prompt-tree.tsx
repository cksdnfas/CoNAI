import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { cn } from '@/lib/utils'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  onSelectGroup: (groupId?: number | null) => void
}

export function PromptTree({ groups, selectedGroupId, onSelectGroup }: PromptTreeProps) {
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

      <HierarchyNav
        items={groups}
        selectedId={selectedGroupId}
        onSelect={(group) => onSelectGroup(group.id)}
        getId={(group) => group.id}
        getParentId={(group) => group.parent_id}
        getLabel={(group) => group.group_name}
        sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
        renderIcon={(_, hasChildren) => (hasChildren ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />)}
      />
    </div>
  )
}
