import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'
import { GroupChildCard } from './group-child-card'

export interface GroupNavigationGridSectionProps {
  backNavigationGroup: GroupWithHierarchy
  parentGroupHierarchy: GroupWithHierarchy | null
  rootTitle: string
  childGroups: GroupWithHierarchy[]
  cardStyle: GroupExplorerCardStyle
  gridClassName: string
  previewSourceKey: 'custom' | 'folders'
  loadPreviewImage: (groupId: number) => Promise<ImageRecord | null>
  onOpenGroup: (groupId: number) => void
  onOpenRoot: () => void
}

/** Render the back-navigation card plus the current group's direct child groups. */
export function GroupNavigationGridSection({
  backNavigationGroup,
  parentGroupHierarchy,
  rootTitle,
  childGroups,
  cardStyle,
  gridClassName,
  previewSourceKey,
  loadPreviewImage,
  onOpenGroup,
  onOpenRoot,
}: GroupNavigationGridSectionProps) {
  return (
    <section className="space-y-4">
      <div className={gridClassName}>
        <GroupChildCard
          group={backNavigationGroup}
          variant="back"
          titleOverride={parentGroupHierarchy?.name ?? rootTitle}
          subtitleOverride={parentGroupHierarchy ? '상위 그룹으로 이동' : '루트 목록으로 이동'}
          cardStyle={cardStyle}
          onOpen={(groupId) => {
            if (parentGroupHierarchy) {
              onOpenGroup(groupId)
            } else {
              onOpenRoot()
            }
          }}
        />

        {childGroups.map((group) => (
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
