import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { useI18n } from '@/i18n'
import { getGroupHierarchyCountDescription, getGroupHierarchyCountLabel, type GroupCountMaps } from '@/features/groups/group-count-utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

export function GroupTree({ groups, countMaps, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  const { formatNumber, t } = useI18n()

  return (
    <HierarchyNav
      items={groups}
      expandable
      selectedId={selectedGroupId}
      onSelect={(group) => onSelectGroup(group.id)}
      getId={(group) => group.id}
      getParentId={(group) => group.parent_id}
      getLabel={(group) => {
        const countLabel = getGroupHierarchyCountLabel(group, countMaps, formatNumber)
        const countDescription = getGroupHierarchyCountDescription(group, countMaps, formatNumber, t)

        return (
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate">{group.name}</span>
            <span className="shrink-0 text-xs tabular-nums" title={countDescription}>
              <span aria-hidden="true">{countLabel}</span>
              <span className="sr-only">{countDescription}</span>
            </span>
          </div>
        )
      }}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
      renderIcon={(group, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
    />
  )
}
