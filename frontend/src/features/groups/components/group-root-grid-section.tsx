import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/section-heading'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'
import { buildGroupCountMaps, getGroupHierarchyCountLabel, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import { GroupChildCard } from './group-child-card'
import { useI18n } from '@/i18n'

interface GroupRootGridSectionProps {
  title: string
  groups: GroupWithHierarchy[]
  allGroups: GroupWithHierarchy[]
  cardStyle: GroupExplorerCardStyle
  gridClassName: string
  previewSourceKey: 'custom' | 'folders'
  loadPreviewImage: (groupId: number) => Promise<ImageRecord | null>
  onOpenGroup: (groupId: number) => void
}

/** Render the root-level group cards for the current group source. */
export function GroupRootGridSection({
  title,
  groups,
  allGroups,
  cardStyle,
  gridClassName,
  previewSourceKey,
  loadPreviewImage,
  onOpenGroup,
}: GroupRootGridSectionProps) {
  const { t, formatNumber } = useI18n()
  const countMaps = useMemo(() => buildGroupCountMaps(allGroups), [allGroups])

  return (
    <section className="space-y-4">
      <SectionHeading
        heading={title}
        actions={<Badge variant="secondary">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(groups.length) })}</Badge>}
      />

      <div className={gridClassName}>
        {groups.map((group) => (
          <GroupChildCard
            key={group.id}
            group={group}
            previewSourceKey={previewSourceKey}
            loadPreviewImage={loadPreviewImage}
            subtitleOverride={t({ ko: '이미지 {count}개', en: '{count} images' }, { count: getGroupHierarchyCountLabel(group, countMaps, formatNumber) })}
            totalImageCount={getGroupHierarchyTotalCount(group, countMaps)}
            cardStyle={cardStyle}
            onOpen={onOpenGroup}
          />
        ))}
      </div>
    </section>
  )
}
