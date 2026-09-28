import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@conai/shared'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupChildCard } from './group-child-card'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'

interface GroupNavigationGridSectionProps {
  childGroups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  cardStyle: GroupExplorerCardStyle
  gridClassName: string
  previewSourceKey: 'custom' | 'folders'
  loadPreviewImage: (groupId: number) => Promise<ImageRecord | null>
  onOpenGroup: (groupId: number) => void
}

/** Render the current group's direct child folders. */
export function GroupNavigationGridSection({
  childGroups,
  countMaps,
  cardStyle,
  gridClassName,
  previewSourceKey,
  loadPreviewImage,
  onOpenGroup,
}: GroupNavigationGridSectionProps) {
  const { t, formatNumber } = useI18n()

  return (
    <section className="space-y-4">
      <Text as="div" variant="overline" className="font-semibold">{t({ ko: '하위 폴더 {count}개', en: '{count} child folders' }, { count: formatNumber(childGroups.length) })}</Text>
      <div className={gridClassName}>
        {childGroups.map((group) => (
          <GroupChildCard
            key={group.id}
            group={group}
            previewSourceKey={previewSourceKey}
            loadPreviewImage={loadPreviewImage}
            totalImageCount={getGroupHierarchyTotalCount(group, countMaps)}
            cardStyle={cardStyle}
            onOpen={onOpenGroup}
          />
        ))}
      </div>
    </section>
  )
}
