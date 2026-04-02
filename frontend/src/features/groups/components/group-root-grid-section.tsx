import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/section-heading'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'
import { GroupChildCard } from './group-child-card'

export interface GroupRootGridSectionProps {
  title: string
  groups: GroupWithHierarchy[]
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
  cardStyle,
  gridClassName,
  previewSourceKey,
  loadPreviewImage,
  onOpenGroup,
}: GroupRootGridSectionProps) {
  return (
    <section className="space-y-4">
      <SectionHeading
        heading={title}
        actions={<Badge variant="secondary">{groups.length.toLocaleString('ko-KR')}개</Badge>}
      />

      <div className={gridClassName}>
        {groups.map((group) => (
          <GroupChildCard
            key={group.id}
            group={group}
            previewSourceKey={previewSourceKey}
            loadPreviewImage={loadPreviewImage}
            cardStyle={cardStyle}
            onOpen={onOpenGroup}
          />
        ))}
      </div>
    </section>
  )
}
