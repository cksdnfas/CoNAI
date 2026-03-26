import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

export function GroupTree({ groups, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  return (
    <HierarchyNav
      items={groups}
      selectedId={selectedGroupId}
      onSelect={(group) => onSelectGroup(group.id)}
      getId={(group) => group.id}
      getParentId={(group) => group.parent_id}
      getLabel={(group) => group.name}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
      renderIcon={(_, hasChildren) => (hasChildren ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />)}
    />
  )
}
