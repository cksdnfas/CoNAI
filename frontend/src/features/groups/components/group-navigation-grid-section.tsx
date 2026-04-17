import { ArrowLeft, ChevronRight } from 'lucide-react'
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
  isWideLayout?: boolean
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
  isWideLayout = false,
}: GroupNavigationGridSectionProps) {
  const backTitle = parentGroupHierarchy?.name ?? rootTitle
  const backSubtitle = parentGroupHierarchy ? '상위 그룹으로 이동' : '루트 목록으로 이동'
  const handleOpenBack = () => {
    if (parentGroupHierarchy) {
      onOpenGroup(backNavigationGroup.id)
    } else {
      onOpenRoot()
    }
  }

  return (
    <section className="space-y-4">
      {isWideLayout ? (
        <div className={gridClassName}>
          <GroupChildCard
            group={backNavigationGroup}
            variant="back"
            titleOverride={backTitle}
            subtitleOverride={backSubtitle}
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
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleOpenBack}
            className="group flex w-full items-center gap-3 rounded-sm border border-border/80 bg-surface-container/30 px-4 py-3 text-left transition-colors hover:bg-surface-container/45"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-low">
              <ArrowLeft className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{backTitle}</div>
              <div className="mt-1 text-xs text-muted-foreground">{backSubtitle}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>

          {childGroups.length > 0 ? (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">하위 그룹 {childGroups.length.toLocaleString('ko-KR')}개</div>
              <div className={gridClassName}>
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
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
