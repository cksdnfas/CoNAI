import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupColorDot } from './group-color-dot'
import { GroupCoverMosaic } from './group-cover-mosaic'

interface GroupSubgroupStripProps {
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  sourceKey: 'custom' | 'folders'
  loadPreviewImages: (groupId: number, params?: { includeChildren?: boolean; count?: number }) => Promise<ImageRecord[]>
  onOpenGroup: (groupId: number) => void
}

/** The current group's direct children as one scrollable row of compact cover chips. */
export function GroupSubgroupStrip({ groups, countMaps, sourceKey, loadPreviewImages, onOpenGroup }: GroupSubgroupStripProps) {
  const { t, formatNumber } = useI18n()

  if (groups.length === 0) {
    return null
  }

  return (
    <nav aria-label={t({ ko: '하위 그룹', en: 'Subgroups' })} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {[...groups].sort((left, right) => left.name.localeCompare(right.name)).map((group) => {
        const totalCount = getGroupHierarchyTotalCount(group, countMaps)
        return (
          <Panel key={group.id} asChild tone="none" padding="none" interactive className="flex shrink-0 items-center gap-2.5 py-1 pl-1 pr-2.5 text-left">
            <button type="button" onClick={() => onOpenGroup(group.id)}>
              <GroupCoverMosaic
                groupId={group.id}
                sourceKey={sourceKey}
                imageCount={totalCount}
                loadPreviewImages={loadPreviewImages}
                className="size-9 shrink-0 rounded-sm"
              />
              <GroupColorDot color={group.color} />
              <span className="max-w-40 truncate text-sm font-medium text-foreground">{group.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(totalCount)}</span>
            </button>
          </Panel>
        )
      })}
    </nav>
  )
}
