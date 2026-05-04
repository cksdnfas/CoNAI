import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { useI18n } from '@/i18n'
import { buildGroupCountMaps, getGroupHierarchyCountLabel, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

export function GroupTree({ groups, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  const { formatNumber } = useI18n()
  const { childCountByGroupId, totalImageCountByGroupId } = useMemo(() => buildGroupCountMaps(groups), [groups])

  return (
    <HierarchyNav
      items={groups}
      expandable
      selectedId={selectedGroupId}
      onSelect={(group) => onSelectGroup(group.id)}
      getId={(group) => group.id}
      getParentId={(group) => group.parent_id}
      getLabel={(group) => {
        const countLabel = getGroupHierarchyCountLabel(group, { childCountByGroupId, totalImageCountByGroupId }, formatNumber)

        return (
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate">{group.name}</span>
            <span className="shrink-0 text-xs tabular-nums">{countLabel}</span>
          </div>
        )
      }}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
      isItemSelectable={(group) => getGroupHierarchyTotalCount(group, { childCountByGroupId, totalImageCountByGroupId }) > 0}
      getItemClassName={(group, state) => (!state.isSelectable && !state.hasChildren ? 'text-muted-foreground/45' : undefined)}
      renderIcon={(group, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
    />
  )
}
